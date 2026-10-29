import assert from "node:assert/strict";

export async function checkVideoSettings(page, command) {
  const original = (await page.evaluate(() => window.horizon.state())).settings
    .forceDisableDolbyVision;
  const properties = [
    "pid",
    "pause",
    "audio-spdif",
    "audio-exclusive",
    "speed",
  ];
  const before = await Promise.all(
    properties.map((property) => command(["get_property", property])),
  );
  const position = await command(["get_property", "time-pos"]);
  const video = await command(["get_property", "video-out-params"]);
  assert.equal(before[1], true, "Run this check while playback is paused.");
  await assert.rejects(
    page.evaluate(() =>
      window.horizon.saveSettings({ forceDisableDolbyVision: "true" }),
    ),
  );
  await command(["vf", "add", "@horizon-video-settings-test:format"]);
  try {
    for (const enabled of [true, true, false, false, true]) {
      await page.evaluate(
        (forceDisableDolbyVision) =>
          window.horizon.saveSettings({ forceDisableDolbyVision }),
        enabled,
      );
      const filters = await command(["get_property", "vf"]);
      const selected = filters.filter(
        (filter) => filter.label === "horizon-dolby-vision",
      );
      assert.equal(selected.length, enabled ? 1 : 0);
      if (enabled) assert.equal(selected[0].params.dolbyvision, "no");
      assert(
        filters.some(
          (filter) => filter.label === "horizon-video-settings-test",
        ),
      );
      assert.equal(
        (await page.evaluate(() => window.horizon.state())).settings
          .forceDisableDolbyVision,
        enabled,
      );
      assert.deepEqual(
        await Promise.all(
          properties.map((property) => command(["get_property", property])),
        ),
        before,
        "Video preferences must preserve the playback process, pause and bitstream audio.",
      );
      assert(
        Math.abs((await command(["get_property", "time-pos"])) - position) <
          0.5,
      );
      const output = await command(["get_property", "video-out-params"]);
      for (const key of ["w", "h", "primaries", "gamma", "colorlevels"])
        assert.equal(
          output[key],
          video[key],
          `Video ${key} must be preserved.`,
        );
    }
  } finally {
    await page.evaluate(
      (forceDisableDolbyVision) =>
        window.horizon.saveSettings({ forceDisableDolbyVision }),
      original,
    );
    await command(["vf", "remove", "@horizon-video-settings-test"]);
  }
}
