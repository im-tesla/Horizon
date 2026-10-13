import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server/app";
import { WatchTogether } from "../src/desktop/watch-together";
import type { Player } from "../src/desktop/player";
import type { ClientStore } from "../src/desktop/store";
import type { MediaItem, PlayerState } from "../src/shared/types";

test("returning to the room preserves both viewers at playback and EOF, and the next episode starts in that room", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "horizon-watch-navigation-"),
  );
  const media = path.join(directory, "media");
  await mkdir(media);
  await Promise.all(
    [1, 2].map((episode) =>
      writeFile(path.join(media, `Example.S02E0${episode}.mp4`), "fixture"),
    ),
  );
  const token = "watch-navigation-test-token";
  const { app: server, library } = await createServer({
    mediaDir: media,
    dataDir: path.join(directory, "server"),
    token,
    ffprobe: "missing-watch-navigation-ffprobe",
  });
  let departures = 0;
  server.addHook("onRequest", async (request) => {
    if (request.url.endsWith("/leave")) departures++;
  });
  const url = await server.listen({ host: "127.0.0.1", port: 0 });
  function client() {
    const state: PlayerState = {
      playing: false,
      paused: false,
      position: 0,
      duration: 120,
      volume: 100,
      tracks: [],
      devices: [],
    };
    let starts = 0;
    const player = {
      state,
      async stop() {
        state.playing = false;
      },
      async start(
        item: MediaItem,
        _server: string,
        _restart: boolean,
        position: number,
        paused: boolean,
      ) {
        starts++;
        Object.assign(state, {
          playing: true,
          loaded: true,
          mediaId: item.id,
          position,
          paused,
        });
      },
      async waitReady() {},
      async setPaused(paused: boolean) {
        state.paused = paused;
      },
      async command(command: string, position: number) {
        if (command === "seek") state.position = position;
      },
      async notice() {},
    };
    const watch = new WatchTogether(
      { settings: () => ({ serverUrl: url, token }) } as unknown as ClientStore,
      player as unknown as Player,
      async () => library.snapshot(),
      async () => {},
    );
    return { watch, player, starts: () => starts };
  }
  const first = client(),
    second = client();
  async function wait(check: () => boolean) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail("Watch Together navigation did not settle.");
  }
  try {
    const items = library
      .snapshot()
      .items.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
    await first.watch.create("Alice");
    const code = first.watch.state.room!.code;
    await second.watch.join(code, "Bob");
    await first.watch.play(items[0].id);
    await wait(() =>
      [first, second].every(
        (client) => client.player.state.playing && !client.player.state.paused,
      ),
    );
    const members = first.watch.state
      .room!.members.map((member) => member.id)
      .sort();
    await first.watch.returnToLobby();
    await wait(() =>
      [first, second].every((client) => client.player.state.paused),
    );
    for (const client of [first, second]) {
      assert(client.watch.active);
      assert.equal(client.watch.state.room!.code, code);
      assert.deepEqual(
        client.watch.state.room!.members.map((member) => member.id).sort(),
        members,
      );
      assert.equal(client.starts(), 1);
    }
    for (const client of [first, second])
      Object.assign(client.player.state, { playing: false, position: 120 });
    await first.watch.returnToLobby();
    await second.watch.returnToLobby();
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(first.starts(), 1);
    assert.equal(second.starts(), 1);
    assert.equal(departures, 0, "Back must never send a room departure.");
    await second.watch.play(items[1].id);
    await wait(() =>
      [first, second].every(
        (client) =>
          client.player.state.playing &&
          client.player.state.mediaId === items[1].id &&
          !client.player.state.paused,
      ),
    );
    for (const client of [first, second]) {
      assert.equal(client.watch.state.room!.code, code);
      assert.deepEqual(
        client.watch.state.room!.members.map((member) => member.id).sort(),
        members,
      );
      assert.equal(client.starts(), 2);
    }
    assert.equal(departures, 0);
  } finally {
    await Promise.all([first.watch.leave(), second.watch.leave()]);
    await server.close();
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
