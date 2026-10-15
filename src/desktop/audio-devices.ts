import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { MpvIpc } from "./mpv-ipc";
import { PlaybackJob, stopPlaybackProcess } from "./playback-process";
import { audioDeviceList } from "../shared/audio";
import type { AudioDevice } from "../shared/types";

// Query the playback engine's real device IDs before any movie is playing.
// No window or audio stream is opened, and the helper has the same crash guard.
export async function discoverAudioDevices(
  executable: string,
): Promise<AudioDevice[]> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "horizon-audio-devices-"),
  );
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\horizon-audio-devices-${randomUUID()}`
      : path.join(directory, "ipc");
  const ipc = new MpvIpc(endpoint, () => {});
  const job = new PlaybackJob();
  const child = spawn(
    executable,
    [
      "--no-config",
      "--idle=yes",
      "--force-window=no",
      "--terminal=no",
      "--input-terminal=no",
      "--vo=null",
      "--ao=null",
      `--input-ipc-server=${endpoint}`,
      ...(process.platform === "linux" ? ["--input-ipc-client=fd://3"] : []),
    ],
    {
      windowsHide: true,
      stdio:
        process.platform === "linux"
          ? ["ignore", "ignore", "ignore", "pipe"]
          : "ignore",
    },
  );
  let failed = false;
  child.on("error", () => {
    failed = true;
  });
  child.stdio[3]?.on("error", () => {});
  child.stdio[3]?.on("data", () => {});
  try {
    if (child.pid) job.attach(child.pid);
    await ipc.connect(
      () => !failed && child.exitCode === null && child.signalCode === null,
      5000,
    );
    return audioDeviceList(
      await ipc.command(["get_property", "audio-device-list"], 3000),
    );
  } finally {
    await stopPlaybackProcess(child, ipc, job);
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith("horizon-audio-devices-")
    )
      await rm(directory, { recursive: true, force: true });
  }
}
