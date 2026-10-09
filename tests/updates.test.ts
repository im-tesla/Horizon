import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { AppUpdater } from "electron-updater";
import {
  UpdateManager,
  newerVersion,
  type UpdateEnvironment,
} from "../src/desktop/updates";

const environment: UpdateEnvironment = {
  packaged: true,
  feed: true,
  platform: "win32",
  portable: false,
  appImage: false,
  packageType: "",
  repository: "im-tesla/Horizon",
  version: "0.1.7",
};
function fixture(
  patch: Partial<UpdateEnvironment> = {},
  request?: typeof fetch,
) {
  class TestUpdater extends EventEmitter {
    calls = 0;
    autoDownload = false;
    autoInstallOnAppQuit = true;
    allowPrerelease = true;
    allowDowngrade = true;
    logger = null;
    async checkForUpdates() {
      this.calls++;
      this.emit("update-not-available");
      return null;
    }
  }
  const updater = new TestUpdater();
  const manager = new UpdateManager(
    { ...environment, ...patch },
    updater as unknown as AppUpdater,
    () => {},
    request,
  );
  return { updater, manager };
}
const latest = (overrides: Record<string, unknown> = {}) => ({
  tag_name: "v0.2.0",
  draft: false,
  prerelease: false,
  assets: [
    {
      name: "Horizon-0.2.0-windows-x64-portable.exe",
      browser_download_url:
        "https://github.com/im-tesla/Horizon/releases/download/v0.2.0/Horizon-0.2.0-windows-x64-portable.exe",
    },
  ],
  ...overrides,
});
test("installed Windows, AppImage, and Debian clients check their embedded update feed", async () => {
  for (const patch of [
    {},
    { platform: "linux", appImage: true },
    { platform: "linux", packageType: "deb" },
  ]) {
    const { updater, manager } = fixture(patch);
    assert.equal((await manager.check()).status, "idle");
    assert.equal(updater.calls, 1);
    assert.equal(updater.autoInstallOnAppQuit, false);
    assert.equal(updater.allowDowngrade, false);
    assert.equal(updater.allowPrerelease, false);
  }
});
test("update checks share one request and preserve a downloaded installer", async () => {
  const { updater, manager } = fixture();
  let release!: () => void;
  updater.checkForUpdates = async () => {
    updater.calls++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return null;
  };
  const first = manager.check(),
    second = manager.check();
  assert.equal(first, second);
  release();
  await first;
  updater.emit("download-progress", { percent: 45 });
  assert.equal((await manager.check()).status, "downloading");
  updater.emit("update-downloaded", { version: "0.2.0" });
  assert.equal((await manager.check()).status, "ready");
  assert.equal(updater.calls, 1);
});
test("development builds make no update requests", async () => {
  const { updater, manager } = fixture({ packaged: false }, async () => {
    assert.fail("Development must not fetch releases.");
  });
  assert.equal((await manager.check()).status, "disabled");
  assert.equal(updater.calls, 0);
});
test("portable clients detect releases and expose only their official matching download", async () => {
  const { updater, manager } = fixture(
    { portable: true },
    async () => new Response(JSON.stringify(latest())),
  );
  assert.equal(
    (await manager.check()).downloadUrl,
    latest().assets[0].browser_download_url,
  );
  assert.equal(updater.calls, 0);
  const invalid = fixture(
    { portable: true },
    async () =>
      new Response(
        JSON.stringify(
          latest({
            assets: [
              {
                name: latest().assets[0].name,
                browser_download_url: "https://example.invalid/installer.exe",
              },
            ],
          }),
        ),
      ),
  );
  assert.equal((await invalid.manager.check()).status, "error");
  assert.equal(invalid.manager.state.downloadUrl, undefined);
});
test("release checks reject downgrades and previews, and recover from a network failure", async () => {
  assert(newerVersion("0.10.0", "0.9.9"));
  assert(!newerVersion("0.1.6", "0.1.7"));
  assert(!newerVersion("0.2.0-beta.1", "0.1.7"));
  for (const release of [
    latest({ tag_name: "v0.1.6" }),
    latest({ prerelease: true }),
    latest({ draft: true }),
  ]) {
    const { manager } = fixture(
      { portable: true },
      async () => new Response(JSON.stringify(release)),
    );
    assert.equal((await manager.check()).status, "idle");
  }
  let count = 0;
  const { manager } = fixture({ portable: true }, async () => {
    if (!count++) throw new Error("Offline");
    return new Response(JSON.stringify(latest()));
  });
  assert.equal((await manager.check()).status, "error");
  assert.equal((await manager.check()).status, "available");
});
