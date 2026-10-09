import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { extractRelease } from "./server-manager.mjs";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const directory = await mkdtemp(
  path.join(os.tmpdir(), "horizon-server-release-"),
);
let child;
try {
  const archive = path.resolve(
    `release-assets/horizon-server-${version}-linux-x64.tar.gz`,
  );
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
  assert(
    !entries
      .split("\n")
      .some((entry) =>
        /(^|\/)\.env$|node_modules\/(?:electron|koffi|react)(?:\/|$)/.test(
          entry,
        ),
      ),
    "The server archive must contain only server runtime files and no local configuration.",
  );
  await extractRelease(archive, directory, version);
  const runtime = path.join(directory, `horizon-server-${version}`);
  const manifest = JSON.parse(
    await readFile(path.join(runtime, "package.json"), "utf8"),
  );
  assert.equal(manifest.version, version);
  assert.equal(manifest.scripts.update, "node horizon-server.mjs update");
  assert.equal(manifest.scripts.rollback, "node horizon-server.mjs rollback");
  assert.equal(
    await readFile(path.join(runtime, "horizon-server.mjs"), "utf8"),
    await readFile("release-assets/horizon-server.mjs", "utf8"),
  );
  execFileSync(process.execPath, ["scripts/setup.mjs"], {
    cwd: runtime,
    stdio: "ignore",
  });
  const configuration = await readFile(path.join(runtime, ".env"), "utf8");
  assert.match(configuration, /HORIZON_TOKEN=[a-f0-9]{64}/);
  const media = path.join(directory, "media");
  await mkdir(media);
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const token = randomBytes(32).toString("hex");
  child = fork(path.join(runtime, "horizon-server.mjs"), ["start"], {
    cwd: runtime,
    env: {
      ...process.env,
      HORIZON_HOST: "127.0.0.1",
      HORIZON_PORT: String(port),
      HORIZON_TOKEN: token,
      HORIZON_MEDIA_DIR: media,
      HORIZON_DATA_DIR: path.join(directory, "data"),
      HORIZON_FFPROBE: process.execPath,
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true,
  });
  const url = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${token}` };
  const wait = async (check) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null)
        throw new Error("The archived server exited during startup.");
      try {
        if (await check()) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("The archived server did not become ready.");
  };
  await wait(async () => (await fetch(`${url}/api/health`)).ok);
  await wait(
    async () =>
      JSON.parse(
        await readFile(path.join(runtime, ".horizon/server-run.json"), "utf8"),
      ).ready,
  );
  assert.equal((await fetch(`${url}/api/library`)).status, 401);
  const payload = Buffer.from("Horizon original media bytes");
  await writeFile(path.join(media, "Release.Movie.2026.mp4"), payload);
  let item;
  await wait(async () => {
    const library = await (
      await fetch(`${url}/api/library`, { headers })
    ).json();
    item = library.items.find(
      (entry) => entry.filename === "Release.Movie.2026.mp4",
    );
    return !!item;
  });
  const response = await fetch(`${url}/api/media/${item.id}`, {
    headers: { ...headers, Range: "bytes=0-6" },
  });
  assert.equal(response.status, 206);
  assert(
    Buffer.from(await response.arrayBuffer()).equals(payload.subarray(0, 7)),
  );
  console.log(
    "Extracted server release starts with its own dependencies; setup, authentication, live folder watching, and original byte ranges passed.",
  );
} finally {
  if (child && child.exitCode === null) {
    const exit = once(child, "exit");
    child.send({ type: "horizon:stop" });
    await exit;
  }
  if (path.dirname(directory) !== os.tmpdir())
    throw new Error("Unsafe server test directory.");
  await rm(directory, { recursive: true, force: true });
}
