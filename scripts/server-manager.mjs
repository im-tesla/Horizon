#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFile, fork } from "node:child_process";
import { once } from "node:events";
import {
  open,
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  realpath,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const stable = /^\d+\.\d+\.\d+$/;
const control = (root, name) => path.join(root, ".horizon", `server-${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
async function json(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
async function atomic(file, contents) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
const save = (file, value) =>
  atomic(file, JSON.stringify(value, null, 2) + "\n");
async function lock(root, name) {
  await mkdir(path.join(root, ".horizon"), { recursive: true });
  const file = control(root, `${name}.lock`);
  const owner = { pid: process.pid, id: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, "wx", 0o600);
      await handle.writeFile(JSON.stringify(owner));
      await handle.close();
      return async () => {
        if ((await json(file))?.id === owner.id)
          await rm(file, { force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const previous = await json(file);
      if (!previous?.pid || alive(previous.pid))
        throw new Error(`Another server ${name} command is already running.`);
      if ((await json(file))?.id === previous.id)
        await rm(file, { force: true });
    }
  }
  throw new Error(`Could not acquire the server ${name} lock.`);
}
function reference(value) {
  if (
    !value ||
    !stable.test(value.version) ||
    (value.directory !== "." &&
      !new RegExp(
        `^\\.horizon/releases/${value.version.replaceAll(".", "\\.")}-[a-f0-9-]{36}$`,
      ).test(value.directory))
  )
    throw new Error("Invalid server installation record.");
  return value;
}
export async function currentInstallation(root) {
  const bootstrap = await json(path.join(root, "package.json"));
  if (bootstrap?.name !== "horizon-server" || !stable.test(bootstrap.version))
    throw new Error("Run this command in an extracted Horizon server folder.");
  const state = (await json(control(root, "install.json"))) ?? {
    current: { version: bootstrap.version, directory: "." },
  };
  reference(state.current);
  if (state.previous) reference(state.previous);
  if (state.rollbackPrevious) reference(state.rollbackPrevious);
  return state;
}
async function runtime(root, ref) {
  reference(ref);
  const directory = await realpath(path.resolve(root, ref.directory));
  const base = await realpath(root);
  if (directory !== base && !directory.startsWith(base + path.sep))
    throw new Error(
      "The server release points outside its installation folder.",
    );
  const manifest = await json(path.join(directory, "package.json"));
  if (manifest?.name !== "horizon-server" || manifest.version !== ref.version)
    throw new Error(
      "The server release version does not match its installation record.",
    );
  await readFile(path.join(directory, "dist/server/index.mjs"));
  return directory;
}
export function compareVersions(a, b) {
  if (!stable.test(a) || !stable.test(b))
    throw new Error("Invalid stable server version.");
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}
export async function latestServerRelease(fetcher = fetch) {
  const response = await fetcher(
    "https://api.github.com/repos/im-tesla/Horizon/releases/latest",
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Horizon-server-updater",
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Could not check GitHub Releases (HTTP ${response.status}). Try again later.`,
    );
  const release = await response.json();
  const version = release.tag_name?.replace(/^v/, "");
  if (!stable.test(version ?? "") || release.draft || release.prerelease)
    throw new Error("GitHub did not return a stable Horizon release.");
  const name = `horizon-server-${version}-linux-x64.tar.gz`;
  const asset = release.assets?.find((item) => item.name === name);
  const sums = release.assets?.find((item) => item.name === "SHA256SUMS");
  const base = `https://github.com/im-tesla/Horizon/releases/download/v${version}/`;
  if (
    !asset ||
    !sums ||
    asset.browser_download_url !== base + name ||
    sums.browser_download_url !== base + "SHA256SUMS" ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > 128 * 1024 ** 2
  )
    throw new Error(
      "This release does not contain a complete Linux x64 server update.",
    );
  return { version, asset, sums };
}
async function download(release, destination, fetcher) {
  const checksumResponse = await fetcher(release.sums.browser_download_url, {
    signal: AbortSignal.timeout(30000),
  });
  if (!checksumResponse.ok)
    throw new Error("Could not download the release checksums.");
  const sums = await checksumResponse.text();
  if (sums.length > 128 * 1024)
    throw new Error("The release checksum file is too large.");
  const lines = sums
    .split(/\r?\n/)
    .filter((line) => line.slice(66) === release.asset.name);
  if (lines.length !== 1 || !/^[a-f0-9]{64}  /.test(lines[0]))
    throw new Error("The release has no valid server checksum.");
  const expected = lines[0].slice(0, 64);
  if (release.asset.digest && release.asset.digest !== `sha256:${expected}`)
    throw new Error("GitHub's server checksum disagrees with SHA256SUMS.");
  const response = await fetcher(release.asset.browser_download_url, {
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok || !response.body)
    throw new Error("Could not download the server update.");
  const handle = await open(destination, "wx", 0o600);
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > release.asset.size)
        throw new Error("The server download is larger than expected.");
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
  } finally {
    await handle.close();
  }
  if (size !== release.asset.size || hash.digest("hex") !== expected)
    throw new Error(
      "The server download failed its checksum check. Your installed server was kept.",
    );
}
export async function extractRelease(archive, destination, version) {
  if (!stable.test(version)) throw new Error("Invalid stable server version.");
  const top = `horizon-server-${version}`;
  const { stdout } = await execute("tar", ["-tzf", archive], {
    maxBuffer: 8 * 1024 ** 2,
    windowsHide: true,
  });
  const entries = stdout.trim().split(/\r?\n/);
  if (
    !entries.length ||
    entries.some((entry) => {
      const parts = entry.replace(/^\.\//, "").split("/");
      return (
        parts[0] !== top ||
        parts.includes("..") ||
        entry.includes("\\") ||
        [".env", ".horizon", "media"].includes(parts[1])
      );
    })
  )
    throw new Error("The server archive contains unsafe paths or user data.");
  const { stdout: detailed } = await execute("tar", ["-tvzf", archive], {
    maxBuffer: 8 * 1024 ** 2,
    windowsHide: true,
  });
  if (
    detailed
      .trim()
      .split(/\r?\n/)
      .some((line) => {
        const member = line.slice(line.indexOf(top + "/")).split(" -> ")[0];
        return (
          !["-", "d"].includes(line[0]) &&
          !(line[0] === "l" && member.startsWith(`${top}/node_modules/.bin/`))
        );
      })
  )
    throw new Error(
      "The server archive contains an unsupported link or special file.",
    );
  // Node loads packages directly; npm's command symlinks are not needed at runtime.
  await execute(
    "tar",
    [
      "-xzf",
      archive,
      "--exclude",
      `${top}/node_modules/.bin`,
      "-C",
      destination,
    ],
    { windowsHide: true },
  );
  const directory = path.join(destination, top);
  const manifest = await json(path.join(directory, "package.json"));
  if (manifest?.name !== "horizon-server" || manifest.version !== version)
    throw new Error("The downloaded server package has the wrong version.");
  await Promise.all(
    [
      "dist/server/index.mjs",
      "horizon-server.mjs",
      "node_modules/fastify/package.json",
    ].map((file) => readFile(path.join(directory, file))),
  );
  return directory;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}
async function boot(root, directory, options = {}) {
  const child = fork(path.join(directory, "dist/server/index.mjs"), [], {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  options.onChild?.(child);
  let lines = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("The new server did not become ready.")),
        options.readyTimeout ?? 30000,
      );
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("The new server exited before it was ready."));
      });
      child.on("message", (message) => {
        if (message?.type === "horizon:ready") finish();
      });
      child.stdout.on("data", (chunk) => {
        if (!options.quiet) process.stdout.write(chunk);
        lines = (lines + chunk.toString()).slice(-32768);
        const records = lines.split("\n");
        lines = records.pop();
        for (const line of records) {
          try {
            if (JSON.parse(line).msg?.startsWith("Server listening at "))
              finish();
          } catch {}
        }
      });
      child.stderr.on("data", (chunk) => {
        if (!options.quiet) process.stderr.write(chunk);
      });
    });
    return child;
  } catch (error) {
    await stop(child);
    throw error;
  }
}
async function preflight(root, directory, readyTimeout) {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "horizon-server-preflight-"),
  );
  let child;
  try {
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    child = await boot(root, directory, {
      quiet: true,
      readyTimeout,
      env: {
        HORIZON_TOKEN: randomUUID(),
        HORIZON_HOST: "127.0.0.1",
        HORIZON_PORT: String(port),
        HORIZON_MEDIA_DIR: path.join(temporary, "media"),
        HORIZON_DATA_DIR: path.join(temporary, "data"),
      },
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || (await response.json()).status !== "ok")
      throw new Error("The new server failed its startup check.");
  } finally {
    if (child) await stop(child);
    if (path.dirname(temporary) !== os.tmpdir())
      throw new Error("Unsafe preflight directory.");
    await rm(temporary, { recursive: true, force: true });
  }
}
async function running(root) {
  const run = await json(control(root, "run.json"));
  return run && alive(run.pid) ? run : undefined;
}
async function activate(root, before, after, timeout = 45000) {
  const supervisor = await running(root);
  await save(control(root, "install.json"), after);
  if (!supervisor) return false;
  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const run = await running(root);
      if (!run || run.id !== supervisor.id)
        throw new Error("The server stopped while applying the update.");
      if (run.failedDirectory === after.current.directory)
        throw new Error(
          "The new server could not start with your settings. The previous version was restored.",
        );
      if (run.ready && run.directory === after.current.directory) return true;
      await sleep(100);
    }
    throw new Error(
      "The server did not confirm the update. The previous version was restored.",
    );
  } catch (error) {
    await save(control(root, "install.json"), before);
    throw error;
  }
}
async function launcher(root, directory) {
  const manifest = await json(path.join(root, "package.json"));
  // Keep the original package version: it identifies the fallback files in '.'.
  manifest.scripts = {
    ...manifest.scripts,
    start: "node horizon-server.mjs start",
    "start:server": "node horizon-server.mjs start",
    update: "node horizon-server.mjs update",
    "update:check": "node horizon-server.mjs check",
    rollback: "node horizon-server.mjs rollback",
  };
  await atomic(
    path.join(root, "horizon-server.mjs"),
    await readFile(path.join(directory, "horizon-server.mjs")),
  );
  await save(path.join(root, "package.json"), manifest);
}
export async function updateServer(root, options = {}) {
  const unlock = await lock(root, "update");
  let staging;
  try {
    const before = await currentInstallation(root);
    const release = await latestServerRelease(options.fetch ?? fetch);
    if (compareVersions(release.version, before.current.version) <= 0)
      return { version: before.current.version, updated: false };
    options.log?.(`Downloading Horizon server ${release.version}…`);
    staging = await mkdtemp(path.join(root, ".horizon", "server-update-"));
    const archive = path.join(staging, "update.tar.gz");
    await download(release, archive, options.fetch ?? fetch);
    const extracted = await extractRelease(archive, staging, release.version);
    options.log?.("Checking the new server before switching versions…");
    await preflight(root, extracted, options.readyTimeout);
    const directory = `.horizon/releases/${release.version}-${randomUUID()}`;
    await mkdir(path.join(root, ".horizon/releases"), { recursive: true });
    await rename(extracted, path.join(root, directory));
    // Prepare permanent commands before switching. App files are the only files replaced.
    await launcher(root, path.join(root, directory));
    const restarted = await activate(
      root,
      before,
      {
        current: { version: release.version, directory },
        previous: before.current,
        rollbackPrevious: before.previous,
      },
      options.restartTimeout,
    );
    return { version: release.version, updated: true, restarted };
  } finally {
    if (staging) {
      if (path.dirname(staging) !== path.join(root, ".horizon"))
        throw new Error("Unsafe server update staging folder.");
      await rm(staging, { recursive: true, force: true });
    }
    await unlock();
  }
}
export async function rollbackServer(root, options = {}) {
  const unlock = await lock(root, "update");
  try {
    const before = await currentInstallation(root);
    if (!before.previous)
      throw new Error("There is no previous server version to restore.");
    await runtime(root, before.previous);
    const restarted = await activate(
      root,
      before,
      {
        current: before.previous,
        previous: before.current,
        rollbackPrevious: before.previous,
      },
      options.restartTimeout,
    );
    return { version: before.previous.version, restarted };
  } finally {
    await unlock();
  }
}
export async function startServer(root, options = {}) {
  const unlock = await lock(root, "start");
  const statusFile = control(root, "run.json");
  const id = randomUUID();
  let child,
    selected,
    failedDirectory,
    timer,
    busy = false,
    stopping = false;
  let exitCode = 0;
  let transition;
  let complete;
  const ended = new Promise((resolve) => {
    complete = resolve;
  });
  const status = (ready = false) =>
    save(statusFile, {
      pid: process.pid,
      id,
      ready,
      ...selected,
      failedDirectory,
    });
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    if (child) await stop(child);
    complete();
  };
  const launch = async (ref) => {
    selected = ref;
    await status();
    child = await boot(root, await runtime(root, ref), {
      ...options,
      onChild: (next) => {
        child = next;
        if (stopping) void stop(next);
      },
    });
    child.once("exit", () => {
      if (!busy && !stopping) {
        exitCode = 1;
        void shutdown();
      }
    });
    await status(true);
  };
  const tick = async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      const desiredState = await currentInstallation(root);
      const desired = desiredState.current;
      if (
        desired.directory === selected.directory ||
        desired.directory === failedDirectory
      )
        return;
      const previous = selected;
      await status();
      await stop(child);
      if (stopping) return;
      try {
        await launch(desired);
        failedDirectory = undefined;
        await status(true);
      } catch (error) {
        if (stopping) return;
        failedDirectory = desired.directory;
        options.log?.(`${error.message} Restarting the previous version…`);
        if (
          (await currentInstallation(root)).current.directory ===
          desired.directory
        ) {
          await save(control(root, "install.json"), {
            current: previous,
            previous: desiredState.rollbackPrevious,
          });
        }
        await launch(previous);
      }
    } catch (error) {
      options.log?.(error.message);
      exitCode = 1;
      void shutdown();
    } finally {
      busy = false;
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  const parentMessage = (message) => {
    if (message?.type === "horizon:stop") void shutdown();
  };
  process.on("message", parentMessage);
  try {
    await launch((await currentInstallation(root)).current);
    if (!stopping)
      timer = setInterval(() => {
        if (!busy) transition = tick();
      }, 500);
    await ended;
    return exitCode;
  } catch (error) {
    if (!stopping) throw error;
    return exitCode;
  } finally {
    clearInterval(timer);
    await transition;
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    process.removeListener("message", parentMessage);
    if (child) await stop(child);
    if ((await json(statusFile))?.id === id)
      await rm(statusFile, { force: true });
    await unlock();
  }
}
async function main() {
  const command = process.argv[2] ?? "help";
  const root = path.dirname(fileURLToPath(import.meta.url));
  const log = (message) => console.log(message);
  if (command === "help" || command === "--help") {
    log(
      "Horizon server\n\n  npm start             Start your server\n  npm run update:check  Check GitHub for a newer version\n  npm run update        Download and apply an update\n  npm run rollback      Restore the previous version\n\nYou can also run: node horizon-server.mjs start|check|update|rollback\nYour media, .env, and library cache stay in this folder.",
    );
    return;
  }
  if (command === "start") {
    process.exitCode = await startServer(root, { log });
    return;
  }
  if (command === "check") {
    const installed = (await currentInstallation(root)).current.version;
    const release = await latestServerRelease();
    log(
      compareVersions(release.version, installed) > 0
        ? `Horizon server ${release.version} is available. Run npm run update.`
        : `Horizon server ${installed} is up to date.`,
    );
    return;
  }
  if (!["update", "rollback"].includes(command))
    throw new Error("Unknown command. Run node horizon-server.mjs --help.");
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("Prebuilt server updates are available for Linux x64.");
  const result =
    command === "update"
      ? await updateServer(root, { log })
      : await rollbackServer(root);
  log(
    result.updated === false
      ? `Horizon server ${result.version} is up to date.`
      : `Horizon server ${result.version} is ready.${result.restarted ? " Your server restarted successfully." : " Run npm start to start it."}`,
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`Horizon: ${error.message}`);
    process.exitCode = 1;
  });
}
