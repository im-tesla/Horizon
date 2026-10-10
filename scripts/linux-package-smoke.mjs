import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron } from "playwright";

const run = promisify(execFile);
const installation = "/opt/Horizon";
const sandbox = await stat(path.join(installation, "chrome-sandbox"));
assert.equal(sandbox.uid, 0, "The sandbox must be owned by root.");
assert.equal(sandbox.gid, 0);
assert.equal(
  sandbox.mode & 0o7777,
  0o4755,
  "The installed sandbox must have mode 4755.",
);
const temporary = await mkdtemp(
  path.join(os.tmpdir(), "horizon-linux-package-"),
);
const token = "horizon-package-smoke-token";
const id = "0123456789abcdef0123456789abcdef";
let application;
let server;
try {
  const movie = path.join(temporary, "Package Test.mkv");
  await run("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=5.1",
    "-t",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "eac3",
    movie,
  ]);
  const bytes = await readFile(movie);
  let streamed = 0;
  const item = {
    id,
    kind: "movie",
    title: "Package Test",
    filename: "Package Test.mkv",
    size: bytes.length,
    modifiedAt: new Date().toISOString(),
    addedAt: new Date().toISOString(),
    duration: 30,
    tracks: [
      { type: "video", codec: "h264", width: 640, height: 360 },
      { type: "audio", codec: "eac3", channels: 6 },
    ],
    subtitles: [],
  };
  server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === "/api/library") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          serverId: "package-test",
          revision: 1,
          scanning: false,
          scannedAt: new Date().toISOString(),
          items: [item],
        }),
      );
    } else if (request.url === `/api/media/${id}`) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2]
        ? Math.min(Number(range[2]), bytes.length - 1)
        : bytes.length - 1;
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Type", "video/x-matroska");
      response.setHeader("Content-Length", end - start + 1);
      if (range)
        response.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
        });
      streamed++;
      response.end(bytes.subarray(start, end + 1));
    } else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = {
    ...process.env,
    HORIZON_USER_DATA: path.join(temporary, "profile"),
    HORIZON_MPV_TEST: "true",
    HORIZON_VIDEO_TEST: "true",
    HORIZON_MPV_PATH: "",
    LIBGL_ALWAYS_SOFTWARE: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath: path.join(installation, "horizon"),
    chromiumSandbox: true,
    args: [],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  async function waitForPlayer(predicate, timeout = 30000) {
    const deadline = Date.now() + timeout;
    let state;
    do {
      state = await page.evaluate(() => window.horizon.playerState());
      if (state.error) throw new Error(state.error);
      if (predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.fail(`Playback did not settle: ${JSON.stringify(state)}`);
  }
  await page.locator(".settings-page").waitFor();
  const renderer = await application.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    return {
      sandbox: contents.getLastWebPreferences().sandbox,
      pid: contents.getOSProcessId(),
    };
  });
  assert.equal(renderer.sandbox, true);
  assert.match(
    await readFile(`/proc/${renderer.pid}/status`, "utf8"),
    /^Seccomp:\s+2$/m,
    "The installed renderer must run with Chromium's seccomp sandbox.",
  );
  assert.equal(
    await application.evaluate(({ app }) =>
      app.commandLine.hasSwitch("no-sandbox"),
    ),
    false,
  );
  await page
    .getByLabel("Server address", { exact: true })
    .fill(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel("Access token", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.locator(".poster-card").first().click();
  await page.locator(".detail-actions .primary-button").click();
  await waitForPlayer(
    (state) => state.playing && state.position > 2 && state.controlsReady,
  );
  assert(
    streamed > 0,
    "Bundled mpv must stream the authenticated original file.",
  );
  const { stdout: processes } = await run("ps", ["-eo", "pid,args"]);
  const line = processes
    .split("\n")
    .find((line) => line.includes(`${installation}/resources/mpv/bin/mpv `));
  assert(line, "Playback must use the installed bundled mpv binary.");
  assert(line.includes("--wid="), "Playback must be embedded in Horizon.");
  const endpoint = /--input-ipc-server=(\S+)/.exec(line)?.[1];
  assert(endpoint);
  async function command(command) {
    return new Promise((resolve, reject) => {
      const socket = createConnection(endpoint);
      let buffer = "";
      socket.setTimeout(10000, () => {
        socket.destroy();
        reject(new Error("mpv IPC timeout"));
      });
      socket.on("error", reject);
      socket.on("connect", () =>
        socket.write(JSON.stringify({ command, request_id: 991 }) + "\n"),
      );
      socket.on("data", (chunk) => {
        buffer += chunk;
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) break;
          const response = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          if (response.request_id !== 991) continue;
          socket.end();
          if (response.error !== "success") reject(new Error(response.error));
          else resolve(response.data);
        }
      });
    });
  }
  assert.equal(await command(["get_property", "current-vo"]), "gpu-next");
  assert.equal(await command(["get_property", "vo-configured"]), true);
  assert.equal((await command(["get_property", "video-out-params"])).w, 640);
  assert.equal(
    await command(["get_property", "audio-spdif"]),
    "ac3,eac3,truehd,dts,dts-hd",
  );
  await page.evaluate(() => window.horizon.playerCommand("pause"));
  await waitForPlayer((state) => state.paused);
  await page.evaluate(() => window.horizon.playerCommand("seek", 8));
  await waitForPlayer((state) => Math.abs(state.position - 8) < 0.5);
  const metrics = await application.evaluate(({ app }) => app.getAppMetrics());
  assert(
    metrics.some((metric) => metric.type === "GPU"),
    "Chromium's GPU process must be running.",
  );
  await page.evaluate(() => window.horizon.playerCommand("stop"));
  console.log(
    "Installed Linux package passed: root-owned sandbox, sandboxed renderer, GPU process, bundled gpu-next video, DD+ decoding, embedded streaming, pause and seeking.",
  );
} finally {
  if (application) await application.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(temporary, { recursive: true, force: true });
}
