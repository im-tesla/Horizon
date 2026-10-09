import { EventEmitter } from "node:events";
import { z } from "zod";
import type { ClientStore } from "./store";
import type { Player } from "./player";
import type { Library } from "../shared/types";
import {
  watchRoomSchema,
  watchPosition,
  type WatchRoom,
  type WatchState,
  type WatchControl,
} from "../shared/watch-together";

class WatchRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
interface Session {
  code: string;
  memberId: string;
  memberToken: string;
  serverUrl: string;
  token: string;
}
const joinedSchema = z.object({
  room: watchRoomSchema,
  memberId: z.string().uuid(),
  memberToken: z.string().uuid(),
});

export class WatchTogether extends EventEmitter {
  state: WatchState = { status: "idle" };
  private session?: Session;
  private generation = 0;
  private timer?: NodeJS.Timeout;
  private scheduled?: NodeJS.Timeout;
  private applied = -1;
  private loading = false;
  private applying: Promise<void> = Promise.resolve();
  private serverOffset = 0;
  private bestRtt = Infinity;
  private failures = 0;
  constructor(
    private store: ClientStore,
    private player: Player,
    private library: () => Promise<Library>,
    private prepare: (mediaId: string) => Promise<void>,
  ) {
    super();
  }
  get active(): boolean {
    return !!this.session;
  }
  async create(name: string, mediaId?: string): Promise<void> {
    await this.connect("/api/watch/rooms", { name, mediaId });
  }
  async join(code: string, name: string): Promise<void> {
    await this.connect(`/api/watch/rooms/${code}/join`, { name });
  }
  private async connect(path: string, body: unknown) {
    await this.leave();
    await this.player.stop();
    this.state = { status: "connecting" };
    this.publish();
    this.serverOffset = 0;
    this.bestRtt = Infinity;
    const generation = ++this.generation;
    try {
      const joined = joinedSchema.parse(await this.request(path, "POST", body));
      if (generation !== this.generation) return;
      const settings = this.store.settings();
      this.session = {
        code: joined.room.code,
        memberId: joined.memberId,
        memberToken: joined.memberToken,
        serverUrl: settings.serverUrl,
        token: settings.token,
      };
      this.state = {
        status: "connected",
        room: joined.room,
        memberId: joined.memberId,
      };
      this.applied = -1;
      this.failures = 0;
      this.publish();
      this.receive(joined.room);
      this.schedulePoll(0);
    } catch (error) {
      this.state = { status: "error", error: this.message(error) };
      this.publish();
      throw error;
    }
  }
  async leave(): Promise<void> {
    const session = this.session;
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.scheduled);
    this.session = undefined;
    this.applied = -1;
    this.loading = false;
    this.state = { status: "idle" };
    this.publish();
    if (session)
      await this.request(
        `/api/watch/rooms/${session.code}/leave`,
        "POST",
        undefined,
        session,
      ).catch(() => {});
  }
  async play(mediaId: string, position = 0): Promise<void> {
    await this.control({ action: "play", mediaId, position });
  }
  async command(command: "pause" | "seek", position?: number): Promise<void> {
    const room = this.state.room;
    if (!room || !this.session)
      throw new Error("Join a Watch Together room first.");
    await this.control(
      command === "seek"
        ? { action: "seek", position: position! }
        : { action: room.playback.paused ? "resume" : "pause" },
    );
  }
  async pause(): Promise<void> {
    await this.control({ action: "pause" });
  }
  private async control(control: WatchControl) {
    if (!this.session) throw new Error("Join a Watch Together room first.");
    const generation = this.generation;
    try {
      const room = watchRoomSchema.parse(
        await this.request(
          `/api/watch/rooms/${this.session.code}/control`,
          "POST",
          control,
        ),
      );
      if (generation === this.generation) this.receive(room);
    } catch (error) {
      this.state = { ...this.state, error: this.message(error) };
      this.publish();
      await this.player.notice(this.message(error)).catch(() => {});
      throw error;
    }
  }
  private schedulePoll(delay = 350) {
    clearTimeout(this.timer);
    if (this.session) this.timer = setTimeout(() => void this.poll(), delay);
  }
  private async poll() {
    const session = this.session,
      generation = this.generation;
    if (!session) return;
    try {
      const room = watchRoomSchema.parse(
        await this.request(`/api/watch/rooms/${session.code}`),
      );
      if (generation !== this.generation) return;
      if (this.failures) this.applied = -1;
      this.failures = 0;
      this.receive(room);
      const player = this.player.state;
      const ready =
        !this.loading &&
        player.playing &&
        !!player.loaded &&
        player.mediaId === room.playback.mediaId &&
        this.applied === room.playback.revision;
      const buffering = ready && !!player.buffering;
      const me = room.members.find((member) => member.id === session.memberId);
      if (
        room.playback.mediaId &&
        me &&
        (me.ready !== ready || me.buffering !== buffering)
      ) {
        const next = watchRoomSchema.parse(
          await this.request(
            `/api/watch/rooms/${session.code}/presence`,
            "POST",
            { ready, buffering },
          ),
        );
        if (generation !== this.generation) return;
        this.receive(next);
      }
      if (
        ready &&
        !buffering &&
        this.applied === this.state.room?.playback.revision &&
        !this.scheduled
      ) {
        const playback = this.state.room!.playback;
        if (this.now() >= playback.anchorAt) {
          const position = watchPosition(playback, this.now());
          // Hard seeks only: changing speed would disrupt original HDMI bitstreams.
          if (Math.abs(player.position - position) > 0.8)
            await this.player.command("seek", position);
          if (player.paused !== playback.paused)
            await this.player.setPaused(playback.paused);
        }
      }
      this.schedulePoll();
    } catch (error) {
      if (generation !== this.generation) return;
      this.failures++;
      await this.player.setPaused(true).catch(() => {});
      clearTimeout(this.scheduled);
      this.scheduled = undefined;
      if (
        error instanceof WatchRequestError &&
        [401, 403, 404].includes(error.status)
      ) {
        this.session = undefined;
        this.state = { status: "error", error: this.message(error) };
        this.publish();
        return;
      }
      this.state = {
        ...this.state,
        status: "reconnecting",
        error: "Connection lost. Playback is paused while Horizon reconnects.",
      };
      this.publish();
      this.schedulePoll(Math.min(5000, 700 * this.failures));
    }
  }
  private receive(room: WatchRoom) {
    if (
      !this.session ||
      (this.state.room && room.version < this.state.room.version)
    )
      return;
    const changed =
      this.state.room?.version !== room.version ||
      this.state.status !== "connected" ||
      !!this.state.error;
    this.state = { status: "connected", room, memberId: this.session.memberId };
    if (changed) this.publish();
    if (
      !room.playback.mediaId ||
      (this.applied === room.playback.revision && !this.loading)
    )
      return;
    const generation = this.generation;
    this.applying = this.applying
      .catch(() => {})
      .then(() => this.apply(room, generation))
      .catch(async (error) => {
        if (generation !== this.generation) return;
        this.loading = false;
        this.state = { ...this.state, error: this.message(error) };
        this.publish();
        await this.player.notice(this.message(error)).catch(() => {});
      });
  }
  private async apply(room: WatchRoom, generation: number) {
    if (
      generation !== this.generation ||
      room.playback.revision !== this.state.room?.playback.revision ||
      this.applied === room.playback.revision
    )
      return;
    clearTimeout(this.scheduled);
    this.scheduled = undefined;
    const playback = room.playback,
      mediaId = playback.mediaId!;
    if (!this.player.state.playing || this.player.state.mediaId !== mediaId) {
      this.loading = true;
      const library = await this.library();
      const item = library.items.find((item) => item.id === mediaId);
      if (!item) throw new Error("This movie is no longer in the library.");
      await this.prepare(mediaId);
      if (generation !== this.generation) return;
      await this.player.start(
        item,
        library.serverId,
        true,
        watchPosition(playback, this.now()),
        true,
      );
      await this.player.waitReady(mediaId);
      this.loading = false;
    }
    if (
      generation !== this.generation ||
      playback.revision !== this.state.room?.playback.revision
    )
      return;
    this.applied = playback.revision;
    const delay = Math.max(0, playback.anchorAt - this.now());
    if (delay && !playback.paused) {
      await this.player.setPaused(true);
      await this.player.command("seek", playback.position);
    }
    const finish = async () => {
      if (
        generation !== this.generation ||
        playback.revision !== this.state.room?.playback.revision
      )
        return;
      this.scheduled = undefined;
      const position = watchPosition(playback, this.now());
      if (playback.paused) await this.player.setPaused(true);
      if (Math.abs(this.player.state.position - position) > 0.15)
        await this.player.command("seek", position);
      await this.player.setPaused(playback.paused);
    };
    if (delay)
      this.scheduled = setTimeout(() => {
        this.applying = this.applying
          .catch(() => {})
          .then(finish)
          .catch(() => {});
      }, delay);
    else await finish();
  }
  private now() {
    return Date.now() + this.serverOffset;
  }
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    session = this.session,
  ): Promise<unknown> {
    const settings = session ?? this.store.settings();
    if (!settings.serverUrl || !settings.token)
      throw new Error(
        "Connect your server in Settings before using Watch Together.",
      );
    const started = Date.now();
    const response = await fetch(new URL(path, settings.serverUrl), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: {
        Authorization: `Bearer ${settings.token}`,
        ...(session ? { "X-Horizon-Room-Token": session.memberToken } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    const ended = Date.now(),
      rtt = ended - started;
    if (!response.ok) {
      const message =
        response.status === 404 && path === "/api/watch/rooms"
          ? "Update and restart your Horizon server to use Watch Together."
          : typeof result.message === "string"
            ? result.message
            : typeof result.error === "string"
              ? result.error
              : "Watch Together request failed.";
      throw new WatchRequestError(response.status, message);
    }
    const serverTime = result.serverTime ?? result.room?.serverTime;
    if (typeof serverTime === "number" && rtt <= this.bestRtt * 1.5) {
      const offset = serverTime - (started + ended) / 2;
      this.serverOffset =
        this.bestRtt === Infinity
          ? offset
          : this.serverOffset * 0.8 + offset * 0.2;
      this.bestRtt = Math.min(this.bestRtt, rtt);
    }
    return result;
  }
  private message(error: unknown) {
    return error instanceof Error
      ? error.message
      : "Watch Together could not connect.";
  }
  private publish() {
    this.emit("state", this.state);
  }
}
