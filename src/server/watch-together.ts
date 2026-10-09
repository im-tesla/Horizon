import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MediaItem } from "../shared/types";
import {
  watchPosition,
  type WatchRoom,
  type WatchPlayback,
  type WatchControl,
} from "../shared/watch-together";

class RoomError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
interface Member {
  id: string;
  token: string;
  name: string;
  ready: boolean;
  buffering: boolean;
  seenAt: number;
}
interface Room {
  code: string;
  members: Map<string, Member>;
  version: number;
  selectedMediaId?: string;
  playback: WatchPlayback;
  waiting: boolean;
}
const nameSchema = z.string().trim().min(1).max(40);
const mediaSchema = z.string().regex(/^[a-f0-9]{32}$/);
const controlSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("play"),
      mediaId: mediaSchema,
      position: z.number().finite().min(0).max(1e7).optional(),
    })
    .strict(),
  z.object({ action: z.literal("pause") }).strict(),
  z.object({ action: z.literal("resume") }).strict(),
  z
    .object({
      action: z.literal("seek"),
      position: z.number().finite().min(0).max(1e7),
    })
    .strict(),
]);
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new RoomError(400, "Invalid Watch Together request.");
  return result.data;
};

// Rooms are coordination only. Files stream independently through the existing
// authenticated media routes; no audio/video, history, or credentials are stored here.
export class WatchRooms {
  private rooms = new Map<string, Room>();
  constructor(
    private media: (id: string) => MediaItem | undefined,
    private now = Date.now,
  ) {}
  create(name: string, mediaId?: string) {
    name = parse(nameSchema, name);
    this.sweep();
    if (this.rooms.size >= 64)
      throw new RoomError(
        503,
        "All Watch Together rooms are in use. Try again later.",
      );
    if (mediaId) this.requireMedia(mediaId);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code: string;
    do {
      code = Array.from(
        { length: 8 },
        () => alphabet[randomInt(alphabet.length)],
      ).join("");
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      members: new Map(),
      version: 0,
      selectedMediaId: mediaId,
      waiting: false,
      playback: {
        position: 0,
        paused: true,
        anchorAt: this.now(),
        revision: 0,
      },
    };
    this.rooms.set(code, room);
    return this.add(room, name);
  }
  join(code: string, name: string) {
    name = parse(nameSchema, name);
    this.sweep();
    const room = this.requireRoom(code);
    if (room.members.size >= 12)
      throw new RoomError(409, "This room already has twelve viewers.");
    if (room.playback.mediaId && !room.playback.paused) this.wait(room);
    return this.add(room, name);
  }
  private add(room: Room, name: string) {
    const member: Member = {
      id: randomUUID(),
      token: randomUUID(),
      name: parse(nameSchema, name),
      ready: false,
      buffering: false,
      seenAt: this.now(),
    };
    room.members.set(member.id, member);
    room.version++;
    return {
      room: this.snapshot(room),
      memberId: member.id,
      memberToken: member.token,
    };
  }
  read(code: string, token: string) {
    const room = this.requireRoom(code);
    this.member(room, token);
    return this.snapshot(room);
  }
  control(code: string, token: string, control: WatchControl) {
    const room = this.requireRoom(code);
    this.member(room, token);
    control = parse(controlSchema, control);
    if (control.action === "play") {
      const item = this.requireMedia(control.mediaId);
      room.selectedMediaId = item.id;
      room.playback = {
        mediaId: item.id,
        position: this.position(item, control.position ?? 0),
        paused: true,
        anchorAt: this.now(),
        revision: room.playback.revision + 1,
      };
      for (const member of room.members.values()) {
        member.ready = false;
        member.buffering = false;
      }
      room.waiting = true;
    } else {
      if (!room.playback.mediaId)
        throw new RoomError(409, "Choose a movie before starting playback.");
      const item = this.requireMedia(room.playback.mediaId);
      if (control.action === "resume" && !this.ready(room))
        throw new RoomError(409, "Waiting for everyone to load the movie.");
      const at = this.now() + 900;
      const position =
        control.action === "seek"
          ? control.position
          : watchPosition(room.playback, at);
      room.playback = {
        ...room.playback,
        position: this.position(item, position),
        paused:
          control.action === "pause" ||
          (control.action === "seek" && room.playback.paused),
        anchorAt: at,
        revision: room.playback.revision + 1,
      };
      if (control.action !== "seek") room.waiting = false;
    }
    room.version++;
    return this.snapshot(room);
  }
  presence(code: string, token: string, ready: boolean, buffering: boolean) {
    const room = this.requireRoom(code);
    const member = this.member(room, token);
    if (member.ready !== ready || member.buffering !== buffering) {
      member.ready = ready;
      member.buffering = buffering;
      room.version++;
      if (buffering && !room.playback.paused) this.wait(room);
      this.resumeWhenReady(room);
    }
    return this.snapshot(room);
  }
  leave(code: string, token: string) {
    const room = this.requireRoom(code);
    const member = this.member(room, token);
    room.members.delete(member.id);
    room.version++;
    if (!room.members.size) this.rooms.delete(code);
    else this.resumeWhenReady(room);
  }
  sweep() {
    for (const room of this.rooms.values()) {
      for (const member of room.members.values())
        if (this.now() - member.seenAt > 20000) {
          room.members.delete(member.id);
          room.version++;
        }
      if (!room.members.size) this.rooms.delete(room.code);
      else this.resumeWhenReady(room);
    }
  }
  clear() {
    this.rooms.clear();
  }
  private wait(room: Room) {
    room.playback = {
      ...room.playback,
      position: watchPosition(room.playback, this.now()),
      paused: true,
      anchorAt: this.now(),
      revision: room.playback.revision + 1,
    };
    room.waiting = true;
    room.version++;
  }
  private ready(room: Room) {
    return [...room.members.values()].every(
      (member) => member.ready && !member.buffering,
    );
  }
  private resumeWhenReady(room: Room) {
    if (room.waiting && room.playback.mediaId && this.ready(room)) {
      room.waiting = false;
      room.playback = {
        ...room.playback,
        paused: false,
        anchorAt: this.now() + 900,
        revision: room.playback.revision + 1,
      };
      room.version++;
    }
  }
  private member(room: Room, token: string) {
    if (
      typeof token !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        token,
      )
    )
      throw new RoomError(
        403,
        "Your room session is no longer valid. Rejoin the room.",
      );
    const member = [...room.members.values()].find((member) =>
      timingSafeEqual(Buffer.from(member.token), Buffer.from(token)),
    );
    if (!member || this.now() - member.seenAt > 20000)
      throw new RoomError(403, "Your room session expired. Rejoin the room.");
    member.seenAt = this.now();
    return member;
  }
  private requireRoom(code: string) {
    const room = this.rooms.get(code);
    if (!room)
      throw new RoomError(
        404,
        "This room is no longer available. Check the code or create a new room.",
      );
    return room;
  }
  private requireMedia(id: string) {
    const item = this.media(id);
    if (!item)
      throw new RoomError(404, "This movie is no longer in the library.");
    return item;
  }
  private position(item: MediaItem, value: number) {
    return Math.min(value, item.duration || 1e7);
  }
  private snapshot(room: Room): WatchRoom {
    return {
      code: room.code,
      serverTime: this.now(),
      version: room.version,
      selectedMediaId: room.selectedMediaId,
      waiting: room.waiting,
      playback: { ...room.playback },
      members: [...room.members.values()].map(
        ({ id, name, ready, buffering }) => ({ id, name, ready, buffering }),
      ),
    };
  }
}

export function registerWatchTogether(
  app: FastifyInstance,
  media: (id: string) => MediaItem | undefined,
) {
  const rooms = new WatchRooms(media);
  const sweep = setInterval(() => rooms.sweep(), 5000);
  sweep.unref();
  const rate = {
    config: {
      rateLimit: {
        max: 480,
        timeWindow: "1 minute",
        keyGenerator: (request: FastifyRequest) =>
          String(request.headers["x-horizon-room-token"] || request.ip),
      },
    },
  };
  const credentials = (request: FastifyRequest) => ({
    code: parse(
      z.string().regex(/^[A-Z2-9]{8}$/),
      (request.params as { code: string }).code,
    ),
    token: String(request.headers["x-horizon-room-token"] || ""),
  });
  app.post(
    "/api/watch/rooms",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const body = parse(
        z
          .object({ name: nameSchema, mediaId: mediaSchema.optional() })
          .strict(),
        request.body,
      );
      return rooms.create(body.name, body.mediaId);
    },
  );
  app.post(
    "/api/watch/rooms/:code/join",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request) => {
      const code = parse(
        z.string().regex(/^[A-Z2-9]{8}$/),
        (request.params as { code: string }).code,
      );
      const body = parse(z.object({ name: nameSchema }).strict(), request.body);
      return rooms.join(code, body.name);
    },
  );
  app.get("/api/watch/rooms/:code", rate, async (request) => {
    const { code, token } = credentials(request);
    return rooms.read(code, token);
  });
  app.post("/api/watch/rooms/:code/control", rate, async (request) => {
    const { code, token } = credentials(request);
    return rooms.control(code, token, parse(controlSchema, request.body));
  });
  app.post("/api/watch/rooms/:code/presence", rate, async (request) => {
    const { code, token } = credentials(request);
    const body = parse(
      z.object({ ready: z.boolean(), buffering: z.boolean() }).strict(),
      request.body,
    );
    return rooms.presence(code, token, body.ready, body.buffering);
  });
  app.post("/api/watch/rooms/:code/leave", rate, async (request) => {
    const { code, token } = credentials(request);
    rooms.leave(code, token);
    return { ok: true };
  });
  app.addHook("onClose", async () => {
    clearInterval(sweep);
    rooms.clear();
  });
  return rooms;
}
