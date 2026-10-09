import type { AppUpdater } from "electron-updater";
import { z } from "zod";
import type { UpdateState } from "../shared/types";

type Updater = Pick<
  AppUpdater,
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "allowPrerelease"
  | "allowDowngrade"
  | "logger"
  | "on"
  | "checkForUpdates"
>;
export interface UpdateEnvironment {
  packaged: boolean;
  feed: boolean;
  platform: string;
  portable: boolean;
  appImage: boolean;
  packageType: string;
  repository: string;
  version: string;
}
const releaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(
    z.object({ name: z.string(), browser_download_url: z.string() }),
  ),
});
export function newerVersion(next: string, current: string): boolean {
  if (![next, current].every((version) => /^\d+\.\d+\.\d+$/.test(version)))
    return false;
  const a = next.split(".").map(Number),
    b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
export class UpdateManager {
  state: UpdateState = {
    status: "disabled",
    message: "Updates are available in GitHub release builds.",
  };
  private pending?: Promise<UpdateState>;
  private readonly automatic: boolean;
  constructor(
    private environment: UpdateEnvironment,
    private updater: Updater,
    private changed: (state: UpdateState) => void,
    private request: typeof fetch = fetch,
  ) {
    this.automatic =
      environment.feed &&
      !environment.portable &&
      (environment.platform === "win32" ||
        (environment.platform === "linux" &&
          (environment.appImage || environment.packageType === "deb")));
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    updater.on("checking-for-update", () =>
      this.set({ status: "checking", message: "Checking GitHub Releases…" }),
    );
    updater.on("update-available", (info) =>
      this.set({
        status: "available",
        message: `Horizon ${info.version} is available.`,
      }),
    );
    updater.on("update-not-available", () =>
      this.set({ status: "idle", message: "You have the latest version." }),
    );
    updater.on("download-progress", (progress) =>
      this.set({
        status: "downloading",
        message: "Downloading update…",
        percent: progress.percent,
      }),
    );
    updater.on("update-downloaded", (info) =>
      this.set({
        status: "ready",
        message: `Horizon ${info.version} is ready to install.`,
      }),
    );
    updater.on("error", () => this.failed());
    if (environment.packaged)
      this.state = {
        status: "idle",
        message: this.automatic
          ? "Updates come from GitHub Releases."
          : "Check GitHub Releases for the latest download.",
      };
  }
  private set(state: UpdateState) {
    this.state = state;
    this.changed(state);
  }
  private failed() {
    this.set({
      status: "error",
      message: "Could not check or download the update. Try again later.",
    });
  }
  check(): Promise<UpdateState> {
    if (!this.environment.packaged) return Promise.resolve(this.state);
    if (this.state.status === "ready" || this.state.status === "downloading")
      return Promise.resolve(this.state);
    if (this.pending) return this.pending;
    this.pending = this.performCheck().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async performCheck(): Promise<UpdateState> {
    try {
      if (this.automatic) await this.updater.checkForUpdates();
      else await this.checkManualRelease();
    } catch {
      this.failed();
    }
    return this.state;
  }
  private async checkManualRelease() {
    const { repository, version, platform, portable } = this.environment;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
      throw new Error("Invalid update repository.");
    this.set({ status: "checking", message: "Checking GitHub Releases…" });
    const response = await this.request(
      `https://api.github.com/repos/${repository}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (response.status === 404) {
      this.set({
        status: "idle",
        message: "The first GitHub release is being prepared.",
      });
      return;
    }
    if (!response.ok) throw new Error("Release check failed.");
    const release = releaseSchema.parse(await response.json());
    const next = release.tag_name.replace(/^v/, "");
    if (release.draft || release.prerelease || !newerVersion(next, version)) {
      this.set({ status: "idle", message: "You have the latest version." });
      return;
    }
    const name =
      platform === "win32"
        ? `Horizon-${next}-windows-x64${portable ? "-portable" : ""}.exe`
        : `Horizon-${next}-linux-x86_64.AppImage`;
    const url = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
    if (
      !release.assets.some(
        (asset) => asset.name === name && asset.browser_download_url === url,
      )
    )
      throw new Error("The release download is missing.");
    this.set({
      status: "available",
      message: `Horizon ${next} is available. Download it to update this copy.`,
      downloadUrl: url,
    });
  }
}
