import { _electron as electron } from "playwright";
import electronPath from "electron";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ quiet: true });
const packagedExecutable = process.env.HORIZON_TEST_EXECUTABLE;
const launchOptions = {
  executablePath: packagedExecutable || electronPath,
  args: packagedExecutable ? [] : ["."],
  timeout: 30000,
};
const userData = await mkdtemp(path.join(os.tmpdir(), "horizon-desktop-test-"));
const env = {
  ...process.env,
  HORIZON_USER_DATA: userData,
  HORIZON_MPV_TEST: "true",
  HORIZON_MPV_PATH: "",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.HORIZON_DEV_URL;
let application;
let native;
const waitForPlayer = async (predicate, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  let state;
  do {
    state = await (
      await application.firstWindow()
    ).evaluate(() => window.horizon.playerState());
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 75));
  } while (Date.now() < deadline);
  assert.fail(
    `Playback state did not settle: ${JSON.stringify({ playing: state.playing, paused: state.paused, position: state.position, controlsReady: state.controlsReady, controlsVisible: state.controlsVisible, error: state.error })}`,
  );
};
const waitForFullscreen = async (enabled) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const current = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isFullScreen(),
    );
    if (current === enabled) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Fullscreen must become ${enabled}.`);
};
try {
  application = await electron.launch({
    ...launchOptions,
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  application.process().stderr.on("data", (chunk) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines)
      if (line.startsWith("SUBTITLE_STYLE:")) console.log(line);
  });
  if (packagedExecutable) {
    await page.locator(".settings-page").waitFor();
    await page
      .getByLabel("Server address", { exact: true })
      .fill(process.env.HORIZON_SERVER_URL);
    await page
      .getByLabel("Access token", { exact: true })
      .fill(process.env.HORIZON_TOKEN);
    await page
      .getByLabel("TMDB API key", { exact: true })
      .fill(process.env.TMDB_API_KEY);
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.locator(".settings-page").waitFor({ state: "hidden" });
  }
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page
    .getByText("Server connected", { exact: true })
    .waitFor({ timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector(".matching"), null, {
    timeout: 45000,
  });
  await page.waitForFunction(
    () => [...document.images].every((image) => image.complete),
    null,
    { timeout: 15000 },
  );
  const titles = await page.locator(".poster-card h3").allTextContents();
  assert(titles.length > 0, "The real server library should be visible.");
  await mkdir(".horizon/qa", { recursive: true });
  await page.waitForFunction(() =>
    [...document.getAnimations()]
      .filter(
        (animation) => animation.effect?.getTiming().iterations !== Infinity,
      )
      .every((animation) => animation.playState === "finished"),
  );
  await page.screenshot({ path: ".horizon/qa/library.png" });
  await page.getByRole("button", { name: "TV series", exact: true }).click();
  assert((await page.locator(".poster-card").count()) > 0);
  await page.locator(".poster-card").first().click();
  await page.locator(".detail-page").waitFor();
  assert.equal(
    await page.getByRole("dialog").count(),
    0,
    "Details must be a page, not a modal.",
  );
  assert((await page.locator(".episode-row").count()) > 0);
  await page.waitForFunction(
    () =>
      [...document.images].every((image) => image.complete) &&
      getComputedStyle(document.querySelector(".detail-page")).opacity === "1",
    null,
    { timeout: 15000 },
  );
  await page.screenshot({ path: ".horizon/qa/episodes.png" });
  await page
    .getByRole("button", { name: /Mark watched episode/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Mark unwatched episode/ })
    .first()
    .waitFor();
  assert.equal(
    await page.locator(".episode-row .watched-status.complete").count(),
    1,
  );
  assert.match(
    await page
      .locator(".episode-row")
      .first()
      .locator(".media-badges")
      .innerText(),
    /1080p.*H\.265/s,
  );
  await page.getByRole("button", { name: "Back to library" }).click();
  await page
    .locator(".poster-card .watched-status.partial")
    .getByText(/1\/\d+ watched/)
    .waitFor();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search your library" })
    .fill("this-title-does-not-exist");
  await page.getByText("No matching titles", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".settings-page").waitFor();
  assert.equal(
    await page.getByRole("dialog").count(),
    0,
    "Settings must be a page, not a modal.",
  );
  assert.equal(
    await page.getByText("Original audio passthrough", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByLabel("Audio output", { exact: true }).count(),
    0,
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".settings-content")).opacity ===
      "1",
  );
  await page.screenshot({ path: ".horizon/qa/settings.png" });
  const checkActionBar = async () => {
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const { x, y, width, height, bottom, right } = document
          .querySelector(selector)
          .getBoundingClientRect();
        return { x, y, width, height, bottom, right };
      };
      return {
        dialog: rect(".settings-page"),
        cancel: rect(".settings-actions .cancel-button"),
        save: rect(".settings-actions .primary-button"),
      };
    });
    assert.equal(layout.cancel.height, 40);
    assert.equal(layout.save.height, 40);
    assert.equal(layout.cancel.y, layout.save.y);
    assert.equal(layout.save.x - layout.cancel.right, 12);
    assert(
      layout.dialog.bottom - layout.save.bottom >= 24,
      "Settings actions must retain bottom padding.",
    );
    assert(
      layout.dialog.right - layout.save.right >= 24,
      "Settings actions must retain right padding.",
    );
  };
  await checkActionBar();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(980, 680),
  );
  await page.waitForFunction(
    () => window.innerWidth <= 980 && window.innerHeight <= 680,
  );
  await checkActionBar();
  await page.screenshot({ path: ".horizon/qa/settings-compact.png" });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 960),
  );
  await page.waitForFunction(() => window.innerWidth > 980);
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByText("Changes saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to library" }).click();
  // Optional real mpv smoke test, using the authenticated original stream.
  if (process.env.HORIZON_TEST_PLAYBACK === "true") {
    const items = await page.evaluate(() => window.horizon.library());
    const item =
      items.items.find((i) => /Helicopter/i.test(i.filename)) ?? items.items[0];
    const local = await page.evaluate(() => window.horizon.state());
    const key = `${item.kind === "episode" ? "tv" : "movie"}:${item.title.toLocaleLowerCase("en-US")}:${item.year ?? ""}`;
    const title = local.metadata[key]?.title ?? item.title;
    await page
      .locator(".poster-card")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .click();
    await page.locator(".detail-actions .primary-button").click();
    await page.locator(".video-surface").waitFor();
    await waitForPlayer(
      (player) => player.playing && player.position > 2 && player.controlsReady,
    );
    if (process.env.HORIZON_VIDEO_TEST === "true") {
      const { checkNativeVideo } = await import("./native-video-check.mjs");
      native = await checkNativeVideo(application, page);
    }
    if (native) await native.click("pause");
    else await page.evaluate(() => window.horizon.playerCommand("pause"));
    await waitForPlayer((player) => player.paused);
    if (native) {
      const player = await page.evaluate(() => window.horizon.playerState());
      await native.click("seek", 8 / player.duration);
      await waitForPlayer((state) => Math.abs(state.position - 8) < 0.2);
      await native.click("forward");
      await waitForPlayer((state) => Math.abs(state.position - 18) < 0.2);
      await native.click("rewind");
      await waitForPlayer((state) => Math.abs(state.position - 8) < 0.2);
      assert.equal(
        (await page.evaluate(() => window.horizon.playerState())).volume,
        100,
      );
      assert.equal(
        await native.command(["get_property", "audio-spdif"]),
        "ac3,eac3,truehd,dts,dts-hd",
      );
      assert.equal(await native.command(["get_property", "speed"]), 1);
    } else await page.evaluate(() => window.horizon.playerCommand("seek", 8));
    await waitForPlayer((player) => player.position >= 7, 10000);
    if (process.env.HORIZON_VIDEO_TEST === "true") {
      if (native) {
        const { verifyBounds } = native;
        const surface = await page.locator(".video-surface").boundingBox();
        const size = await page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
        }));
        assert.equal(surface.x, 0);
        assert.equal(surface.y, 0);
        assert.equal(surface.width, size.width);
        assert.equal(surface.height, size.height);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await native.capture();
        await writeFile(
          ".horizon/qa/subtitle-preview.srt",
          "1\n00:00:00,000 --> 00:01:00,000\nKeep every word clear.\nLet the picture do the rest.\n",
        );
        await native.command([
          "sub-add",
          path.resolve(".horizon/qa/subtitle-preview.srt"),
          "select",
          "Subtitle preview",
          "en",
        ]);
        await waitForPlayer((player) =>
          player.tracks.some((track) => track.type === "sub" && track.selected),
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert(
          (await native.command(["get_property", "sub-text"])).includes(
            "Keep every word clear.",
          ),
        );
        await native.capture(".horizon/qa/subtitles-with-controls.png");
        await native.hover("subtitle-style");
        await native.capture(".horizon/qa/player-style-tooltip.png");
        await native.hover("tracks");
        await native.capture(".horizon/qa/player-track-tooltip.png");
        await native.click("tracks");
        await waitForPlayer((state) => state.controlsMenu === "sub");
        await new Promise((resolve) => setTimeout(resolve, 300));
        await native.capture(".horizon/qa/player-track-menu.png");
        await native.click("subtitle-off");
        await waitForPlayer(
          (state) =>
            !state.tracks.some(
              (track) => track.type === "sub" && track.selected,
            ),
        );
        await native.click("tracks");
        await waitForPlayer((state) => state.controlsMenu === "sub");
        await native.click("subtitle-preview");
        await waitForPlayer((state) =>
          state.tracks.some((track) => track.type === "sub" && track.selected),
        );
        await native.click("tracks");
        await waitForPlayer((state) => state.controlsMenu === "sub");
        await native.key(27);
        await waitForPlayer((state) => !state.controlsMenu);
        const expectSubtitleStyle = async (patch) => {
          let settings;
          for (let attempt = 0; attempt < 100; attempt++) {
            settings = await page.evaluate(() =>
              window.horizon.state().then((state) => state.settings),
            );
            if (
              Object.entries(patch).every(
                ([field, value]) => settings[field] === value,
              )
            )
              break;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          for (const [field, value] of Object.entries(patch))
            assert.equal(settings[field], value);
          const properties = {
            subtitleFont: "sub-font",
            subtitleSize: "sub-font-size",
            subtitleOutline: "sub-outline-size",
            subtitleShadow: "sub-shadow-offset",
            subtitleBold: "sub-bold",
            subtitleBackground: "sub-border-style",
          };
          for (const [field, expected] of Object.entries(patch)) {
            if (!properties[field]) continue;
            const value =
              field === "subtitleBackground"
                ? expected
                  ? "background-box"
                  : "outline-and-shadow"
                : expected;
            let current;
            for (let attempt = 0; attempt < 240; attempt++) {
              current = await native.command([
                "get_property",
                properties[field],
              ]);
              if (current === value) break;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            if (current !== value) {
              const diagnostic = await page.evaluate(async () => {
                const player = await window.horizon.playerState();
                return {
                  playing: player.playing,
                  paused: player.paused,
                  position: player.position,
                  controlsReady: player.controlsReady,
                  inPlayer: !!document.querySelector(".video-surface"),
                };
              });
              console.log("Subtitle diagnostic", diagnostic);
              await native.capture(".horizon/qa/player-style-failure.png");
            }
            assert.equal(
              current,
              value,
              `${field} must apply to the actual player.`,
            );
          }
        };
        await native.click("subtitle-style");
        await waitForPlayer((state) => state.controlsMenu === "style");
        await native.click("style-reset");
        await expectSubtitleStyle({
          subtitleFont: "Inter",
          subtitleSize: 36,
          subtitleOutline: 0.8,
          subtitleShadow: 1.2,
          subtitleBold: false,
          subtitleColor: "white",
          subtitleBackground: false,
        });
        await native.click("style-mono");
        await expectSubtitleStyle({ subtitleFont: "Noto Sans Mono" });
        assert.equal(
          await native.command(["get_property", "sub-font"]),
          "Noto Sans Mono",
        );
        await native.click("style-serif");
        await expectSubtitleStyle({ subtitleFont: "Noto Serif" });
        await native.click("style-size-more");
        await expectSubtitleStyle({ subtitleSize: 38 });
        await native.click("style-outline-more");
        await expectSubtitleStyle({ subtitleOutline: 1 });
        await native.click("style-shadow-more");
        await expectSubtitleStyle({ subtitleShadow: 1.6 });
        await native.click("style-bold");
        await expectSubtitleStyle({ subtitleBold: true });
        await native.click("style-warm");
        await expectSubtitleStyle({ subtitleColor: "warm" });
        await native.click("style-background");
        await expectSubtitleStyle({ subtitleBackground: true });
        assert.equal(
          await native.command(["get_property", "sub-font"]),
          "Noto Serif",
        );
        assert.equal(
          await native.command(["get_property", "sub-font-size"]),
          38,
        );
        assert.equal(
          await native.command(["get_property", "sub-outline-size"]),
          1,
        );
        assert.equal(
          await native.command(["get_property", "sub-shadow-offset"]),
          1.6,
        );
        assert.equal(await native.command(["get_property", "sub-bold"]), true);
        assert.equal(
          await native.command(["get_property", "sub-border-style"]),
          "background-box",
        );
        await new Promise((resolve) => setTimeout(resolve, 350));
        await native.capture(".horizon/qa/player-subtitle-appearance.png");
        await native.key(27);
        await waitForPlayer((state) => !state.controlsMenu);
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(980, 680),
        );
        await page.waitForFunction(() => window.innerWidth <= 980);
        await verifyBounds();
        await native.hover("subtitle-style");
        await native.capture(".horizon/qa/player-tooltip-compact.png");
        await native.click("subtitle-style");
        await waitForPlayer((state) => state.controlsMenu === "style");
        await native.capture(".horizon/qa/player-style-compact.png");
        await native.key(27);
        await waitForPlayer((state) => !state.controlsMenu);
        await native.click("tracks");
        await waitForPlayer((state) => state.controlsMenu === "sub");
        await native.capture(".horizon/qa/player-tracks-compact.png");
        await native.key(27);
        await waitForPlayer((state) => !state.controlsMenu);
        await native.click("fullscreen");
        await waitForFullscreen(true);
        await page.waitForFunction(() => window.innerWidth > 980);
        await verifyBounds();
        await native.hover("tracks");
        await native.capture(".horizon/qa/player-tooltip-fullscreen.png");
        await native.click("tracks");
        await waitForPlayer((state) => state.controlsMenu === "sub");
        await native.capture(".horizon/qa/player-tracks-fullscreen.png");
        await native.key(27);
        await waitForPlayer((state) => !state.controlsMenu);
        await native.click("subtitle-style");
        await waitForPlayer((state) => state.controlsMenu === "style");
        await native.capture(".horizon/qa/player-style-fullscreen.png");
        await native.key(27);
        await waitForPlayer((state) => !state.controlsMenu);
        await native.click("fullscreen");
        await waitForFullscreen(false);
        await page.waitForFunction(() => window.innerWidth <= 980);
        await application.evaluate(({ BrowserWindow, screen }) => {
          const window = BrowserWindow.getAllWindows()[0];
          const { x, y, width, height } = screen.getDisplayMatching(
            window.getBounds(),
          ).workArea;
          window.setBounds({
            x: x + 20,
            y: y + 20,
            width: Math.min(2400, width - 40),
            height: Math.min(800, height - 40),
          });
        });
        await verifyBounds();
        await native.click("subtitle-style");
        await waitForPlayer((state) => state.controlsMenu === "style");
        await native.click("style-size-more");
        await expectSubtitleStyle({ subtitleSize: 40 });
        await native.capture(".horizon/qa/player-style-wide.png");
        await native.key(27);
        await waitForPlayer((state) => !state.controlsMenu);
        await native.click("tracks");
        await waitForPlayer((state) => state.controlsMenu === "sub");
        await native.capture(".horizon/qa/player-tracks-wide.png");
        await native.click("subtitle-off");
        await waitForPlayer(
          (state) =>
            !state.tracks.some(
              (track) => track.type === "sub" && track.selected,
            ),
        );
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(1440, 960),
        );
        await page.waitForFunction(() => window.innerWidth > 980);
        await verifyBounds();
        await native.key(32);
        await waitForPlayer((player) => !player.paused);
        await native.move(0.5, 0.5);
        await waitForPlayer((player) => !player.controlsVisible, 8000);
        await new Promise((resolve) => setTimeout(resolve, 550));
        await native.capture(".horizon/qa/player-hidden.png");
        await native.move(0.51, 0.5);
        await waitForPlayer((player) => player.controlsVisible);
        await native.click("pause");
        await waitForPlayer((player) => player.paused);
        console.log(
          "Embedded video remains aligned after resizing and fullscreen.",
        );
      }
    }
    if (native) {
      await native.click("back");
      await page.locator(".detail-page").waitFor();
      native.restoreCursor();
    } else
      await page
        .getByRole("button", { name: "Stop playback" })
        .evaluate((button) => button.click());
    const state = await page.evaluate(() => window.horizon.state());
    assert(
      state.history[`${items.serverId}:${item.id}`].position >= 7,
      "Stopping mpv should persist the resume point.",
    );
    await page.screenshot({ path: ".horizon/qa/resume.png" });
  }
  const state = await page.evaluate(() => window.horizon.state());
  assert(
    Object.values(state.history).some((p) => p.watched),
    "Watched history should be saved locally.",
  );
  assert(
    !("token" in state.settings) && !("tmdbKey" in state.settings),
    "Credentials must not be exposed to the renderer.",
  );
  assert.equal(failures.length, 0, failures.join("\n"));
  await application.close();
  application = undefined;
  const disk = JSON.parse(
    await readFile(path.join(userData, "state.json"), "utf8"),
  );
  assert(
    Object.keys(disk.history).length > 0,
    "History should survive app exit.",
  );
  application = await electron.launch({
    ...launchOptions,
    env,
    timeout: 30000,
  });
  const secondPage = await application.firstWindow();
  const restored = await secondPage.evaluate(() => window.horizon.state());
  assert.deepEqual(
    restored.history,
    disk.history,
    "Reopening the app should restore local history exactly.",
  );
  assert.deepEqual(
    restored.settings,
    state.settings,
    "Subtitle appearance should survive app exit.",
  );
  await application.close();
  application = undefined;
  console.log(
    `Desktop smoke passed with ${titles.length} library groups; screenshots saved in .horizon/qa.`,
  );
} finally {
  native?.restoreCursor();
  if (application) await application.close();
  await rm(userData, { recursive: true, force: true });
}
