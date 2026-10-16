import assert from "node:assert/strict";
import koffi from "koffi";

export async function waitForBridge(
  page,
  predicate,
  label = "Desktop state",
  timeout = 15000,
) {
  const until = Date.now() + timeout;
  do {
    if (await page.evaluate(predicate)) return;
    await page.waitForTimeout(75);
  } while (Date.now() < until);
  assert.fail(`${label} did not settle.`);
}
async function activate(application, page) {
  if (await page.evaluate(() => window.horizon.gamepadActive())) return;
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].focus(),
  );
  if (
    process.platform === "win32" &&
    !(await page.evaluate(() => window.horizon.gamepadActive()))
  ) {
    // Windows restricts background applications from taking foreground focus.
    // Attach only for the duration of activating this test's own HWND.
    const root = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0),
    );
    const user32 = koffi.load("user32.dll"),
      kernel32 = koffi.load("kernel32.dll");
    const foreground = user32.func("uintptr_t __stdcall GetForegroundWindow()");
    const thread = user32.func(
      "uint32_t __stdcall GetWindowThreadProcessId(uintptr_t window, void *pid)",
    );
    const current = kernel32.func("uint32_t __stdcall GetCurrentThreadId()");
    const attach = user32.func(
      "int __stdcall AttachThreadInput(uint32_t first, uint32_t second, int attach)",
    );
    const set = user32.func(
      "int __stdcall SetForegroundWindow(uintptr_t window)",
    );
    const caller = current(),
      other = thread(foreground(), null),
      target = thread(root, null);
    const first = caller !== other && attach(caller, other, 1);
    const second = caller !== target && attach(caller, target, 1);
    try {
      set(root);
    } finally {
      if (second) attach(caller, target, 0);
      if (first) attach(caller, other, 0);
    }
  }
  await waitForBridge(
    page,
    () => window.horizon.gamepadActive(),
    "Horizon foreground",
  );
}

// Test-only browser input. The shipped app uses navigator.getGamepads directly.
export async function virtualGamepad(application, page) {
  await activate(application, page);
  await page.evaluate(() => {
    window.testGamepad = {
      index: 0,
      id: "Horizon test controller",
      connected: true,
      mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [window.testGamepad],
    });
  });
  await page.waitForTimeout(250);
  return {
    async press(index, duration = 80, foreground = true) {
      if (foreground) {
        await activate(application, page);
        await page.waitForTimeout(180);
      }
      await page.evaluate((index) => {
        window.testGamepad.buttons[index] = { pressed: true, value: 1 };
      }, index);
      await page.waitForTimeout(duration);
      await page.evaluate((index) => {
        window.testGamepad.buttons[index] = { pressed: false, value: 0 };
      }, index);
      await page.waitForTimeout(90);
    },
    async disconnect() {
      await page.evaluate(() => {
        window.testGamepad.connected = false;
      });
      await page.waitForTimeout(100);
    },
  };
}

export async function checkGamepadPlayer(application, page) {
  const controller = await virtualGamepad(application, page);
  async function state(predicate) {
    const until = Date.now() + 15000;
    let current;
    do {
      current = await page.evaluate(() => window.horizon.playerState());
      if (current.error) throw new Error(current.error);
      if (predicate(current)) return current;
      await page.waitForTimeout(100);
    } while (Date.now() < until);
    assert.fail(
      `Controller playback did not settle: ${JSON.stringify(current)}`,
    );
  }
  const previous = await page.evaluate(() => window.horizon.playerState());
  await controller.press(9);
  await state((s) => s.paused);
  await page.evaluate(() => window.horizon.playerCommand("seek", 5));
  await state((s) => Math.abs(s.position - 5) < 0.5);
  await controller.press(5);
  await state((s) => s.paused && Math.abs(s.position - 15) < 0.5);
  await controller.press(4);
  await state((s) => s.paused && Math.abs(s.position - 5) < 0.5);
  await controller.press(13);
  for (let i = 0; i < 3; i++) await controller.press(15);
  await controller.press(0);
  await state((s) => s.controlsMenu === "style");
  await controller.press(13); // From Close to the rightmost font choice.
  await controller.press(0);
  await waitForBridge(
    page,
    async () =>
      (await window.horizon.state()).settings.subtitleFont === "Noto Sans Mono",
  );
  await controller.press(14);
  await controller.press(0);
  await waitForBridge(
    page,
    async () =>
      (await window.horizon.state()).settings.subtitleFont === "Noto Serif",
  );
  await controller.press(1);
  await state((s) => !s.controlsMenu);
  await controller.press(15); // Subtitle appearance -> Audio & subtitles.
  await controller.press(0);
  await state((s) => s.controlsMenu === "sub");
  await controller.press(0); // Audio tab, initially highlighted.
  await state((s) => s.controlsMenu === "audio");
  await controller.press(15);
  await controller.press(0);
  await state((s) => s.controlsMenu === "sub");
  await controller.press(13);
  await controller.press(0); // Off.
  await state((s) => !s.controlsMenu);
  await controller.press(3);
  await state((s) => s.fullscreen);
  await controller.press(1);
  await state((s) => !s.fullscreen);
  const final = await page.evaluate(() => window.horizon.playerState());
  assert(
    final.playing && final.paused && Math.abs(final.position - 5) < 0.5,
    JSON.stringify({
      playing: final.playing,
      paused: final.paused,
      position: final.position,
      fullscreen: final.fullscreen,
    }),
  );
  assert.equal(final.mediaId, previous.mediaId);
  if (!previous.paused) {
    await controller.press(9);
    await state((s) => !s.paused);
  }
  await controller.disconnect();
  await page.waitForFunction(() => !document.documentElement.dataset.gamepad);
  console.log(
    "Gamepad input passed: native pause/seek, directional control focus, subtitle font menu, audio/subtitle tabs, fullscreen, Back and disconnect.",
  );
}
