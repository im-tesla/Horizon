import koffi from "koffi";
import type { BrowserWindow } from "electron";
import type { VideoBounds } from "../shared/types";

// A native child of Horizon's own window, never a second top-level player window.
// Keeping this separate from Chromium preserves mpv's hardware decoding and audio.
export class VideoSurface {
  private child: number | bigint = 0;
  private display: bigint | null = null;
  private bounds: VideoBounds | null = null;
  private playing = false;
  private move?: (...args: any[]) => any;
  private show?: (...args: any[]) => any;
  private destroy?: (...args: any[]) => any;
  private flush?: (...args: any[]) => any;
  private closeDisplay?: (...args: any[]) => any;
  private enableInput?: () => void;

  constructor(private window: BrowserWindow) {}

  get id(): string {
    if (!this.child) this.create();
    return BigInt.asUintN(32, BigInt(this.child)).toString();
  }

  private create(): void {
    const native = this.window.getNativeWindowHandle();
    const parent = native.readUInt32LE(0);
    if (!parent) throw new Error("Horizon's playback window is unavailable.");
    if (process.platform === "win32") {
      const user32 = koffi.load("user32.dll");
      const create = user32.func(
        "uintptr_t __stdcall CreateWindowExW(uint32_t exStyle, const char16_t *className, const char16_t *title, uint32_t style, int x, int y, int width, int height, uintptr_t parent, uintptr_t menu, uintptr_t instance, void *param)",
      );
      this.move = user32.func(
        "int __stdcall SetWindowPos(uintptr_t window, uintptr_t after, int x, int y, int width, int height, uint32_t flags)",
      );
      this.show = user32.func(
        "int __stdcall ShowWindow(uintptr_t window, int command)",
      );
      this.destroy = user32.func(
        "int __stdcall DestroyWindow(uintptr_t window)",
      );
      const findChild = user32.func(
        "uintptr_t __stdcall FindWindowExW(uintptr_t parent, uintptr_t after, const char16_t *className, const char16_t *title)",
      );
      const enabled = user32.func(
        "int __stdcall IsWindowEnabled(uintptr_t window)",
      );
      const enable = user32.func(
        "int __stdcall EnableWindow(uintptr_t window, int enabled)",
      );
      this.enableInput = () => {
        // mpv disables its own child HWND in --wid mode. Enable that child, not
        // just our host surface, so Windows routes real mouse input to the HUD.
        // Check on layout/state updates: mpv creates/replaces it asynchronously.
        const video = findChild(this.child, 0, "mpv", null);
        if (video && !enabled(video)) enable(video, 1);
      };
      // Native controls receive mouse/keyboard input in the video child itself.
      // WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN | SS_BLACKRECT.
      this.child = create(
        0,
        "STATIC",
        null,
        0x46000004,
        0,
        0,
        1,
        1,
        parent,
        0,
        0,
        null,
      );
    } else if (process.platform === "linux") {
      if (!process.env.DISPLAY)
        throw new Error(
          "In-app playback requires X11 or XWayland. Enable XWayland in your desktop session.",
        );
      const x11 = koffi.load("libX11.so.6");
      const open = x11.func("void *XOpenDisplay(const char *name)");
      const create = x11.func(
        "unsigned long XCreateSimpleWindow(void *display, unsigned long parent, int x, int y, unsigned int width, unsigned int height, unsigned int border, unsigned long borderColor, unsigned long background)",
      );
      this.move = x11.func(
        "int XMoveResizeWindow(void *display, unsigned long window, int x, int y, unsigned int width, unsigned int height)",
      );
      const map = x11.func(
        "int XMapWindow(void *display, unsigned long window)",
      );
      const unmap = x11.func(
        "int XUnmapWindow(void *display, unsigned long window)",
      );
      this.show = (display, window, visible) =>
        visible ? map(display, window) : unmap(display, window);
      this.destroy = x11.func(
        "int XDestroyWindow(void *display, unsigned long window)",
      );
      this.flush = x11.func("int XFlush(void *display)");
      this.closeDisplay = x11.func("int XCloseDisplay(void *display)");
      this.display = open(null);
      if (!this.display)
        throw new Error(
          "Cannot connect to the X11 display for in-app playback.",
        );
      this.child = create(this.display, parent, 0, 0, 1, 1, 0, 0, 0);
    } else throw new Error("In-app playback supports Windows and Linux.");
    if (!this.child)
      throw new Error("Could not create Horizon's embedded video surface.");
    this.layout();
  }

  update(bounds: VideoBounds | null): void {
    this.bounds = bounds;
    this.layout();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.layout();
  }

  private layout(): void {
    if (!this.child) return;
    const bounds = this.bounds;
    const visible =
      this.playing && bounds && bounds.width >= 2 && bounds.height >= 2;
    if (visible) {
      const factor = bounds.scale;
      const x = Math.round(bounds.x * factor);
      const y = Math.round(bounds.y * factor);
      const width = Math.max(1, Math.round(bounds.width * factor));
      const height = Math.max(1, Math.round(bounds.height * factor));
      if (process.platform === "win32") {
        this.move!(this.child, 0, x, y, width, height, 0x0050);
        this.enableInput?.();
      } else {
        this.move!(this.display, this.child, x, y, width, height);
        this.show!(this.display, this.child, true);
      }
    } else if (process.platform === "win32") this.show!(this.child, 0);
    else this.show!(this.display, this.child, false);
    this.flush?.(this.display);
  }

  dispose(): void {
    if (this.child) {
      if (process.platform === "win32") this.destroy?.(this.child);
      else this.destroy?.(this.display, this.child);
      this.child = 0;
    }
    if (this.display) {
      this.closeDisplay?.(this.display);
      this.display = null;
    }
  }
}
