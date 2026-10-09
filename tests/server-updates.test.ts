import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
// @ts-expect-error The updater is a standalone, dependency-free release script.
import * as updater from "../scripts/server-manager.mjs";
const {
  currentInstallation,
  updateServer,
  rollbackServer,
  latestServerRelease,
  compareVersions,
  extractRelease,
} = updater;

const manager = path.resolve("scripts/server-manager.mjs");
const wait = async (check: () => Promise<boolean>, label: string) => {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(label);
};
const manifest = (version: string) =>
  JSON.stringify({
    name: "horizon-server",
    version,
    type: "module",
    scripts: { start: "node dist/server/index.mjs" },
  });
async function fixture(
  directory: string,
  version: string,
  failOnPort?: number,
  legacyReady = false,
) {
  await mkdir(path.join(directory, "dist/server"), { recursive: true });
  await mkdir(path.join(directory, "node_modules/fastify"), {
    recursive: true,
  });
  await writeFile(path.join(directory, "package.json"), manifest(version));
  await writeFile(
    path.join(directory, "node_modules/fastify/package.json"),
    "{}",
  );
  await copyFile(manager, path.join(directory, "horizon-server.mjs"));
  await writeFile(
    path.join(directory, "dist/server/index.mjs"),
    `
    import http from 'node:http';
    import path from 'node:path';
    import { readFileSync } from 'node:fs';
    if (Number(process.env.HORIZON_PORT) === ${failOnPort ?? -1}) throw new Error('Fixture configuration rejected');
    const server = http.createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(request.url === '/api/health' ? {status:'ok'} : {
        version: ${JSON.stringify(version)}, cwd: process.cwd(),
        media: readFileSync(path.join(process.cwd(), 'media/movie.mp4'), 'utf8'),
      }));
    });
    server.listen(Number(process.env.HORIZON_PORT), '127.0.0.1', () => ${legacyReady ? "console.log(JSON.stringify({msg:'Server listening at http://127.0.0.1'}))" : "process.send?.({type:'horizon:ready'})"});
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `,
  );
}
async function release(
  directory: string,
  version: string,
  failOnPort?: number,
) {
  const root = path.join(directory, `horizon-server-${version}`);
  await fixture(root, version, failOnPort);
  const archive = path.join(directory, `server-${version}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", directory, path.basename(root)]);
  const bytes = await readFile(archive);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const name = `horizon-server-${version}-linux-x64.tar.gz`;
  const base = `https://github.com/im-tesla/Horizon/releases/download/v${version}/`;
  const info = {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name,
        size: bytes.length,
        digest: `sha256:${checksum}`,
        browser_download_url: base + name,
      },
      { name: "SHA256SUMS", browser_download_url: base + "SHA256SUMS" },
    ],
  };
  const fetcher = async (url: string) =>
    new Response(
      url.endsWith("/latest")
        ? JSON.stringify(info)
        : url.endsWith("/SHA256SUMS")
          ? `${checksum}  ${name}\n`
          : bytes,
    );
  return { info, bytes, archive, fetcher };
}

test("server updates restart and roll back while keeping media, configuration, and library identity in place", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "horizon-server-updates-"),
  );
  const root = path.join(directory, "permanent server folder");
  await fixture(root, "1.0.0", undefined, true);
  await mkdir(path.join(root, "media"));
  await mkdir(path.join(root, ".horizon/server"), { recursive: true });
  const preserved = {
    ".env":
      "HORIZON_MEDIA_DIR=./media\nHORIZON_TOKEN=fixture-kept-secret-token\n",
    "media/movie.mp4": "original quality movie bytes",
    ".horizon/server/identity": "permanent-library-id",
    ".horizon/server/index.json": '{"cached":"inspection"}',
  };
  for (const [file, bytes] of Object.entries(preserved))
    await writeFile(path.join(root, file), bytes);
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const child = fork(path.join(root, "horizon-server.mjs"), ["start"], {
    cwd: root,
    env: { ...process.env, HORIZON_PORT: String(port) },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true,
  });
  const endpoint = `http://127.0.0.1:${port}`;
  const version = async () => {
    try {
      return (await (await fetch(endpoint)).json()).version;
    } catch {
      return undefined;
    }
  };
  try {
    await wait(
      async () => (await version()) === "1.0.0",
      "The initial server must start.",
    );
    const next = await release(directory, "1.1.0");
    const updated = await updateServer(root, {
      fetch: next.fetcher,
      restartTimeout: 10000,
      readyTimeout: 3000,
    });
    assert.equal(updated.version, "1.1.0");
    assert.equal(updated.restarted, true);
    assert.equal(await version(), "1.1.0");
    const active = await (await fetch(endpoint)).json();
    assert.equal(
      active.cwd,
      root,
      "Relative media paths must stay rooted in the permanent folder.",
    );
    assert.equal(active.media, preserved["media/movie.mp4"]);
    assert.equal((await currentInstallation(root)).previous.directory, ".");
    const launcher = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    );
    assert.equal(launcher.scripts.start, "node horizon-server.mjs start");
    assert.equal(launcher.scripts.update, "node horizon-server.mjs update");
    const unchanged = await updateServer(root, { fetch: next.fetcher });
    assert.equal(unchanged.updated, false);
    const restored = await rollbackServer(root, { restartTimeout: 10000 });
    assert.equal(restored.version, "1.0.0");
    assert.equal(restored.restarted, true);
    assert.equal(await version(), "1.0.0");
    const broken = await release(directory, "1.2.0", port);
    await assert.rejects(
      updateServer(root, {
        fetch: broken.fetcher,
        restartTimeout: 10000,
        readyTimeout: 3000,
      }),
      /previous version was restored/,
    );
    assert.equal((await currentInstallation(root)).current.version, "1.0.0");
    await wait(
      async () => (await version()) === "1.0.0",
      "A rejected live update must restart the previous server.",
    );
    const corruptFetch = async (url: string) =>
      url.endsWith(".tar.gz")
        ? new Response(Buffer.alloc(broken.bytes.length))
        : broken.fetcher(url);
    await assert.rejects(
      updateServer(root, { fetch: corruptFetch }),
      /checksum check/,
    );
    assert.equal(await version(), "1.0.0");
    for (const [file, bytes] of Object.entries(preserved))
      assert.equal(await readFile(path.join(root, file), "utf8"), bytes);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.send({ type: "horizon:stop" });
      await exited;
    }
    assert.equal(path.dirname(directory), os.tmpdir());
    await rm(directory, { recursive: true, force: true });
  }
});

test("server update checks require official stable assets and numeric versions", async () => {
  assert(compareVersions("1.10.0", "1.9.9") > 0);
  assert(compareVersions("1.2.3", "1.2.3") === 0);
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "horizon-server-feed-"),
  );
  try {
    const next = await release(directory, "1.2.3");
    assert.equal((await latestServerRelease(next.fetcher)).version, "1.2.3");
    const rejected = (patch: object) =>
      latestServerRelease(
        async () => new Response(JSON.stringify({ ...next.info, ...patch })),
      );
    await assert.rejects(rejected({ prerelease: true }), /stable/);
    await assert.rejects(rejected({ assets: [] }), /complete/);
    await assert.rejects(
      rejected({
        assets: [
          {
            ...next.info.assets[0],
            browser_download_url: "https://example.invalid/server.tar.gz",
          },
          next.info.assets[1],
        ],
      }),
      /complete/,
    );
    await mkdir(path.join(directory, "extracted"));
    await writeFile(
      path.join(directory, "horizon-server-1.2.3/.env"),
      "must not replace user settings",
    );
    const unsafe = path.join(directory, "unsafe.tar.gz");
    execFileSync("tar", [
      "-czf",
      unsafe,
      "-C",
      directory,
      "horizon-server-1.2.3",
    ]);
    await assert.rejects(
      extractRelease(unsafe, path.join(directory, "extracted"), "1.2.3"),
      /unsafe paths or user data/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
