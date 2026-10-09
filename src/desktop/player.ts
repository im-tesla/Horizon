import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { MpvIpc } from "./mpv-ipc";
import { subtitleProperties } from "../shared/subtitles";
import type { ClientStore } from "./store";
import {
  groupKey,
  historyKey,
  type MediaItem,
  type PlayerState,
  type PlayerKey,
  type Settings,
} from "../shared/types";
export function mpvArguments(
  endpoint: string,
  settings: Settings,
  windowId?: string,
  uiDirectory?: string,
): string[] {
  return [
    "--no-config",
    "--idle=yes",
    "--force-window=no",
    ...(windowId
      ? [
          `--wid=${windowId}`,
          `--gpu-context=${process.platform === "win32" ? "d3d11" : "x11egl"}`,
        ]
      : []),
    "--keep-open=no",
    "--input-terminal=no",
    "--terminal=no",
    `--input-ipc-server=${endpoint}`,
    "--hwdec=auto-safe",
    "--vo=gpu-next",
    "--video-sync=audio",
    "--cache=yes",
    "--demuxer-max-bytes=256MiB",
    "--demuxer-readahead-secs=30",
    "--osc=no",
    "--osd-level=0",
    "--input-default-bindings=no",
    "--input-vo-keyboard=yes",
    "--window-dragging=no",
    ...(uiDirectory
      ? [
          `--script=${path.join(uiDirectory, "player", "horizon-player.lua")}`,
          `--sub-fonts-dir=${path.join(uiDirectory, "fonts")}`,
          `--osd-fonts-dir=${path.join(uiDirectory, "fonts")}`,
        ]
      : []),
    ...Object.entries(subtitleProperties(settings)).map(
      ([property, value]) => `--${property}=${value}`,
    ),
    "--sub-outline-color=#80000000",
    "--sub-back-color=#B0000000",
    "--sub-margin-y=48",
    "--sub-spacing=0",
    `--slang=${settings.subtitleLanguage}`,
    "--audio-device=auto",
    "--audio-spdif=ac3,eac3,truehd,dts,dts-hd",
    "--audio-channels=auto",
    "--audio-exclusive=yes",
    "--volume=100",
    "--speed=1",
  ];
}
export class Player extends EventEmitter {
  private process?: ChildProcess;
  private ipc?: MpvIpc;
  private tempDir?: string;
  private savedAt = 0;
  private generation = 0;
  private appliedSubtitleProperties: Record<string, string | number> = {};
  private appearance = { accent: "DAF1B2", reduced: false, fullscreen: false };
  private watchBadge = { code: "", viewers: 0, ready: 0, waiting: false };
  state: PlayerState = {
    playing: false,
    paused: false,
    position: 0,
    duration: 0,
    volume: 100,
    tracks: [],
    devices: [],
  };
  constructor(
    private store: ClientStore,
    private playbackDirectory: string,
    private targetWindow: () => string,
    private uiDirectory: string,
  ) {
    super();
  }
  async start(
    item: MediaItem,
    serverId: string,
    restart = false,
    atPosition?: number,
    paused = false,
  ): Promise<void> {
    await this.stop();
    const generation = ++this.generation;
    const settings = this.store.settings();
    const key = historyKey(serverId, item.id);
    const metadata = this.store.metadata()[groupKey(item)];
    const title = `${metadata?.title ?? item.title}${item.kind === "episode" ? ` · S${item.season} E${item.episode}` : ""}`;
    const progress = this.store.progress(key);
    const position =
      atPosition ??
      (restart || progress?.watched ? 0 : (progress?.position ?? 0));
    this.state = {
      playing: false,
      paused,
      key,
      mediaId: item.id,
      title,
      position,
      duration: item.duration ?? 0,
      volume: 100,
      tracks: [],
      devices: [],
    };
    this.tempDir = await mkdtemp(path.join(os.tmpdir(), "horizon-mpv-"));
    const endpoint =
      process.platform === "win32"
        ? `\\\\.\\pipe\\horizon-${randomUUID()}`
        : path.join(this.tempDir, "ipc");
    const bundled = path.join(
      this.playbackDirectory,
      process.platform === "win32" ? "mpv.exe" : "mpv",
    );
    const executable = settings.mpvPath || bundled;
    const failureMessage = settings.mpvPath
      ? "The playback engine override could not start. Remove the local override to use bundled mpv."
      : "The bundled playback engine could not start. Reinstall Horizon to restore it.";
    // Windows' GUI executable has no stdout; its console companion reports the version.
    const companion = executable.replace(/mpv\.exe$/i, "mpv.com");
    const probe =
      process.platform === "win32" && existsSync(companion)
        ? companion
        : executable;
    try {
      const { stdout } = await promisify(execFile)(probe, ["--version"], {
        timeout: 5000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      });
      const version = /mpv\s+v?(\d+)\.(\d+)/.exec(stdout);
      if (!version) throw new Error("Invalid playback engine.");
      if (version && Number(version[1]) === 0 && Number(version[2]) < 41)
        throw new Error("Upgrade mpv to version 0.41 or newer.");
    } catch (error) {
      this.state.error =
        error instanceof Error && error.message.startsWith("Upgrade mpv")
          ? error.message
          : failureMessage;
      await this.stop();
      this.emitState();
      throw new Error(this.state.error);
    }
    const args = mpvArguments(
      endpoint,
      settings,
      this.targetWindow(),
      this.uiDirectory,
    );
    this.appliedSubtitleProperties = subtitleProperties(settings);
    if (process.env.HORIZON_MPV_TEST === "true") {
      args.push("--ao=null");
      if (process.env.HORIZON_VIDEO_TEST !== "true") args.push("--vo=null");
    }
    this.process = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    const child = this.process;
    let spawnError = false;
    child.on("error", () => {
      spawnError = true;
      if (this.generation === generation) {
        this.state.error = failureMessage;
        this.state.playing = false;
        this.emitState();
      }
    });
    // Diagnostics are intentionally not logged: HTTP errors can contain authenticated URLs.
    child.stderr?.on("data", () => {});
    child.once("exit", () => {
      if (this.generation !== generation) return;
      this.save();
      this.ipc?.close();
      this.state.playing = false;
      this.emitState();
    });
    this.ipc = new MpvIpc(endpoint, (event) => {
      if (this.generation === generation) this.handleEvent(event);
    });
    try {
      await this.ipc.connect(
        () =>
          !spawnError && child.exitCode === null && child.signalCode === null,
      );
      // Credentials travel through local IPC, never through process arguments or query strings.
      await this.ipc.command([
        "set_property",
        "http-header-fields",
        [`Authorization: Bearer ${settings.token}`],
      ]);
      await this.ipc.command(["set_property", "force-media-title", title]);
      await this.ipc.command(["set_property", "pause", paused]);
      for (const [index, property] of [
        "time-pos",
        "duration",
        "pause",
        "volume",
        "track-list",
        "audio-device-list",
        "paused-for-cache",
      ].entries())
        await this.ipc.command(["observe_property", index + 1, property]);
      const url = new URL(
        `api/media/${item.id}`,
        `${settings.serverUrl.replace(/\/$/, "")}/`,
      ).toString();
      await this.ipc.command([
        "loadfile",
        url,
        "replace",
        -1,
        { start: String(position) },
      ]);
      this.state.playing = true;
      this.emitState();
      await this.configureControls();
      for (const subtitle of item.subtitles) {
        const subtitleUrl = new URL(
          `api/subtitles/${item.id}/${subtitle.id}`,
          `${settings.serverUrl.replace(/\/$/, "")}/`,
        ).toString();
        await this.ipc
          .command([
            "sub-add",
            subtitleUrl,
            "auto",
            subtitle.name,
            subtitle.language ?? "",
          ])
          .catch(() => {});
      }
    } catch (error) {
      this.state.error = spawnError
        ? failureMessage
        : error instanceof Error
          ? error.message
          : "Playback failed.";
      await this.stop();
      this.emitState();
      throw new Error(this.state.error);
    }
  }
  private handleEvent(event: any): void {
    if (event.event === "file-loaded") {
      this.state.loaded = true;
      this.emitState();
    }
    if (event.event === "client-message" && Array.isArray(event.args)) {
      const [name, value] = event.args;
      if (name === "horizon-subtitle-style")
        this.emit("subtitle-style", value, event.args[2]);
      if (name === "horizon-control" && ["pause", "seek"].includes(value)) {
        const position = Number(event.args[2]);
        if (value === "pause" || (Number.isFinite(position) && position >= 0))
          this.emit("control", value, position);
      }
      if (
        name === "horizon-ui" &&
        ["back", "fullscreen", "focus-controls", "watch-together"].includes(
          value,
        )
      )
        this.emit("ui", value);
      if (name === "horizon-ui-ready") {
        this.state.controlsReady = true;
        this.emitState();
      }
      if (name === "horizon-ui-state") {
        this.state.controlsVisible = value === "visible";
        this.emitState();
      }
      if (name === "horizon-ui-menu") {
        this.state.controlsMenu = ["audio", "sub", "style"].includes(value)
          ? value
          : undefined;
        this.emitState();
      }
    }
    if (event.event === "property-change") {
      const value = event.data;
      if (event.name === "time-pos" && typeof value === "number")
        this.state.position = value;
      if (event.name === "duration" && typeof value === "number")
        this.state.duration = value;
      if (event.name === "pause") this.state.paused = !!value;
      if (event.name === "paused-for-cache") this.state.buffering = !!value;
      if (event.name === "volume" && typeof value === "number")
        this.state.volume = value;
      if (event.name === "track-list" && Array.isArray(value))
        this.state.tracks = value;
      if (event.name === "audio-device-list" && Array.isArray(value))
        this.state.devices = value;
      if (Date.now() - this.savedAt > 2000) this.save();
      this.emitState();
    }
    if (event.event === "end-file") {
      this.save(event.reason === "eof");
      if (event.reason === "error")
        this.state.error =
          "The stream could not be played. Check the server connection, file, and selected audio device.";
      this.state.playing = false;
      this.emitState();
    }
  }
  private save(completed = false): void {
    if (!this.state.key || (!this.state.playing && !completed)) return;
    const previous = this.store.progress(this.state.key);
    const watched =
      previous?.watched ||
      completed ||
      (this.state.duration > 0 &&
        this.state.position / this.state.duration >= 0.95);
    this.store.setProgress(this.state.key, {
      position: completed ? 0 : this.state.position,
      duration: this.state.duration,
      watched: !!watched,
      updatedAt: new Date().toISOString(),
    });
    this.savedAt = Date.now();
    this.emit("history", this.store.state().history);
  }
  private emitState(): void {
    this.emit("state", { ...this.state });
  }
  async setAppearance(
    accent?: [number, number, number],
    reduced?: boolean,
    fullscreen?: boolean,
  ): Promise<void> {
    if (accent)
      this.appearance.accent = [...accent]
        .reverse()
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("");
    if (reduced !== undefined) this.appearance.reduced = reduced;
    if (fullscreen !== undefined) {
      this.appearance.fullscreen = fullscreen;
      this.state.fullscreen = fullscreen;
      this.emitState();
    }
    await this.configureControls();
  }
  private async configureControls(): Promise<void> {
    if (!this.ipc) return;
    await this.ipc.command([
      "script-message-to",
      "horizon_player",
      "horizon-config",
      this.appearance.accent,
      this.appearance.reduced ? "reduced" : "motion",
      this.appearance.fullscreen ? "fullscreen" : "windowed",
      "passthrough",
      this.watchBadge.code,
      String(this.watchBadge.viewers),
      String(this.watchBadge.ready),
      this.watchBadge.waiting ? "waiting" : "playing",
    ]);
    await this.configureSubtitleStyle();
  }
  private async configureSubtitleStyle(): Promise<void> {
    const style = this.store.settings();
    await this.ipc?.command([
      "script-message-to",
      "horizon_player",
      "horizon-subtitle-config",
      style.subtitleFont,
      String(style.subtitleSize),
      String(style.subtitleOutline),
      String(style.subtitleShadow),
      String(style.subtitleBold),
      style.subtitleColor,
      String(style.subtitleBackground),
    ]);
  }
  async applySubtitleStyle(): Promise<void> {
    const ipc = this.ipc;
    if (!ipc) return;
    for (const [property, value] of Object.entries(
      subtitleProperties(this.store.settings()),
    )) {
      if (this.ipc !== ipc) return;
      if (this.appliedSubtitleProperties[property] === value) continue;
      await ipc.command(["set_property", property, value]);
      this.appliedSubtitleProperties[property] = value;
    }
    await this.configureSubtitleStyle();
  }
  async focusControl(name: string): Promise<void> {
    await this.ipc?.command([
      "script-message-to",
      "horizon_player",
      "horizon-focus",
      name,
    ]);
  }
  async key(key: PlayerKey): Promise<void> {
    if (!this.state.playing || !this.ipc) return;
    // Keyboard focus can remain with Electron while the native child owns the
    // mouse. Route both through mpv's bindings so menus and Escape stay in sync.
    await this.ipc.command(["keypress", key]);
  }
  async setWatchRoom(code = "", viewers = 0, ready = 0, waiting = false) {
    this.watchBadge = { code, viewers, ready, waiting };
    await this.configureControls();
  }
  async notice(text: string): Promise<void> {
    await this.ipc?.command([
      "script-message-to",
      "horizon_player",
      "horizon-notice",
      text.slice(0, 200),
    ]);
  }
  async command(command: string, value?: number): Promise<void> {
    if (command === "stop") {
      await this.stop();
      return;
    }
    if (!this.ipc) throw new Error("No active playback.");
    if (command === "pause") {
      await this.ipc.command(["cycle", "pause"]);
      this.save();
    } else if (command === "seek")
      await this.ipc.command(["seek", value, "absolute+exact"]);
    else if (command === "audio")
      await this.ipc.command(["set_property", "aid", value]);
    else if (command === "subtitle")
      await this.ipc.command([
        "set_property",
        "sid",
        value === -1 ? "no" : value,
      ]);
  }
  async setPaused(paused: boolean): Promise<void> {
    await this.ipc?.command(["set_property", "pause", paused]);
  }
  async waitReady(mediaId: string): Promise<void> {
    if (
      this.state.mediaId === mediaId &&
      this.state.playing &&
      this.state.loaded
    )
      return;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.off("state", update);
        error ? reject(error) : resolve();
      };
      const update = (state: PlayerState) => {
        if (state.mediaId !== mediaId || state.error)
          finish(new Error(state.error || "Playback changed while loading."));
        else if (state.playing && state.loaded) finish();
      };
      const timer = setTimeout(
        () => finish(new Error("The movie took too long to load.")),
        30000,
      );
      this.on("state", update);
    });
  }
  async stop(): Promise<void> {
    this.save();
    const child = this.process;
    const ipc = this.ipc;
    this.generation++;
    this.process = undefined;
    this.ipc = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      await ipc?.command(["quit"]).catch(() => {});
      if (child.exitCode === null && child.signalCode === null)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill();
            resolve();
          }, 1200);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
    }
    ipc?.close();
    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
      this.tempDir = undefined;
    }
    this.state.playing = false;
    this.emitState();
  }
}
