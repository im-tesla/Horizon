import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import electronPath from "electron";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "../src/server/app";
import type { PlayerState } from "../src/shared/types";
import type { WatchState } from "../src/shared/watch-together";

const directory = await mkdtemp(
  path.join(os.tmpdir(), "horizon-together-smoke-"),
);
const token = randomUUID();
const { app: server, library } = await createServer({
  mediaDir: path.resolve("media"),
  dataDir: path.join(directory, "server"),
  token,
  ffprobe: process.env.HORIZON_FFPROBE || "ffprobe",
});
const url = await server.listen({ host: "127.0.0.1", port: 0 });
const realItems = library.snapshot().items;
if (process.env.HORIZON_SELECTOR_STRESS === "true" && realItems.length) {
  const snapshot = library.snapshot.bind(library);
  const movies = Array.from({ length: 1500 }, (_, index) => ({
    ...realItems[0],
    id: (1000000 + index).toString(16).padStart(32, "0"),
    kind: "movie" as const,
    title: `Test film ${String(index + 1).padStart(4, "0")}`,
    filename: `Test.Film.${index + 1}.2020.1080p.mkv`,
    year: 2020,
  }));
  const episodes = Array.from({ length: 720 }, (_, index) => ({
    ...realItems[0],
    id: (2000000 + index).toString(16).padStart(32, "0"),
    kind: "episode" as const,
    title: `Test series ${String(Math.floor(index / 24) + 1).padStart(2, "0")}`,
    filename: `Test.Series.${index}.mkv`,
    season: Math.floor((index % 24) / 12) + 1,
    episode: (index % 12) + 1,
  }));
  library.snapshot = () => ({
    ...snapshot(),
    items: [...realItems, ...movies, ...episodes],
  });
}
const clients: ElectronApplication[] = [];
let native: any;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const read = async (page: Page) =>
  page.evaluate(async () => ({
    player: await window.horizon!.playerState(),
    watch: await window.horizon!.watchState(),
  }));
const wait = async (
  pages: Page[],
  check: (states: { player: PlayerState; watch: WatchState }[]) => boolean,
  label: string,
  timeout = 30000,
) => {
  const deadline = Date.now() + timeout;
  let states: Awaited<ReturnType<typeof read>>[] = [];
  while (Date.now() < deadline) {
    states = await Promise.all(pages.map(read));
    if (check(states)) return states;
    await sleep(100);
  }
  assert.fail(
    `${label}: ${JSON.stringify(states.map((s) => ({ player: { playing: s.player.playing, paused: s.player.paused, position: s.player.position, loaded: s.player.loaded, error: s.player.error }, watch: s.watch })))}`,
  );
};
try {
  const pages: Page[] = [];
  for (const name of ["Alice", "Bob"]) {
    const userData = path.join(directory, name);
    await mkdir(userData);
    const env = {
      ...process.env,
      HORIZON_USER_DATA: userData,
      HORIZON_SERVER_URL: url,
      HORIZON_TOKEN: token,
      TMDB_API_KEY: "",
      HORIZON_MPV_PATH: "",
      HORIZON_MPV_TEST: "true",
      HORIZON_VIDEO_TEST: "true",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.HORIZON_DEV_URL;
    const executablePath =
      process.env.HORIZON_TEST_EXECUTABLE || String(electronPath);
    const client = await electron.launch({
      executablePath,
      args: process.env.HORIZON_TEST_EXECUTABLE ? [] : ["."],
      env,
      timeout: 30000,
    });
    clients.push(client);
    const page = await client.firstWindow();
    pages.push(page);
    if (process.env.HORIZON_TEST_EXECUTABLE) {
      await page.getByLabel("Server address", { exact: true }).fill(url);
      await page.getByLabel("Access token", { exact: true }).fill(token);
      await page
        .getByRole("button", { name: "Save settings", exact: true })
        .click();
    }
    await page.getByText("Server connected", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Watch together", exact: true })
      .click();
    await page.getByLabel("Your name", { exact: true }).fill(name);
  }
  const [first, second] = pages;
  await first
    .getByRole("button", { name: "Create a room", exact: true })
    .click();
  await first
    .getByRole("button", { name: "Copy room code", exact: true })
    .waitFor();
  const initial = await first.evaluate(() => window.horizon!.watchState());
  const code = initial.room!.code;
  await second.getByLabel("Room code", { exact: true }).fill(code);
  await second.getByRole("button", { name: "Join room", exact: true }).click();
  await wait(
    pages,
    (states) => states.every((s) => s.watch.room?.members.length === 2),
    "Both viewers must appear",
  );
  assert.equal(await first.getByRole("dialog").count(), 0);
  assert.equal(await first.locator(".room-selection select").count(), 0);
  await mkdir(".horizon/qa", { recursive: true });
  await sleep(500);
  await first.screenshot({ path: ".horizon/qa/together-lobby.png" });
  const media =
    realItems.find((i) => /Helicopter/i.test(i.filename)) ?? realItems[0];
  assert(
    media,
    "Add a real media file to media/ before running the Watch Together smoke test.",
  );
  const picker = first.getByRole("region", {
    name: "Choose something to watch",
    exact: true,
  });
  await first.evaluate(
    async ([serverId, mediaId]) => {
      await window.horizon!.setWatched(`${serverId}:${mediaId}`, true);
    },
    [library.serverId, media.id],
  );
  await picker
    .locator(
      `.picker-title[data-media-id="${media.id}"] .watched-status.complete`,
    )
    .waitFor();
  assert.equal(
    await second
      .locator(`.picker-title[data-media-id="${media.id}"] .watched-status`)
      .count(),
    0,
    "Watched history belongs to each viewer.",
  );
  const search = first.getByLabel("Search room library", { exact: true });
  await search.fill("a title that does not exist");
  await picker
    .getByRole("heading", { name: "No matching titles", exact: true })
    .waitFor();
  await picker
    .getByRole("button", { name: "Clear title search", exact: true })
    .click();
  if (process.env.HORIZON_SELECTOR_STRESS === "true") {
    const initialCount = await picker.locator(".picker-title").count();
    assert(
      initialCount <= 100 && initialCount < 1500,
      "A large library must render only its first batch.",
    );
    await picker
      .getByRole("button", { name: "Show more titles", exact: true })
      .click();
    assert(
      (await picker.locator(".picker-title").count()) > initialCount,
      "Loading more must reveal additional titles.",
    );
    await search.fill("Test film 1500");
    assert.equal(
      await picker.locator(".picker-title").count(),
      1,
      "Search must reach titles outside the rendered batch.",
    );
    await search.fill("");
  }
  const episode = realItems.find((item) => item.kind === "episode");
  if (episode) {
    await first.evaluate(
      async ([serverId, mediaId]) => {
        await window.horizon!.setWatched(`${serverId}:${mediaId}`, true);
      },
      [library.serverId, episode.id],
    );
    await picker
      .getByRole("button", { name: "TV series", exact: true })
      .click();
    await search.fill(episode.title);
    assert.equal(
      await picker.locator(".picker-title").count(),
      1,
      "Episodes must be grouped into a single series card.",
    );
    assert.match(
      await picker.locator(".watched-status").innerText(),
      /watched/i,
    );
    await picker
      .getByRole("button", {
        name: `Choose episodes of ${episode.title}`,
        exact: true,
      })
      .click();
    await picker
      .locator(
        `.picker-episode[data-media-id="${episode.id}"] .watched-status.complete`,
      )
      .waitFor();
    await picker
      .getByRole("button", { name: `Season ${episode.season}`, exact: true })
      .click();
    await first.screenshot({ path: ".horizon/qa/together-episode-picker.png" });
    await picker.locator(`[data-media-id="${episode.id}"]`).click();
    assert(
      (await first.locator(".room-movie h2").innerText()).includes(
        `S${String(episode.season).padStart(2, "0")} E${String(episode.episode).padStart(2, "0")}`,
      ),
    );
    assert.equal(
      (await first.evaluate(() => window.horizon!.watchState())).room?.playback
        .mediaId,
      undefined,
      "Browsing must not start playback for friends.",
    );
    await first
      .getByRole("button", { name: "Change selection", exact: true })
      .click();
  }
  await first
    .getByLabel("Search room library", { exact: true })
    .fill(media.title);
  await first.locator(`.picker-title[data-media-id="${media.id}"]`).click();
  await first.locator(".room-movie").waitFor();
  await first
    .getByRole("button", { name: "Start together", exact: true })
    .click();
  let states = await wait(
    pages,
    (states) =>
      states.every(
        (s) =>
          s.player.loaded &&
          s.player.playing &&
          !s.player.paused &&
          s.player.position > 1 &&
          s.watch.room?.members.every((m) => m.ready),
      ),
    "Both real players must start together",
  );
  assert(Math.abs(states[0].player.position - states[1].player.position) < 0.8);
  console.log("Two embedded mpv players started the same original stream.");
  if (process.platform === "win32") {
    // This helper uses ordinary Windows SendInput, targeting only this owned app.
    // @ts-expect-error JavaScript native-window QA helper.
    const { checkNativeVideo } = await import("./native-video-check.mjs");
    native = await checkNativeVideo(clients[1], second);
    assert.equal(
      await native.command(["get_property", "audio-spdif"]),
      "ac3,eac3,truehd,dts,dts-hd",
    );
    assert.equal(await native.command(["get_property", "speed"]), 1);
    await native.click("pause");
  } else await second.evaluate(() => window.horizon!.playerCommand("pause"));
  await wait(
    pages,
    (states) => states.every((s) => s.player.paused),
    "A guest's pause must reach both players",
  );
  await second.evaluate(() =>
    window.horizon!.saveSettings({
      subtitleFont: "Noto Serif",
      subtitleSize: 42,
    }),
  );
  const subtitleSettings = await Promise.all(
    pages.map((page) =>
      page.evaluate(() =>
        window.horizon!.state().then((state) => state.settings),
      ),
    ),
  );
  assert.equal(subtitleSettings[0].subtitleFont, "Inter");
  assert.equal(subtitleSettings[1].subtitleFont, "Noto Serif");
  assert.equal(subtitleSettings[1].subtitleSize, 42);
  if (native)
    assert.equal(await native.command(["get_property", "sub-font-size"]), 42);
  await second.evaluate(() => window.horizon!.playerCommand("seek", 8));
  states = await wait(
    pages,
    (states) =>
      states.every(
        (s) => s.player.paused && Math.abs(s.player.position - 8) < 0.3,
      ),
    "A guest's seek must reach both players",
  );
  if (native) {
    await sleep(400);
    assert(
      Math.abs((await native.command(["get_property", "time-pos"])) - 8) < 0.3,
    );
    await native.capture(".horizon/qa/together-player.png");
    await native.click("watch-together");
    await second
      .getByRole("heading", { name: "Watch together", exact: true })
      .waitFor();
    await second
      .getByRole("button", { name: "Return to movie", exact: true })
      .click();
    await second.locator(".video-surface").waitFor();
    await wait(
      pages,
      (states) =>
        states.every(
          (s) => s.player.paused && Math.abs(s.player.position - 8) < 0.3,
        ),
      "Lobby and return must preserve the shared position",
    );
    await native.click("forward");
    await wait(
      pages,
      (states) => states.every((s) => Math.abs(s.player.position - 18) < 0.3),
      "A guest's native seek must reach both players",
    );
    await native.click("rewind");
    await wait(
      pages,
      (states) => states.every((s) => Math.abs(s.player.position - 8) < 0.3),
      "Native rewind must reach both players",
    );
  }
  await first.evaluate(() => window.horizon!.playerCommand("pause"));
  await wait(
    pages,
    (states) => states.every((s) => !s.player.paused && s.player.position > 9),
    "Either viewer must be able to resume",
  );
  // Joining a running room waits for the newcomer, then starts both at its position.
  await second.evaluate(() => window.horizon!.watchLeave());
  await wait(
    [first],
    (states) =>
      states[0].watch.room?.members.length === 1 && !states[0].player.paused,
    "The remaining viewer keeps watching",
  );
  native?.restoreCursor();
  native = undefined;
  await second.evaluate(
    ([code]) => window.horizon!.watchJoin(code, "Bob"),
    [code],
  );
  states = await wait(
    pages,
    (states) =>
      states.every(
        (s) =>
          s.watch.room?.members.length === 2 &&
          s.player.loaded &&
          !s.player.paused &&
          !s.watch.room.waiting,
      ) &&
      Math.abs(states[0].player.position - states[1].player.position) < 0.8,
    "Late rejoining viewer must catch up",
  );
  for (const state of states) {
    assert(!JSON.stringify(state.watch).includes(token));
    assert(!JSON.stringify(state.watch).includes("memberToken"));
  }
  await first.evaluate(() => window.horizon!.playerCommand("pause"));
  await wait(
    pages,
    (states) => states.every((s) => s.player.paused),
    "Pause after rejoin",
  );
  await Promise.all(
    pages.map((page) => page.evaluate(() => window.horizon!.watchLeave())),
  );
  for (const client of clients) await client.close();
  clients.length = 0;
  for (const name of ["Alice", "Bob"]) {
    const disk = JSON.parse(
      await readFile(path.join(directory, name, "state.json"), "utf8"),
    );
    assert(
      Object.values(disk.history).some((p: any) => p.position >= 8),
      "Each client retains its own resume position.",
    );
    assert.equal(disk.settings.watchName, name);
    assert(!("audioMode" in disk.settings));
    assert(!("audioDevice" in disk.settings));
  }
  console.log(
    "Watch Together passed: real guest mouse pause, shared seeking/resume, late join, original HDMI options, and independent local history.",
  );
} finally {
  native?.restoreCursor();
  for (const client of clients) await client.close().catch(() => {});
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
