import koffi from "koffi";
import type { ChildProcess } from "node:child_process";
import type { MpvIpc } from "./mpv-ipc";

// The handle is private and non-inheritable. Windows closes it even if Electron
// crashes or is force-terminated, killing only the mpv process assigned to it.
export class PlaybackJob {
  private handle: number | bigint = 0;
  private closeHandle?: (...args: any[]) => any;

  attach(pid: number): void {
    if (process.platform !== "win32") return;
    const kernel = koffi.load("kernel32.dll");
    const create = kernel.func(
      "uintptr_t __stdcall CreateJobObjectW(void *attributes, const char16_t *name)",
    );
    const configure = kernel.func(
      "int __stdcall SetInformationJobObject(uintptr_t job, int informationClass, void *information, uint32_t length)",
    );
    const open = kernel.func(
      "uintptr_t __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)",
    );
    const assign = kernel.func(
      "int __stdcall AssignProcessToJobObject(uintptr_t job, uintptr_t process)",
    );
    this.closeHandle = kernel.func(
      "int __stdcall CloseHandle(uintptr_t handle)",
    );
    this.handle = create(null, null);
    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION on our 64-bit desktop builds.
    const limits = Buffer.alloc(144);
    limits.writeUInt32LE(0x2000, 16); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    const processHandle = open(0x0101, 0, pid); // SET_QUOTA | TERMINATE
    try {
      if (
        !this.handle ||
        !configure(this.handle, 9, limits, limits.length) ||
        !processHandle ||
        !assign(this.handle, processHandle)
      )
        throw new Error(
          "Could not protect the playback process. Try restarting Horizon.",
        );
    } catch (error) {
      this.close();
      throw error;
    } finally {
      if (processHandle) this.closeHandle(processHandle);
    }
  }

  close(): void {
    if (this.handle) this.closeHandle?.(this.handle);
    this.handle = 0;
  }
}

function running(child: ChildProcess): boolean {
  return !!child.pid && child.exitCode === null && child.signalCode === null;
}
async function waitForExit(
  child: ChildProcess,
  timeout: number,
): Promise<void> {
  if (!running(child)) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      child.off("exit", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeout);
    child.once("exit", finish);
  });
}

export async function stopPlaybackProcess(
  child?: ChildProcess,
  ipc?: MpvIpc,
  job?: PlaybackJob,
): Promise<void> {
  try {
    if (child && running(child)) {
      await ipc?.command(["quit"], 600).catch(() => {});
      await waitForExit(child, 600);
      if (running(child)) {
        job?.close();
        // Use the live child handle, never a saved PID or a process-name search.
        child.kill("SIGKILL");
        await waitForExit(child, 1000);
      }
    }
  } finally {
    ipc?.close();
    job?.close();
  }
}
