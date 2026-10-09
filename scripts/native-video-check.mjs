import assert from "node:assert/strict";
import koffi from "koffi";
import { writeFile } from "node:fs/promises";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function checkNativeVideo(application, page) {
  if (process.platform !== "win32") return;
  const root = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0),
  );
  const user32 = koffi.load("user32.dll");
  const callback = koffi.proto(
    "int __stdcall HorizonEnumWindow(uintptr_t window, intptr_t data)",
  );
  const enumChild = user32.func(
    "int __stdcall EnumChildWindows(uintptr_t parent, HorizonEnumWindow *callback, intptr_t data)",
  );
  const enumWindows = user32.func(
    "int __stdcall EnumWindows(HorizonEnumWindow *callback, intptr_t data)",
  );
  const className = user32.func(
    "int __stdcall GetClassNameW(uintptr_t window, _Out_ char16_t *name, int count)",
  );
  const processId = user32.func(
    "uint32_t __stdcall GetWindowThreadProcessId(uintptr_t window, _Out_ uint32_t *pid)",
  );
  const visible = user32.func(
    "int __stdcall IsWindowVisible(uintptr_t window)",
  );
  const enabled = user32.func(
    "int __stdcall IsWindowEnabled(uintptr_t window)",
  );
  koffi.struct("HorizonVideoRect", {
    left: "int",
    top: "int",
    right: "int",
    bottom: "int",
  });
  koffi.struct("HorizonVideoPoint", { x: "int", y: "int" });
  const rect = user32.func(
    "int __stdcall GetWindowRect(uintptr_t window, _Out_ HorizonVideoRect *rect)",
  );
  const clientRect = user32.func(
    "int __stdcall GetClientRect(uintptr_t window, _Out_ HorizonVideoRect *rect)",
  );
  const origin = user32.func(
    "int __stdcall ClientToScreen(uintptr_t window, _Inout_ HorizonVideoPoint *point)",
  );
  const children = [];
  enumChild(
    root,
    (window) => {
      const name = Buffer.alloc(512);
      const count = className(window, name, 256);
      const pid = [0];
      processId(window, pid);
      children.push({
        window,
        name: name.subarray(0, count * 2).toString("utf16le"),
        pid: pid[0],
      });
      return 1;
    },
    0,
  );
  const embedded = children.filter((window) => /mpv/i.test(window.name));
  assert(
    embedded.length > 0,
    "mpv must create a video child inside Horizon's native window.",
  );
  assert(
    enabled(embedded[0].window),
    "The embedded mpv window must accept real mouse and keyboard input.",
  );
  const playerPids = new Set(embedded.map((window) => window.pid));
  // Connect only to the player proved to belong to this test's app window.
  // Its command line contains an IPC pipe and options, never access credentials.
  const { stdout } = await promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${embedded[0].pid}').CommandLine`,
    ],
    { windowsHide: true },
  );
  const pipe = /--input-ipc-server=(?:"([^"]+)"|(\S+))/.exec(stdout);
  assert(pipe, "The embedded player must expose its owned IPC pipe.");
  const command = (args) =>
    new Promise((resolve, reject) => {
      const socket = net.createConnection(pipe[1] ?? pipe[2]);
      let buffer = "";
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Native playback inspection timed out."));
      }, 3000);
      const finish = (error, data) => {
        clearTimeout(timer);
        socket.destroy();
        error ? reject(error) : resolve(data);
      };
      socket.on("error", (error) => finish(error));
      socket.on("connect", () =>
        socket.write(JSON.stringify({ command: args, request_id: 1 }) + "\n"),
      );
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          const message = JSON.parse(line);
          if (message.request_id === 1)
            finish(
              message.error !== "success" ? new Error(message.error) : null,
              message.data,
            );
        }
      });
    });
  const separate = [];
  enumWindows((window) => {
    const pid = [0];
    processId(window, pid);
    if (visible(window) && playerPids.has(pid[0])) separate.push(window);
    return 1;
  }, 0);
  assert.equal(
    separate.length,
    0,
    "mpv must never have a visible top-level window.",
  );
  const verifyBounds = async () => {
    // ResizeObserver, native layout and mpv update on separate event loops.
    // Allow them to settle, while still rejecting a stale or misplaced surface.
    for (let attempt = 0; ; attempt++) {
      const target = await page.locator(".video-surface").boundingBox();
      const scale = await page.evaluate(() => window.devicePixelRatio);
      const video = {},
        top = { x: 0, y: 0 };
      rect(embedded[0].window, video);
      origin(root, top);
      const aligned =
        target &&
        [
          [video.left, top.x + target.x * scale],
          [video.top, top.y + target.y * scale],
          [video.right - video.left, target.width * scale],
          [video.bottom - video.top, target.height * scale],
        ].every(([actual, expected]) => Math.abs(actual - expected) <= 3);
      if (aligned) return;
      assert(
        attempt < 40,
        "Native video bounds must match the in-app surface.",
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  await verifyBounds();

  // Capture this application window only, including native children omitted by
  // Chromium's page screenshot. No desktop or other application's pixels.
  const gdi32 = koffi.load("gdi32.dll");
  const getDC = user32.func("uintptr_t __stdcall GetDC(uintptr_t window)");
  const releaseDC = user32.func(
    "int __stdcall ReleaseDC(uintptr_t window, uintptr_t dc)",
  );
  const print = user32.func(
    "int __stdcall PrintWindow(uintptr_t window, uintptr_t dc, uint32_t flags)",
  );
  const compatibleDC = gdi32.func(
    "uintptr_t __stdcall CreateCompatibleDC(uintptr_t dc)",
  );
  const compatibleBitmap = gdi32.func(
    "uintptr_t __stdcall CreateCompatibleBitmap(uintptr_t dc, int width, int height)",
  );
  const select = gdi32.func(
    "uintptr_t __stdcall SelectObject(uintptr_t dc, uintptr_t object)",
  );
  const getBits = gdi32.func(
    "int __stdcall GetDIBits(uintptr_t dc, uintptr_t bitmap, unsigned int first, unsigned int count, _Out_ void *bits, void *info, unsigned int usage)",
  );
  const deleteObject = gdi32.func(
    "int __stdcall DeleteObject(uintptr_t object)",
  );
  const deleteDC = gdi32.func("int __stdcall DeleteDC(uintptr_t dc)");
  const capture = async (filename = ".horizon/qa/player-native.png") => {
    const area = {};
    clientRect(root, area);
    const width = area.right,
      height = area.bottom;
    const dc = getDC(root),
      memory = compatibleDC(dc),
      bitmap = compatibleBitmap(dc, width, height);
    const previous = select(memory, bitmap);
    try {
      assert(
        print(root, memory, 3),
        "Horizon window must be capturable for visual verification.",
      );
      select(memory, previous);
      const info = Buffer.alloc(44);
      info.writeUInt32LE(40, 0);
      info.writeInt32LE(width, 4);
      info.writeInt32LE(-height, 8);
      info.writeUInt16LE(1, 12);
      info.writeUInt16LE(32, 14);
      const bits = Buffer.alloc(width * height * 4);
      assert.equal(getBits(dc, bitmap, 0, height, bits, info, 0), height);
      for (let i = 3; i < bits.length; i += 4) bits[i] = 255;
      const png = await application.evaluate(
        ({ nativeImage }, { bitmap, width, height }) =>
          nativeImage
            .createFromBitmap(Buffer.from(bitmap, "base64"), { width, height })
            .toPNG()
            .toString("base64"),
        { bitmap: bits.toString("base64"), width, height },
      );
      await writeFile(filename, Buffer.from(png, "base64"));
    } finally {
      select(memory, previous);
      deleteObject(bitmap);
      deleteDC(memory);
      releaseDC(root, dc);
    }
  };
  await capture();
  const sendInput = user32.func(
    "unsigned int __stdcall SendInput(unsigned int count, const void *inputs, int size)",
  );
  const getSystemMetrics = user32.func(
    "int __stdcall GetSystemMetrics(int index)",
  );
  const scanCode = user32.func(
    "uint32_t __stdcall MapVirtualKeyW(uint32_t code, uint32_t mapType)",
  );
  const foregroundWindow = user32.func(
    "uintptr_t __stdcall GetForegroundWindow()",
  );
  const windowAt = user32.func(
    "uintptr_t __stdcall WindowFromPoint(HorizonVideoPoint point)",
  );
  const isChild = user32.func(
    "int __stdcall IsChild(uintptr_t parent, uintptr_t window)",
  );
  const cursor = user32.func("int __stdcall SetCursorPos(int x, int y)");
  const getCursor = user32.func(
    "int __stdcall GetCursorPos(_Out_ HorizonVideoPoint *point)",
  );
  const foreground = user32.func(
    "int __stdcall SetForegroundWindow(uintptr_t window)",
  );
  const previousCursor = {};
  getCursor(previousCursor);
  foreground(root);
  await application.evaluate(({ app, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setAlwaysOnTop(true);
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()[0].focus();
  });
  for (
    let attempt = 0;
    attempt < 20 && Number(foregroundWindow()) !== Number(root);
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 50));
  const checkPoint = (point) => {
    const target = windowAt(point);
    assert(
      Number(target) === Number(root) || isChild(root, target),
      "Mouse input must target this test's app.",
    );
  };
  const send = (input) => {
    const count = input.length / 40;
    assert.equal(
      sendInput(count, input, 40),
      count,
      "Windows must deliver the test input.",
    );
  };
  const mouseInput = (x, y, flags = 0xc001) => {
    const area = {};
    clientRect(embedded[0].window, area);
    const screen = {};
    rect(embedded[0].window, screen);
    // Use Windows' normal input routing. Posting directly to mpv or sending its
    // IPC "mouse" command would bypass disabled windows and conceal this bug.
    const input = Buffer.alloc(40);
    const sx = screen.left + Math.round(x * area.right);
    const sy = screen.top + Math.round(y * area.bottom);
    checkPoint({ x: sx, y: sy });
    input.writeInt32LE(
      Math.round(
        ((sx - getSystemMetrics(76)) * 65535) / (getSystemMetrics(78) - 1),
      ),
      8,
    );
    input.writeInt32LE(
      Math.round(
        ((sy - getSystemMetrics(77)) * 65535) / (getSystemMetrics(79) - 1),
      ),
      12,
    );
    input.writeUInt32LE(flags, 20); // MOVE | ABSOLUTE | VIRTUALDESK
    return input;
  };
  const move = async (x, y) => send(mouseInput(x, y));
  const controlPoint = (name, value) => {
    const area = {};
    clientRect(embedded[0].window, area);
    const unit = area.right / 1280;
    const height = area.bottom / unit;
    const styleScale = Math.min(1, (height - 94 - 88) / 478);
    const styleY = height - 94 - 478 * styleScale;
    const stylePoint = (x, y) => [
      (674 + x) * unit,
      (styleY + y * styleScale) * unit,
    ];
    const positions = {
      pause: [60 * unit, area.bottom - 58 * unit],
      tracks: [1154 * unit, area.bottom - 58 * unit],
      fullscreen: [1226 * unit, area.bottom - 58 * unit],
      back: [58 * unit, 54 * unit],
      rewind: [124 * unit, area.bottom - 58 * unit],
      forward: [188 * unit, area.bottom - 58 * unit],
      seek: [(48 + 1184 * value) * unit, area.bottom - 118 * unit],
      "watch-together": [1080 * unit, 54 * unit],
      "subtitle-off": [866 * unit, area.bottom - 175 * unit],
      "subtitle-preview": [866 * unit, area.bottom - 129 * unit],
      "subtitle-style": [1082 * unit, area.bottom - 58 * unit],
      "style-serif": stylePoint(215, 106),
      "style-mono": stylePoint(345, 106),
      "style-size-more": stylePoint(372, 154),
      "style-outline-more": stylePoint(372, 198),
      "style-shadow-more": stylePoint(372, 242),
      "style-bold": stylePoint(345, 286),
      "style-warm": stylePoint(291, 330),
      "style-background": stylePoint(345, 374),
      "style-reset": stylePoint(380, 459),
    };
    const [x, y] = positions[name];
    return { x, y, area };
  };
  const hover = async (name, value) => {
    const { x, y, area } = controlPoint(name, value);
    await move(x / area.right, y / area.bottom);
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  const click = async (name, value) => {
    const { x, y, area } = controlPoint(name, value);
    await move(x / area.right, y / area.bottom);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Queue the whole click in one Windows input batch, including its position.
    // Real user movement cannot redirect it between mouse-down and mouse-up.
    const down = mouseInput(x / area.right, y / area.bottom, 0xc003);
    const up = Buffer.alloc(40);
    up.writeUInt32LE(0x0004, 20);
    send(Buffer.concat([down, up]));
  };
  const key = async (code) => {
    assert.equal(
      Number(foregroundWindow()),
      Number(root),
      "Only this test's app may receive keyboard input.",
    );
    const input = Buffer.alloc(40);
    input.writeUInt32LE(1, 0);
    input.writeUInt16LE(code, 8);
    input.writeUInt16LE(scanCode(code, 0), 10);
    send(input);
    await new Promise((resolve) => setTimeout(resolve, 60));
    input.writeUInt32LE(2, 12);
    send(input);
  };
  console.log(
    "GPU video verified as a correctly sized child of Horizon, with no separate mpv window.",
  );
  return {
    verifyBounds,
    capture,
    click,
    hover,
    move,
    key,
    command,
    restoreCursor: () => cursor(previousCursor.x, previousCursor.y),
  };
}
