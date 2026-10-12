import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { MpvIpc } from "./mpv-ipc";

interface PlaybackSession {
  version: 1;
  id: string;
  endpoint: string;
  pid?: number;
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export class PlaybackSessions {
  private file: string;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, "playback-session.json");
  }
  private read(): PlaybackSession | undefined {
    try {
      const session = JSON.parse(readFileSync(this.file, "utf8"));
      if (
        session.version !== 1 ||
        typeof session.id !== "string" ||
        !uuid.test(session.id) ||
        typeof session.endpoint !== "string" ||
        (session.pid !== undefined &&
          (!Number.isSafeInteger(session.pid) || session.pid <= 0))
      )
        return;
      const validEndpoint =
        process.platform === "win32"
          ? session.endpoint === `\\\\.\\pipe\\horizon-${session.id}`
          : path.basename(session.endpoint) === "ipc" &&
            path
              .dirname(session.endpoint)
              .startsWith(path.join(os.tmpdir(), "horizon-mpv-")) &&
            path.dirname(path.dirname(session.endpoint)) ===
              path.resolve(os.tmpdir());
      return validEndpoint ? session : undefined;
    } catch {
      return;
    }
  }
  record(session: Omit<PlaybackSession, "version">): void {
    writeFileSync(
      `${this.file}.tmp`,
      JSON.stringify({ version: 1, ...session }),
      { mode: 0o600 },
    );
    renameSync(`${this.file}.tmp`, this.file);
  }
  release(id: string): void {
    if (this.read()?.id === id) {
      try {
        unlinkSync(this.file);
      } catch {}
    }
  }
  async recover(): Promise<void> {
    const session = this.read();
    if (!session) return;
    const ipc = new MpvIpc(session.endpoint, () => {});
    try {
      await ipc.connect(() => true, 350);
      const owner = await ipc.command(
        ["get_property", "options/script-opts"],
        500,
      );
      if (owner?.horizon_owner !== session.id) return;
      const pid = await ipc.command(["get_property", "pid"], 500);
      if (session.pid !== undefined && session.pid !== pid) return;
      // A unique endpoint plus the launch marker identifies this exact player.
      // Quit over its own connection; do not signal a PID which may be reused.
      await ipc.command(["quit"], 500).catch(() => {});
    } catch {
      // A dead player has no reachable endpoint. Never guess which PID to kill.
    } finally {
      ipc.close();
      this.release(session.id);
    }
  }
}
