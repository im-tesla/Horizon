import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { PlaybackSessions } from "../src/desktop/playback-sessions";
import {
  PlaybackJob,
  stopPlaybackProcess,
} from "../src/desktop/playback-process";
import { MpvIpc } from "../src/desktop/mpv-ipc";

async function fixture(respond: (command: unknown[]) => unknown) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "horizon-mpv-"));
  const profile = path.join(directory, "profile");
  await mkdir(profile);
  const id = randomUUID();
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\horizon-${id}`
      : path.join(directory, "ipc");
  const commands: unknown[][] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        commands.push(request.command);
        const data = respond(request.command);
        if (data !== undefined)
          socket.write(
            JSON.stringify({
              request_id: request.request_id,
              error: "success",
              data,
            }) + "\n",
          );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(endpoint, resolve));
  return {
    id,
    endpoint,
    profile,
    commands,
    sessions: new PlaybackSessions(profile),
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
function dummy(): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    windowsHide: true,
    stdio: "ignore",
  });
}
async function exit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Owned test process did not exit.")),
      5000,
    );
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test("startup recovery quits only the recorded player with the matching launch marker and PID", async () => {
  for (const match of [
    "owned",
    "wrong-owner",
    "reused-pid",
    "interrupted-launch",
  ]) {
    let id = "";
    const f = await fixture((command) => {
      if (command[1] === "options/script-opts")
        return { horizon_owner: match === "wrong-owner" ? randomUUID() : id };
      if (command[1] === "pid") return match === "reused-pid" ? 4568 : 4567;
      return null;
    });
    id = f.id;
    try {
      f.sessions.record({
        id,
        endpoint: f.endpoint,
        ...(match === "interrupted-launch" ? {} : { pid: 4567 }),
      });
      await f.sessions.recover();
      assert.equal(
        f.commands.some((command) => command[0] === "quit"),
        ["owned", "interrupted-launch"].includes(match),
      );
      await assert.rejects(
        readFile(path.join(f.profile, "playback-session.json")),
        { code: "ENOENT" },
      );
    } finally {
      await f.close();
    }
  }
});

test("session cleanup cannot connect outside Horizon or remove a newer playback record", async () => {
  const f = await fixture(() => null);
  try {
    const nextId = randomUUID();
    f.sessions.record({
      id: nextId,
      endpoint:
        process.platform === "win32"
          ? `\\\\.\\pipe\\horizon-${nextId}`
          : f.endpoint,
    });
    f.sessions.release(f.id);
    assert.equal(
      JSON.parse(
        await readFile(path.join(f.profile, "playback-session.json"), "utf8"),
      ).id,
      nextId,
    );
    f.sessions.record({
      id: f.id,
      endpoint: "unrelated-player-socket",
      pid: process.pid,
    });
    await f.sessions.recover();
    assert.deepEqual(f.commands, []);
  } finally {
    await f.close();
  }
});

test("dead player records do not delay startup or terminate an unrelated process", async () => {
  const f = await fixture(() => null);
  const other = dummy();
  try {
    f.sessions.record({ id: f.id, endpoint: f.endpoint, pid: other.pid });
    await f.close();
    const sessions = new PlaybackSessions(f.profile);
    sessions.record({ id: f.id, endpoint: f.endpoint, pid: other.pid });
    const started = Date.now();
    await sessions.recover();
    assert(Date.now() - started < 2000);
    assert.equal(other.exitCode, null);
    assert.equal(other.signalCode, null);
  } finally {
    other.kill("SIGKILL");
    await exit(other);
    await rm(path.dirname(f.profile), { recursive: true, force: true });
  }
});

test("an unresponsive player is force-stopped within a bounded time while other processes survive", async () => {
  const f = await fixture(() => undefined);
  const child = dummy(),
    other = dummy();
  const ipc = new MpvIpc(f.endpoint, () => {});
  try {
    await ipc.connect(() => true);
    const started = Date.now();
    await stopPlaybackProcess(child, ipc);
    await exit(child);
    assert(Date.now() - started < 3500);
    assert.equal(other.exitCode, null);
    assert.equal(other.signalCode, null);
  } finally {
    ipc.close();
    child.kill("SIGKILL");
    other.kill("SIGKILL");
    await Promise.all([exit(child), exit(other)]);
    await f.close();
  }
});

test(
  "Windows job closure kills only its assigned playback process",
  { skip: process.platform !== "win32" },
  async () => {
    const child = dummy(),
      other = dummy();
    const job = new PlaybackJob();
    try {
      assert(child.pid);
      job.attach(child.pid);
      job.close();
      await exit(child);
      assert.equal(other.exitCode, null);
      assert.equal(other.signalCode, null);
    } finally {
      job.close();
      child.kill("SIGKILL");
      other.kill("SIGKILL");
      await Promise.all([exit(child), exit(other)]);
    }
  },
);
