import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRange } from "../src/server/range";
import { parseFilename } from "../src/shared/filenames";
import { defaultSubtitleStyle } from "../src/shared/subtitles";
import { mpvArguments } from "../src/desktop/player";
import { historyKey, type Settings } from "../src/shared/types";
import { artworkPalette, defaultPalette } from "../src/shared/palette";

test("ranges preserve requested original bytes and reject impossible requests", () => {
  assert.equal(parseRange(undefined, 100), undefined);
  assert.deepEqual(parseRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-5", 100), { start: 95, end: 99 });
  assert.deepEqual(parseRange("bytes=-500", 100), { start: 0, end: 99 });
  for (const header of [
    "bytes=100-",
    "bytes=8-3",
    "bytes=-0",
    "bytes=-",
    "bytes=1-3,6-9",
    "items=0-5",
    "bytes=999999999999999999-",
  ])
    assert.equal(parseRange(header, 100), "invalid");
  assert.equal(parseRange("bytes=0-", 0), "invalid");
});
test("movie names retain natural titles while removing release information", () => {
  assert.deepEqual(
    parseFilename("Extraction.2020.720p.NF.WEB-DL.Dual.Atmos.5.1.x264.mkv"),
    { title: "Extraction", year: 2020, kind: "movie" },
  );
  assert.equal(
    parseFilename("Dolby ATMOS Helicopter.m2ts").title,
    "Dolby ATMOS Helicopter",
  );
  assert.equal(
    parseFilename("THX Deep Note Genesis.4K.mkv").title,
    "THX Deep Note Genesis",
  );
  assert.equal(parseFilename("1917.mkv").year, undefined);
  assert.equal(
    parseFilename("2001 A Space Odyssey (1968).mkv").title,
    "2001 A Space Odyssey",
  );
});
test("series episodes group under a shared show name", () => {
  assert.deepEqual(
    parseFilename("You.S01E02.The.Last.Nice.Guy.1080p.WEB-DL.mkv"),
    { title: "You", kind: "episode", year: undefined, season: 1, episode: 2 },
  );
  assert.deepEqual(parseFilename("The.Show.2x03.mkv"), {
    title: "The Show",
    kind: "episode",
    year: undefined,
    season: 2,
    episode: 3,
  });
  assert.equal(
    parseFilename("S01E03.mkv", "Example Show/Season 1").title,
    "Example Show",
  );
});
test("original HDMI bitstream stays at normal speed and credentials never enter process arguments", () => {
  const settings: Settings = {
    ...defaultSubtitleStyle,
    serverUrl: "https://example.com",
    token: "secret-token",
    tmdbKey: "secret-key",
    mpvPath: "",
    watchName: "Guest",
    subtitleSize: 38,
    subtitleLanguage: "en",
    metadataLanguage: "en-US",
    autoUpdates: true,
  };
  const passthrough = mpvArguments("socket", settings);
  assert(passthrough.includes("--audio-spdif=ac3,eac3,truehd,dts,dts-hd"));
  assert(passthrough.includes("--audio-exclusive=yes"));
  assert(!passthrough.join(" ").includes("secret"));
  assert(passthrough.includes("--volume=100"));
  assert(passthrough.includes("--speed=1"));
  assert(passthrough.includes("--audio-device=auto"));
  assert.notEqual(
    historyKey("server-a", "media"),
    historyKey("server-b", "media"),
  );
  const embedded = mpvArguments("socket", settings, "123456");
  assert(embedded.includes("--wid=123456"));
  assert(embedded.includes("--force-window=no"));
  assert(embedded.includes("--osc=no"));
  assert(embedded.includes("--input-vo-keyboard=yes"));
  assert(embedded.includes("--sub-font=Inter"));
});

test("artwork themes use prominent cover colors and keep neutral covers readable", () => {
  const bitmap = new Uint8Array([
    0, 0, 190, 255, 0, 0, 190, 255, 180, 50, 5, 255, 255, 255, 255, 255, 0, 0,
    0, 255,
  ]);
  const palette = artworkPalette(bitmap);
  assert(
    palette.ambient[0] > palette.ambient[1] &&
      palette.ambient[0] > palette.ambient[2],
    "Red artwork should produce a red theme.",
  );
  assert(
    palette.accent.every((channel) => channel >= 158),
    "Accents must remain visible on dark surfaces.",
  );
  assert.deepEqual(
    artworkPalette(new Uint8Array([0, 0, 0, 255, 80, 80, 80, 255])),
    defaultPalette,
  );
});
