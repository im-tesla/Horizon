import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
// @ts-expect-error Release scripts are shared directly with the Node publish job.
import { releaseAssets } from "../scripts/release-assets.mjs";

test("release detection handles first releases, tags, and multi-commit version bumps", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "horizon-release-test-"),
  );
  const script = path.resolve("scripts/release-version.mjs");
  const output = path.join(directory, "outputs");
  const eventFile = path.join(directory, "event.json");
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Horizon test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "Fixture",
    );
  };
  const run = async (
    event: Record<string, unknown> = {},
    environment: Record<string, string> = {},
  ) => {
    await writeFile(output, "");
    await writeFile(eventFile, JSON.stringify(event));
    await promisify(execFile)(process.execPath, [script], {
      cwd: directory,
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GITHUB_EVENT_PATH: eventFile,
        GITHUB_EVENT_NAME: "push",
        GH_TOKEN: "",
        ...environment,
      },
    });
    return readFile(output, "utf8");
  };
  try {
    git("init", "-b", "main");
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ version: "0.1.0" }),
    );
    commit();
    assert((await run()).includes("release=true"));
    git("tag", "v0.1.0");
    assert((await run()).includes("release=false"));
    const before = git("rev-parse", "HEAD");
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ version: "0.1.1" }),
    );
    commit();
    await writeFile(
      path.join(directory, "README.md"),
      "Another change in the same push",
    );
    commit();
    assert((await run({ before })).includes("release=true"));
    git("tag", "v0.1.1");
    assert((await run({ before })).includes("release=false"));
    const taggedCommit = git("rev-parse", "HEAD");
    await writeFile(
      path.join(directory, "README.md"),
      "Later docs, after the interrupted release",
    );
    commit();
    let draft = true;
    const api = createServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ draft }));
    });
    api.listen(0, "127.0.0.1");
    await once(api, "listening");
    try {
      const address = api.address();
      assert(address && typeof address === "object");
      const retry = {
        GH_TOKEN: "fixture-token",
        GITHUB_REPOSITORY: "fixture/horizon",
        GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        GITHUB_EVENT_NAME: "workflow_dispatch",
      };
      const output = await run({}, retry);
      assert(output.includes("release=true"));
      assert(
        output.includes(`commit=${taggedCommit}`),
        "Retry builds must use the draft's tagged commit.",
      );
      draft = false;
      assert((await run({}, retry)).includes("release=false"));
    } finally {
      await new Promise<void>((resolve) => api.close(() => resolve()));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("publishing requires a complete version-matched release with valid update hashes", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "horizon-assets-test-"),
  );
  const version = "1.2.3";
  const windows = `Horizon-${version}-windows-x64.exe`,
    appImage = `Horizon-${version}-linux-x86_64.AppImage`,
    deb = `Horizon-${version}-linux-amd64.deb`;
  const names = [
    windows,
    `${windows}.blockmap`,
    `Horizon-${version}-windows-x64-portable.exe`,
    appImage,
    deb,
    `horizon-server-${version}-linux-x64.tar.gz`,
  ];
  const bytes = Buffer.from("Release asset fixture");
  const hash = createHash("sha512").update(bytes).digest("base64");
  try {
    for (const name of names)
      await writeFile(path.join(directory, name), bytes);
    await writeFile(
      path.join(directory, "latest.yml"),
      `version: ${version}\nfiles:\n  - url: ${windows}\n    sha512: ${hash}\n`,
    );
    await writeFile(
      path.join(directory, "latest-linux.yml"),
      `version: ${version}\nfiles:\n  - url: ${appImage}\n    sha512: ${hash}\n  - url: ${deb}\n    sha512: ${hash}\n`,
    );
    assert.equal(releaseAssets(directory, version).length, 8);
    await writeFile(
      path.join(directory, "latest.yml"),
      `version: 1.2.2\nfiles:\n  - url: ${windows}\n    sha512: ${hash}\n`,
    );
    assert.throws(() => releaseAssets(directory, version), /does not match/);
    await writeFile(
      path.join(directory, "latest.yml"),
      `version: ${version}\nfiles:\n  - url: ${windows}\n    sha512: invalid\n`,
    );
    assert.throws(() => releaseAssets(directory, version), /does not describe/);
    await rm(path.join(directory, names[5]));
    assert.throws(
      () => releaseAssets(directory, version),
      /Required release asset/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
