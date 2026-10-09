import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WatchRooms } from "../src/server/watch-together";
import { watchPosition } from "../src/shared/watch-together";
import type { MediaItem } from "../src/shared/types";
import { createServer } from "../src/server/app";

const item: MediaItem = {
  id: "a".repeat(32),
  title: "Movie",
  kind: "movie",
  filename: "Movie.mkv",
  size: 10,
  addedAt: "",
  modifiedAt: "",
  duration: 600,
  tracks: [],
  subtitles: [],
};
function fixture() {
  let now = 100000;
  const rooms = new WatchRooms(
    (id) => (id === item.id ? item : undefined),
    () => now,
  );
  const first = rooms.create("Alice", item.id);
  const second = rooms.join(first.room.code, "Bob");
  const code = first.room.code;
  const ready = (token: string) => rooms.presence(code, token, true, false);
  return {
    rooms,
    first,
    second,
    code,
    ready,
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
}
test("everyone can start, pause, seek and resume with a shared scheduled clock", () => {
  const { rooms, first, second, code, ready, advance, now } = fixture();
  assert.equal(first.room.playback.mediaId, undefined);
  let room = rooms.control(code, second.memberToken, {
    action: "play",
    mediaId: item.id,
  });
  assert(room.waiting);
  assert(room.playback.paused);
  ready(first.memberToken);
  assert.throws(
    () => rooms.control(code, second.memberToken, { action: "resume" }),
    /Waiting/,
  );
  room = ready(second.memberToken);
  assert(!room.waiting);
  assert(!room.playback.paused);
  assert.equal(room.playback.anchorAt, now() + 900);
  advance(3900);
  assert.equal(watchPosition(room.playback, now()), 3);
  room = rooms.control(code, second.memberToken, { action: "pause" });
  assert.equal(room.playback.position, 3.9);
  advance(900);
  room = rooms.control(code, first.memberToken, {
    action: "seek",
    position: 120,
  });
  assert.equal(room.playback.position, 120);
  assert(room.playback.paused);
  room = rooms.control(code, second.memberToken, { action: "resume" });
  advance(1900);
  assert.equal(watchPosition(room.playback, now()), 121);
  room = rooms.control(code, first.memberToken, {
    action: "seek",
    position: 900,
  });
  assert.equal(room.playback.position, item.duration);
  assert(!room.playback.paused);
});
test("late joiners and buffering pause everyone until ready; departure preserves the remaining session", () => {
  const { rooms, first, second, code, ready, advance } = fixture();
  rooms.control(code, first.memberToken, {
    action: "play",
    mediaId: item.id,
    position: 20,
  });
  ready(first.memberToken);
  ready(second.memberToken);
  advance(1900);
  const third = rooms.join(code, "Charlie");
  assert(third.room.waiting);
  assert.equal(third.room.playback.position, 21);
  let room = rooms.presence(code, third.memberToken, true, false);
  assert(!room.waiting);
  assert(!room.playback.paused);
  advance(1900);
  room = rooms.presence(code, second.memberToken, true, true);
  assert(room.waiting);
  assert(room.playback.paused);
  rooms.leave(code, second.memberToken);
  room = rooms.read(code, first.memberToken);
  assert.equal(room.members.length, 2);
  assert(!room.waiting);
  assert(!room.playback.paused);
  rooms.leave(code, third.memberToken);
  rooms.leave(code, first.memberToken);
  assert.throws(
    () => rooms.read(code, first.memberToken),
    /no longer available/,
  );
});
test("room membership is private, invalid requests cannot mutate rooms, stale viewers expire", () => {
  const { rooms, first, second, code, advance } = fixture();
  assert(!JSON.stringify(first.room).includes(first.memberToken));
  assert.throws(
    () => rooms.control(code, "é".repeat(36), { action: "pause" }),
    /no longer valid/,
  );
  assert.throws(() => rooms.join(code, " "), /Invalid/);
  assert.equal(rooms.read(code, first.memberToken).members.length, 2);
  assert.throws(
    () =>
      rooms.control(code, second.memberToken, {
        action: "play",
        mediaId: "b".repeat(32),
      }),
    /no longer/,
  );
  assert.throws(
    () =>
      rooms.control(code, second.memberToken, { action: "seek", position: -1 }),
    /Invalid/,
  );
  for (let i = 2; i < 12; i++) rooms.join(code, `Viewer ${i}`);
  assert.throws(() => rooms.join(code, "Overflow"), /twelve/);
  advance(21000);
  rooms.sweep();
  assert.throws(
    () => rooms.read(code, first.memberToken),
    /no longer available/,
  );
});
test("authenticated room HTTP endpoints keep original streams and private membership credentials separate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "horizon-room-test-"));
  const mediaDir = path.join(directory, "media");
  await mkdir(mediaDir);
  const bytes = Buffer.from("original movie bytes");
  await writeFile(path.join(mediaDir, "Movie.mkv"), bytes);
  const token = "test-only-horizon-room-server-token";
  const { app, library } = await createServer({
    mediaDir,
    dataDir: path.join(directory, "data"),
    token,
    ffprobe: "nonexistent-test-ffprobe",
  });
  try {
    const headers = { authorization: `Bearer ${token}` };
    const mediaId = library.snapshot().items[0].id;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/watch/rooms",
          payload: { name: "Alice" },
        })
      ).statusCode,
      401,
    );
    const first = (
      await app.inject({
        method: "POST",
        url: "/api/watch/rooms",
        headers,
        payload: { name: "Alice", mediaId },
      })
    ).json();
    const base = `/api/watch/rooms/${first.room.code}`;
    const second = (
      await app.inject({
        method: "POST",
        url: `${base}/join`,
        headers,
        payload: { name: "Bob" },
      })
    ).json();
    assert.equal((await app.inject({ url: base, headers })).statusCode, 403);
    assert.equal(
      (
        await app.inject({
          url: base,
          headers: { ...headers, "x-horizon-room-token": "é".repeat(36) },
        })
      ).statusCode,
      403,
    );
    const memberHeaders = {
      ...headers,
      "x-horizon-room-token": second.memberToken,
    };
    const play = await app.inject({
      method: "POST",
      url: `${base}/control`,
      headers: memberHeaders,
      payload: { action: "play", mediaId },
    });
    assert.equal(play.statusCode, 200);
    assert.equal(play.json().playback.mediaId, mediaId);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `${base}/control`,
          headers: memberHeaders,
          payload: { action: "seek", position: -1 },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `${base}/presence`,
          headers: memberHeaders,
          payload: { ready: true, buffering: false },
        })
      ).statusCode,
      200,
    );
    const publicRoom = await app.inject({ url: base, headers: memberHeaders });
    for (const secret of [token, first.memberToken, second.memberToken])
      assert(!publicRoom.body.includes(secret));
    const stream = await app.inject({ url: `/api/media/${mediaId}`, headers });
    assert.deepEqual(stream.rawPayload, bytes);
    assert.equal(
      (
        await app.inject({
          url: `/api/media/${mediaId}`,
          headers: { "x-horizon-room-token": second.memberToken },
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
