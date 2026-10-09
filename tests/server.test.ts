import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  rename,
  symlink,
  readFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server/app";
import { MediaLibrary } from "../src/server/library";

const token = "test-only-token-with-more-than-24-characters";
test("library orders a series numerically across differently capitalized filenames", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "horizon-episode-order-"),
  );
  const mediaDir = path.join(directory, "media");
  await mkdir(mediaDir);
  const names = [
    "You.S05E06.mkv",
    "YOU.S05E07.mkv",
    "You.S05E08.mkv",
    "you.S05E01.mkv",
    "you.S05E02.mkv",
    "you.S05E10.mkv",
    "You.S02E01.mkv",
  ];
  await Promise.all(
    names.map((name) => writeFile(path.join(mediaDir, name), "fixture")),
  );
  const library = new MediaLibrary({
    mediaDir,
    dataDir: path.join(directory, "data"),
    ffprobe: "nonexistent-test-ffprobe",
  });
  try {
    await library.start();
    assert.deepEqual(
      library.snapshot().items.map((item) => `${item.season}:${item.episode}`),
      ["2:1", "5:1", "5:2", "5:6", "5:7", "5:8", "5:10"],
    );
  } finally {
    await library.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("upgrading inspection cache re-probes files without changing media IDs or added dates", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "horizon-probe-upgrade-"),
  );
  const mediaDir = path.join(directory, "media"),
    dataDir = path.join(directory, "data");
  await mkdir(mediaDir);
  await writeFile(path.join(mediaDir, "Example.2020.mkv"), "fixture");
  const options = { mediaDir, dataDir, ffprobe: "nonexistent-test-ffprobe" };
  const first = new MediaLibrary(options);
  let second: MediaLibrary | undefined;
  try {
    await first.start();
    const before = first.snapshot();
    await first.close();
    const cachePath = path.join(dataDir, "index.json");
    const legacy = JSON.parse(await readFile(cachePath, "utf8"));
    legacy.probeVersion = 1;
    legacy.items[0].item.tracks = [
      { type: "audio", codec: "eac3", channels: 6 },
    ];
    await writeFile(cachePath, JSON.stringify(legacy));
    second = new MediaLibrary(options);
    await second.start();
    const after = second.snapshot();
    assert.equal(after.serverId, before.serverId);
    assert.equal(after.items[0].id, before.items[0].id);
    assert.equal(after.items[0].addedAt, before.items[0].addedAt);
    assert.deepEqual(
      after.items[0].tracks,
      [],
      "The old fingerprint must not bypass the new inspection.",
    );
    const updated = JSON.parse(await readFile(cachePath, "utf8"));
    assert.equal(updated.probeVersion, 2);
  } finally {
    await first.close();
    await second?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("authenticated streaming supports seek, HEAD, and exact original data", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "horizon-server-test-"),
  );
  const mediaDir = path.join(directory, "media");
  await mkdir(mediaDir);
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  await writeFile(path.join(mediaDir, "Example.2020.mkv"), bytes);
  await writeFile(
    path.join(mediaDir, "Example.2020.en.srt"),
    "1\n00:00:01,000 --> 00:00:02,000\nHello\n",
  );
  const { app } = await createServer({
    mediaDir,
    dataDir: path.join(directory, "data"),
    token,
    ffprobe: "nonexistent-test-ffprobe",
  });
  try {
    assert.equal((await app.inject("/api/health")).statusCode, 200);
    assert.equal((await app.inject("/api/library")).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          url: "/api/library",
          headers: { authorization: "Bearer wrong" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (await app.inject(`/api/library?token=${token}`)).statusCode,
      401,
    );
    const headers = { authorization: `Bearer ${token}` };
    const response = await app.inject({ url: "/api/library", headers });
    const library = response.json();
    assert.equal(library.items.length, 1);
    assert(!response.body.includes(mediaDir));
    assert(!response.body.includes(token));
    const item = library.items[0],
      url = `/api/media/${item.id}`;
    const full = await app.inject({ url, headers });
    assert.equal(full.statusCode, 200);
    assert.deepEqual(full.rawPayload, bytes);
    const range = await app.inject({
      url,
      headers: { ...headers, range: "bytes=20-49" },
    });
    assert.equal(range.statusCode, 206);
    assert.equal(range.headers["content-range"], "bytes 20-49/256");
    assert.deepEqual(range.rawPayload, bytes.subarray(20, 50));
    const suffix = await app.inject({
      url,
      headers: { ...headers, range: "bytes=-8" },
    });
    assert.deepEqual(suffix.rawPayload, bytes.subarray(248));
    const head = await app.inject({ method: "HEAD", url, headers });
    assert.equal(head.statusCode, 200);
    assert.equal(head.headers["content-length"], "256");
    assert.equal(head.body, "");
    const invalid = await app.inject({
      url,
      headers: { ...headers, range: "bytes=999-" },
    });
    assert.equal(invalid.statusCode, 416);
    assert.equal(invalid.headers["content-range"], "bytes */256");
    const stale = await app.inject({
      url,
      headers: { ...headers, range: "bytes=1-2", "if-range": '"stale"' },
    });
    assert.equal(stale.statusCode, 200);
    assert.deepEqual(stale.rawPayload, bytes);
    assert.equal(
      (await app.inject({ url: "/api/media/nonexistent", headers })).statusCode,
      404,
    );
    const sub = await app.inject({
      url: `/api/subtitles/${item.id}/${item.subtitles[0].id}`,
      headers,
    });
    assert.equal(sub.statusCode, 200);
    assert(sub.body.includes("Hello"));
    assert.equal(
      (await app.inject(`/api/subtitles/${item.id}/${item.subtitles[0].id}`))
        .statusCode,
      401,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "folder watcher finds additions, renamed episodes, and deletions without restart",
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "horizon-watch-test-"),
    );
    const mediaDir = path.join(directory, "media");
    await mkdir(mediaDir);
    const library = new MediaLibrary({
      mediaDir,
      dataDir: path.join(directory, "data"),
      ffprobe: "nonexistent-test-ffprobe",
    });
    const waitFor = async (check: () => boolean) => {
      const end = Date.now() + 6500;
      while (!check()) {
        if (Date.now() > end)
          throw new Error("Folder watcher did not update the library.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    try {
      await library.start();
      assert.equal(library.snapshot().items.length, 0);
      // Chokidar is ready before the file is added.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const first = path.join(mediaDir, "Show.S01E01.mkv");
      await writeFile(first, "media");
      await waitFor(() => library.snapshot().items.length === 1);
      const initialId = library.snapshot().items[0].id;
      assert.equal(library.snapshot().items[0].episode, 1);
      const second = path.join(mediaDir, "Show.S01E02.mkv");
      await rename(first, second);
      await waitFor(
        () =>
          library.snapshot().items.length === 1 &&
          library.snapshot().items[0].episode === 2,
      );
      assert.notEqual(library.snapshot().items[0].id, initialId);
      await rm(second);
      await waitFor(() => library.snapshot().items.length === 0);
      const outside = path.join(directory, "outside.mkv");
      await writeFile(outside, "private");
      try {
        await symlink(outside, path.join(mediaDir, "linked.mkv"));
        await library.scan();
        assert.equal(library.snapshot().items.length, 0);
      } catch (error: any) {
        if (error.code !== "EPERM") throw error;
      }
    } finally {
      await library.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
