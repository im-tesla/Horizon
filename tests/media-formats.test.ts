import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBadges, resolution } from "../src/shared/media-formats";
import {
  defaultSubtitleStyle,
  subtitleProperties,
  subtitleStyleSchema,
} from "../src/shared/subtitles";
import type { MediaItem, MediaTrack } from "../src/shared/types";

const item = (tracks: MediaTrack[], filename = "Example.mkv"): MediaItem => ({
  id: "a".repeat(32),
  title: "Example",
  kind: "movie",
  filename,
  tracks,
  size: 1,
  modifiedAt: "",
  addedAt: "",
  subtitles: [],
});
test("resolution classes retain cropped widescreen video and probe facts override filename hints", () => {
  assert.equal(
    resolution(
      item([{ type: "video", codec: "h264", width: 1920, height: 952 }]),
    ),
    "1080p",
  );
  assert.equal(
    resolution(
      item([{ type: "video", codec: "hevc", width: 3840, height: 1600 }]),
    ),
    "4K",
  );
  assert.equal(
    resolution(
      item(
        [{ type: "video", codec: "h264", width: 1280, height: 536 }],
        "Example.2160p.mkv",
      ),
    ),
    "720p",
  );
  assert.equal(resolution(item([], "Example.2160p.mkv")), "4K");
  assert.equal(resolution(item([])), "");
});
test("Atmos badges require an inspected Dolby profile, and mixed audio advertises the available Atmos track", () => {
  const tracks: MediaTrack[] = [
    { type: "video", codec: "hevc", width: 3840, height: 2160 },
    {
      type: "audio",
      codec: "eac3",
      channels: 6,
      channelLayout: "5.1(side)",
      language: "hi",
    },
    {
      type: "audio",
      codec: "eac3",
      profile: "Dolby Digital Plus + Dolby Atmos",
      channels: 6,
      channelLayout: "5.1(side)",
      language: "en",
    },
  ];
  const badges = formatBadges(item(tracks));
  assert.deepEqual(
    badges.map((badge) => badge.label),
    ["4K", "H.265", "Atmos · 5.1"],
  );
  assert.match(badges[2].detail, /hi.*en/);
  assert.equal(
    formatBadges(item(tracks.slice(0, 2), "Fake.Atmos.5.1.mkv"))[2].label,
    "DD+ · 5.1",
  );
  assert.equal(
    formatBadges(item([{ type: "audio", codec: "aac", channels: 2 }]))[0].label,
    "Stereo",
  );
  assert.equal(
    formatBadges(
      item([
        {
          type: "audio",
          codec: "truehd",
          channels: 8,
          channelLayout: "7.1",
          profile: "Dolby TrueHD + Dolby Atmos",
        },
      ]),
    )[0].label,
    "Atmos · 7.1",
  );
  assert.equal(formatBadges(item([])).length, 0);
});
test("subtitle appearance rejects invalid fonts and ranges and applies styles to text subtitles", () => {
  assert(subtitleStyleSchema.safeParse(defaultSubtitleStyle).success);
  assert(
    !subtitleStyleSchema.partial().strict().safeParse({ subtitleSize: 200 })
      .success,
  );
  assert(
    !subtitleStyleSchema
      .partial()
      .strict()
      .safeParse({ subtitleFont: "unbundled" }).success,
  );
  assert(
    !subtitleStyleSchema.partial().strict().safeParse({ subtitleShadow: -1 })
      .success,
  );
  assert(
    !subtitleStyleSchema.partial().strict().safeParse({ speed: 2 }).success,
  );
  const style = subtitleProperties({
    ...defaultSubtitleStyle,
    subtitleFont: "Noto Serif",
    subtitleSize: 44,
    subtitleOutline: 2,
    subtitleShadow: 0,
    subtitleBackground: true,
  });
  assert.equal(style["sub-font"], "Noto Serif");
  assert.equal(style["sub-font-size"], 44);
  assert.equal(style["sub-shadow-offset"], 0);
  assert.equal(style["sub-border-style"], "background-box");
  assert.equal(style["sub-ass-override"], "force");
});
