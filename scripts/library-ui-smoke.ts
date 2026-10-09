import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import electronPath from "electron";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "../src/server/app";
import type { MediaItem } from "../src/shared/types";

const directory = await mkdtemp(path.join(os.tmpdir(), "horizon-library-ui-"));
const token = randomUUID();
let application: ElectronApplication | undefined;
const { app: server, library } = await createServer({
  mediaDir: path.join(directory, "media"),
  dataDir: path.join(directory, "server"),
  token,
  ffprobe: "nonexistent-test-ffprobe",
});
const titles = [
  "Joe Takes a Holiday",
  "Portrait of the Artist",
  "Episode Three",
  "Episode Four",
  "Episode Five",
  "Best of Friends",
  "Good Man, Cruel World",
  "Where Are You Going?",
  "Episode Nine",
  "Episode Ten",
];
const item = (season: number, episode: number): MediaItem => ({
  id: (season * 1000 + episode).toString(16).padStart(32, "0"),
  title: episode % 2 ? "You" : "you",
  kind: "episode",
  season,
  episode,
  filename: `You.S${season}E${episode}.1080p.mkv`,
  size: 1024 ** 3,
  addedAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
  duration: 2700,
  tracks: [
    { type: "video", codec: "hevc", width: 1920, height: 1080 },
    {
      type: "audio",
      codec: "eac3",
      profile: "Dolby Digital Plus + Dolby Atmos",
      channels: 6,
    },
  ],
  subtitles: [],
});
// Deliberately reproduce the old server's out-of-order response. The client
// must fix the order independently, including when the server has not updated.
const items = [6, 7, 8, 1, 2, 10, 9, 3, 5, 4].map((number) => item(5, number));
items.push(
  ...[15, 10, 2, 1, 0, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14].map((season) =>
    item(season, 1),
  ),
);
const snapshot = library.snapshot.bind(library);
library.snapshot = () => ({ ...snapshot(), items });

const fitMenu = async (page: Page, name: string) => {
  await page.waitForTimeout(180);
  const bounds = await page.evaluate((name) => {
    const trigger = document
      .querySelector(`[role="combobox"][aria-label="${name}"]`)!
      .getBoundingClientRect();
    const menu = document
      .querySelector(".dropdown-menu")!
      .getBoundingClientRect();
    const style = getComputedStyle(document.querySelector(".dropdown-menu")!);
    return {
      trigger: trigger.toJSON(),
      menu: menu.toJSON(),
      width: innerWidth,
      height: innerHeight,
      radius: style.borderRadius,
      background: style.backgroundColor,
    };
  }, name);
  assert(bounds.menu.left >= 11 && bounds.menu.right <= bounds.width - 11);
  assert(bounds.menu.top >= 11 && bounds.menu.bottom <= bounds.height - 11);
  assert(
    Math.min(
      Math.abs(bounds.menu.top - bounds.trigger.bottom - 6),
      Math.abs(bounds.trigger.top - bounds.menu.bottom - 6),
    ) < 2,
    "The menu must sit next to its trigger.",
  );
  assert.equal(bounds.radius, "10px");
  assert.notEqual(bounds.background, "rgba(0, 0, 0, 0)");
};

try {
  const url = await server.listen({ host: "127.0.0.1", port: 0 });
  const userData = path.join(directory, "client");
  await mkdir(userData);
  await writeFile(
    path.join(userData, "state.json"),
    JSON.stringify({
      settings: { serverUrl: url, autoUpdates: false },
      secrets: { token: `local:${Buffer.from(token).toString("base64")}` },
      metadata: {
        "tv:you:": {
          tmdbId: 1,
          kind: "tv",
          title: "You",
          overview: "A regression fixture for episode ordering and app menus.",
          episodes: Object.fromEntries(
            titles.map((title, index) => [
              `5:${index + 1}`,
              { title, overview: "Episode ordering regression fixture." },
            ]),
          ),
        },
      },
    }),
  );
  const env = {
    ...process.env,
    HORIZON_USER_DATA: userData,
    HORIZON_SERVER_URL: url,
    HORIZON_TOKEN: token,
    TMDB_API_KEY: "",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.HORIZON_DEV_URL;
  application = await electron.launch({
    executablePath: process.env.HORIZON_TEST_EXECUTABLE || String(electronPath),
    args: process.env.HORIZON_TEST_EXECUTABLE ? [] : ["."],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByText("Server connected", { exact: true }).waitFor();
  await page.locator(".poster-card").first().click();
  const season = page.getByRole("combobox", { name: "Season", exact: true });
  await season.waitFor();
  assert.equal(await page.locator("select").count(), 0);
  assert.match(
    await page.locator(".detail-actions .primary-button").innerText(),
    /S00 E01/,
    "Watch now starts with the earliest season and episode.",
  );
  await season.click();
  assert.deepEqual(await page.getByRole("option").allTextContents(), [
    "Specials",
    ...Array.from({ length: 15 }, (_, index) => `Season ${index + 1}`),
  ]);
  await fitMenu(page, "Season");
  await page.getByRole("option", { name: "Season 5", exact: true }).click();
  assert.deepEqual(
    await page.locator(".episode-copy strong").allTextContents(),
    titles.map((title, index) => `${index + 1}. ${title}`),
  );
  await mkdir(".horizon/qa", { recursive: true });
  await page.screenshot({ path: ".horizon/qa/dropdowns-episodes.png" });
  await season.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  assert.equal(await season.innerText(), "Season 15");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  assert.equal(await season.innerText(), "Specials");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator(".detail-page").count(),
    1,
    "Escape closes the menu without leaving the page.",
  );
  assert.equal(await page.getByRole("listbox").count(), 0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const language = page.getByRole("combobox", {
    name: "Metadata language",
    exact: true,
  });
  await language.click();
  await fitMenu(page, "Metadata language");
  assert.equal(
    await page.getByRole("option", { selected: true }).innerText(),
    "English",
  );
  await page.screenshot({ path: ".horizon/qa/dropdowns-settings.png" });
  await page.keyboard.press("p");
  await page.keyboard.press("Enter");
  assert.equal(await language.innerText(), "Polski");
  await language.click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".settings-page").count(), 1);
  await language.click();
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("listbox").count(), 0);
  assert.equal(
    await page.evaluate(() => document.activeElement?.tagName),
    "INPUT",
    "Tab must move focus to the next setting.",
  );
  await language.click();
  await page.getByRole("heading", { name: "Settings", exact: true }).click();
  assert.equal(
    await page.getByRole("listbox").count(),
    0,
    "Outside clicks close the menu.",
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(980, 680),
  );
  await language.click();
  await fitMenu(page, "Metadata language");
  await page.screenshot({ path: ".horizon/qa/dropdowns-compact.png" });
  await page.keyboard.press("Escape");
  await language.evaluate((trigger) => {
    const scroll = document.querySelector(".settings-content")!;
    scroll.scrollTop +=
      trigger.getBoundingClientRect().top - (innerHeight - 170);
  });
  await page.waitForTimeout(100);
  await language.click();
  await fitMenu(page, "Metadata language");
  assert(
    await page
      .getByRole("listbox")
      .evaluate(
        (menu) =>
          menu.getBoundingClientRect().bottom <
          document
            .querySelector('[role="combobox"][aria-label="Metadata language"]')!
            .getBoundingClientRect().top,
      ),
    "Menus must open above a trigger near the bottom of the window.",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Watch together", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create a room", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose episodes of You", exact: true })
    .click();
  const picker = page.getByRole("region", {
    name: "Choose something to watch",
    exact: true,
  });
  await picker.getByRole("button", { name: "Season 5", exact: true }).click();
  assert.deepEqual(
    await picker.locator(".picker-episode-copy strong").allTextContents(),
    titles.map((title, index) => `${index + 1}. ${title}`),
  );
  assert.equal(await page.locator("select").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Desktop dropdown keyboard, layout, and episode ordering checks passed.",
  );
} finally {
  await application?.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
