import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  session,
  nativeTheme,
  systemPreferences,
  clipboard,
  shell,
} from "electron";
import { config } from "dotenv";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { autoUpdater } from "electron-updater";
import { ClientStore } from "./store";
import { UpdateManager } from "./updates";
import { Player } from "./player";
import { WatchTogether } from "./watch-together";
import { Tmdb } from "./tmdb";
import { VideoSurface } from "./video-surface";
import { themeFromArtwork } from "./artwork";
import { defaultSubtitleStyle, subtitleStyleSchema } from "../shared/subtitles";
import type { Settings } from "../shared/types";
import type { Library, MediaItem, UpdateState } from "../shared/types";

if (!app.isPackaged) config({ quiet: true });
if (process.env.HORIZON_USER_DATA)
  app.setPath("userData", process.env.HORIZON_USER_DATA);
app.setName("Horizon");
// Native child-window embedding uses X11; Wayland sessions use XWayland.
if (process.platform === "linux")
  app.commandLine.appendSwitch("ozone-platform", "x11");
const devUrl = !app.isPackaged ? process.env.HORIZON_DEV_URL : undefined;
let window: BrowserWindow | undefined;
let store: ClientStore;
let player: Player;
let watch: WatchTogether;
let prepared:
  | {
      id: string;
      resolve: () => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  | undefined;
let videoSurface: VideoSurface;
let tmdb: Tmdb;
let library: Library | undefined;
let updateState: UpdateState = {
  status: "disabled",
  message: "Updates are available in GitHub release builds.",
};
let updates: UpdateManager;
let quitting = false;
let playbackQueue: Promise<void> = Promise.resolve();
function send(channel: string, data: unknown) {
  if (window && !window.isDestroyed())
    window.webContents.send(`horizon:${channel}`, data);
}
const serverUrl = z
  .string()
  .max(2048)
  .transform((s) => s.trim().replace(/\/$/, ""))
  .refine((s) => {
    if (!s) return true;
    try {
      const url = new URL(s);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "Use an HTTP or HTTPS server URL without embedded credentials.");
const settingsSchema = z
  .object({
    serverUrl,
    token: z
      .string()
      .max(4096)
      .refine((s) => !/[\r\n]/.test(s)),
    tmdbKey: z
      .string()
      .max(512)
      .refine((s) => !/[\r\n]/.test(s)),
    mpvPath: z.string().max(2048),
    watchName: z.string().trim().min(1).max(40),
    ...subtitleStyleSchema.shape,
    subtitleLanguage: z.string().regex(/^[a-zA-Z, -]{0,40}$/),
    metadataLanguage: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
    autoUpdates: z.boolean(),
  })
  .partial()
  .strict();
let subtitleQueue: Promise<void> = Promise.resolve();
function saveSubtitleSettings(patch: Partial<Settings>) {
  store.saveSettings(patch);
  // Mouse repeats and accessibility controls share one ordered live update path.
  subtitleQueue = subtitleQueue
    .catch(() => {})
    .then(() => player.applySubtitleStyle());
  return subtitleQueue.then(() => {
    const settings = store.publicSettings();
    send("settings", settings);
    return settings;
  });
}
function handle(name: string, callback: (...args: any[]) => any) {
  ipcMain.handle(`horizon:${name}`, async (event, ...args) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Untrusted application frame.");
    return callback(...args);
  });
}
async function fetchLibrary(): Promise<Library> {
  const settings = store.settings();
  if (!settings.serverUrl || !settings.token)
    throw new Error("Add your server address and access token in Settings.");
  let response: Response;
  try {
    response = await fetch(`${settings.serverUrl}/api/library`, {
      headers: { Authorization: `Bearer ${settings.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "Cannot connect to your server. Check its address and network connection.",
    );
  }
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "The server rejected the access token. Check Settings."
        : `Server returned HTTP ${response.status}.`,
    );
  const result = (await response.json()) as Library;
  if (
    !Array.isArray(result.items) ||
    typeof result.serverId !== "string" ||
    result.items.some(
      (i) =>
        typeof i.id !== "string" ||
        !/^[a-f0-9]{32}$/.test(i.id) ||
        typeof i.title !== "string" ||
        !Array.isArray(i.tracks) ||
        !Array.isArray(i.subtitles),
    )
  )
    throw new Error("This server returned an incompatible library.");
  library = result;
  return result;
}
function update(next: UpdateState) {
  updateState = next;
  send("update", next);
}
function configureUpdates() {
  const manifest = JSON.parse(
    readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"),
  );
  const marker = path.join(process.resourcesPath, "package-type");
  updates = new UpdateManager(
    {
      packaged: app.isPackaged,
      feed: existsSync(path.join(process.resourcesPath, "app-update.yml")),
      platform: process.platform,
      portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
      appImage: !!process.env.APPIMAGE,
      packageType: existsSync(marker)
        ? readFileSync(marker, "utf8").trim()
        : "",
      repository: manifest.horizonRepository ?? "im-tesla/Horizon",
      version: app.getVersion(),
    },
    autoUpdater,
    update,
  );
  updateState = updates.state;
}
async function checkUpdates(): Promise<UpdateState> {
  return updates.check();
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#0b0c0f",
    title: "Horizon",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  videoSurface = new VideoSurface(window);
  window.on("close", () => videoSurface?.dispose());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.once("ready-to-show", () => window?.show());
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(path.join(__dirname, "../renderer/index.html"));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      store = new ClientStore(
        app.getPath("userData"),
        app.isPackaged
          ? {}
          : {
              serverUrl: process.env.HORIZON_SERVER_URL,
              token: process.env.HORIZON_TOKEN,
              tmdbKey: process.env.TMDB_API_KEY,
              mpvPath: process.env.HORIZON_MPV_PATH,
            },
      );
      tmdb = new Tmdb(store);
      player = new Player(
        store,
        app.isPackaged
          ? path.join(process.resourcesPath, "mpv")
          : path.join(
              app.getAppPath(),
              "resources",
              "mpv",
              `${process.platform}-${process.arch}`,
            ),
        () => videoSurface.id,
        app.isPackaged
          ? process.resourcesPath
          : path.join(app.getAppPath(), "resources"),
      );
      let themedMedia: string | undefined;
      player.on("state", (state) => {
        videoSurface?.setPlaying(state.playing);
        send("player", state);
        if (state.playing && state.mediaId !== themedMedia) {
          themedMedia = state.mediaId;
          void player
            .setAppearance(
              undefined,
              systemPreferences.getAnimationSettings().prefersReducedMotion,
              window?.isFullScreen(),
            )
            .catch(() => {});
          const item = library?.items.find((i) => i.id === state.mediaId);
          const details =
            item &&
            store.metadata()[
              `${item.kind === "episode" ? "tv" : "movie"}:${item.title.toLocaleLowerCase("en-US")}:${item.year ?? ""}`
            ];
          const artwork = details && (details.poster ?? details.backdrop);
          if (artwork)
            void themeFromArtwork(artwork)
              .then((palette) => {
                if (player.state.mediaId === state.mediaId)
                  return player.setAppearance(palette.accent);
              })
              .catch(() => {});
        }
      });
      player.on("history", (history) => send("history", history));
      player.on("subtitle-style", (field: string, value: string) => {
        try {
          const numeric = ["subtitleSize", "subtitleOutline", "subtitleShadow"];
          const boolean = ["subtitleBold", "subtitleBackground"];
          const patch =
            field === "reset"
              ? defaultSubtitleStyle
              : subtitleStyleSchema
                  .partial()
                  .strict()
                  .parse({
                    [field]: numeric.includes(field)
                      ? Number(value)
                      : boolean.includes(field)
                        ? z.enum(["true", "false"]).parse(value) === "true"
                        : value,
                  });
          void saveSubtitleSettings(patch).catch((error) => {
            if (process.env.HORIZON_MPV_TEST === "true")
              console.error("SUBTITLE_STYLE:", error.message);
            void player.notice("Could not update subtitle style.");
          });
        } catch {
          void player.notice("Could not update subtitle style.");
        }
      });
      watch = new WatchTogether(
        store,
        player,
        () => (library ? Promise.resolve(library) : fetchLibrary()),
        (mediaId) =>
          new Promise<void>((resolve, reject) => {
            if (prepared) {
              clearTimeout(prepared.timer);
              prepared.reject(new Error("Playback selection changed."));
            }
            const id = randomUUID();
            const timer = setTimeout(() => {
              if (prepared?.id === id) prepared = undefined;
              reject(
                new Error(
                  "The player could not open. Return to the room and try again.",
                ),
              );
            }, 15000);
            prepared = { id, resolve, reject, timer };
            send("watch-playback", { mediaId, requestId: id });
          }),
      );
      watch.on("state", (state) => {
        if (!state.room && prepared) {
          clearTimeout(prepared.timer);
          prepared.reject(new Error("The room was closed."));
          prepared = undefined;
        }
        send("watch-state", state);
        const room = state.room;
        void player
          .setWatchRoom(
            room?.code,
            room?.members.length,
            room?.members.filter(
              (m: { ready: boolean; buffering: boolean }) =>
                m.ready && !m.buffering,
            ).length,
            room?.waiting,
          )
          .catch(() => {});
      });
      player.on("control", (action, position) => {
        if (watch.active) void watch.command(action, position).catch(() => {});
      });
      player.on("ui", (action) => {
        if (action === "fullscreen")
          window?.setFullScreen(!window.isFullScreen());
        if (action === "focus-controls") {
          window?.webContents.focus();
          send("player-focus", undefined);
        }
        if (action === "back")
          void watch
            .leave()
            .then(() => player.stop())
            .then(() => {
              window?.setFullScreen(false);
              send("player-back", undefined);
            });
        if (action === "watch-together")
          void watch
            .pause()
            .catch(() => {})
            .then(() => send("watch-lobby", undefined));
      });
      const syncAppearance = () =>
        void player
          .setAppearance(
            undefined,
            systemPreferences.getAnimationSettings().prefersReducedMotion,
            window?.isFullScreen(),
          )
          .catch(() => {});
      nativeTheme.on("updated", syncAppearance);
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      Menu.setApplicationMenu(null);
      handle("state", () => store.state());
      handle("player-state", () => player.state);
      handle("player-key", (key: unknown) =>
        player.key(z.enum(["SPACE", "LEFT", "RIGHT", "f", "ESC"]).parse(key)),
      );
      handle("player-focus", (name: unknown) =>
        player.focusControl(
          z
            .enum([
              "",
              "pause",
              "rewind",
              "forward",
              "seek",
              "tracks",
              "subtitle-style",
              "fullscreen",
              "back",
              "watch-together",
            ])
            .parse(name),
        ),
      );
      handle("settings", async (patch: unknown) => {
        const parsed = settingsSchema.parse(patch);
        if (
          watch.active &&
          ((parsed.serverUrl !== undefined &&
            parsed.serverUrl !== store.settings().serverUrl) ||
            (parsed.token?.trim() &&
              parsed.token.trim() !== store.settings().token))
        ) {
          await watch.leave();
          await player.stop();
        }
        library = undefined;
        return saveSubtitleSettings(parsed);
      });
      handle("watch-state", () => watch.state);
      handle("watch-create", async (name: unknown, id: unknown) => {
        const watchName = z.string().trim().min(1).max(40).parse(name);
        const mediaId = z
          .string()
          .regex(/^[a-f0-9]{32}$/)
          .optional()
          .parse(id);
        store.saveSettings({ watchName });
        await watch.create(watchName, mediaId);
      });
      handle("watch-join", async (code: unknown, name: unknown) => {
        const watchName = z.string().trim().min(1).max(40).parse(name);
        const roomCode = z
          .string()
          .regex(/^[A-Z2-9]{8}$/)
          .parse(code);
        store.saveSettings({ watchName });
        await watch.join(roomCode, watchName);
      });
      handle("watch-leave", async () => {
        await watch.leave();
        await player.stop();
      });
      handle("watch-play", (id: unknown) =>
        watch.play(
          z
            .string()
            .regex(/^[a-f0-9]{32}$/)
            .parse(id),
        ),
      );
      handle("watch-ready", (id: unknown) => {
        const requestId = z.string().uuid().parse(id);
        if (prepared?.id !== requestId)
          throw new Error("This playback request expired.");
        clearTimeout(prepared.timer);
        prepared.resolve();
        prepared = undefined;
      });
      handle("watch-copy", () => {
        if (watch.state.room) clipboard.writeText(watch.state.room.code);
      });
      handle("library", fetchLibrary);
      handle("video-bounds", (bounds: unknown) =>
        videoSurface.update(
          z
            .object({
              x: z.number().finite().min(0).max(20000),
              y: z.number().finite().min(0).max(20000),
              width: z.number().finite().min(0).max(20000),
              height: z.number().finite().min(0).max(20000),
              scale: z.number().finite().min(0.5).max(8),
            })
            .strict()
            .nullable()
            .parse(bounds),
        ),
      );
      handle("fullscreen", (enabled: unknown) =>
        window?.setFullScreen(z.boolean().parse(enabled)),
      );
      handle("artwork-theme", (source: unknown) =>
        themeFromArtwork(z.string().min(1).max(2048).parse(source)),
      );
      handle("metadata", (_items: unknown, force: unknown) =>
        tmdb.resolve(library?.items ?? [], force === true),
      );
      handle("metadata-search", (query: unknown, kind: unknown) =>
        tmdb.search(
          z.string().min(1).max(200).parse(query),
          z.enum(["movie", "tv"]).parse(kind),
        ),
      );
      handle(
        "metadata-match",
        (group: unknown, id: unknown, kind: unknown, seasons: unknown) =>
          tmdb.match(
            z.string().min(1).max(500).parse(group),
            z.number().int().positive().nullable().parse(id),
            z.enum(["movie", "tv"]).parse(kind),
            z.array(z.number().int().min(0).max(999)).max(100).parse(seasons),
          ),
      );
      handle("play", (id: unknown, restart: unknown) => {
        const mediaId = z
          .string()
          .regex(/^[a-f0-9]{32}$/)
          .parse(id);
        const next = playbackQueue
          .catch(() => {})
          .then(async () => {
            const current = library ?? (await fetchLibrary());
            const item = current.items.find((i) => i.id === mediaId);
            if (!item)
              throw new Error(
                "This file is no longer in the library. Refresh and try again.",
              );
            if (watch.active) {
              await watch.play(
                mediaId,
                restart === true
                  ? 0
                  : (store.progress(`${current.serverId}:${mediaId}`)
                      ?.position ?? 0),
              );
              return;
            }
            await player.start(item, current.serverId, restart === true);
            syncAppearance();
            const metadata =
              store.metadata()[
                `${item.kind === "episode" ? "tv" : "movie"}:${item.title.toLocaleLowerCase("en-US")}:${item.year ?? ""}`
              ];
            const artwork = metadata?.poster ?? metadata?.backdrop;
            if (artwork)
              void themeFromArtwork(artwork)
                .then((palette) => {
                  if (player.state.mediaId === item.id)
                    return player.setAppearance(palette.accent);
                })
                .catch(() => {});
          });
        playbackQueue = next;
        return next;
      });
      handle("player-command", (command: unknown, value: unknown) => {
        const action = z
          .enum(["pause", "seek", "audio", "subtitle", "stop"])
          .parse(command);
        const number =
          value === undefined
            ? undefined
            : z.number().finite().min(-1).max(1e9).parse(value);
        if (
          ["seek", "audio", "subtitle"].includes(action) &&
          number === undefined
        )
          throw new Error("Missing playback command value.");
        if (watch.active && (action === "pause" || action === "seek"))
          return watch.command(action, number);
        if (action === "stop") return watch.leave().then(() => player.stop());
        return player.command(action, number);
      });
      handle("watched", (key: unknown, watched: unknown) => {
        const history = store.setWatched(
          z.string().min(1).max(200).parse(key),
          z.boolean().parse(watched),
        );
        send("history", history);
        return history;
      });
      handle("updates", checkUpdates);
      handle("update-state", () => updateState);
      handle("update-download", async () => {
        if (!updateState.downloadUrl)
          throw new Error("No update download is available.");
        await shell.openExternal(updateState.downloadUrl);
      });
      handle("install-update", async () => {
        if (updateState.status !== "ready")
          throw new Error("No downloaded update is ready.");
        await watch.leave();
        await player.stop();
        autoUpdater.quitAndInstall(false, true);
      });
      configureUpdates();
      await createWindow();
      window?.on("enter-full-screen", syncAppearance);
      window?.on("leave-full-screen", syncAppearance);
      if (store.settings().autoUpdates)
        setTimeout(() => {
          void checkUpdates();
        }, 5000);
      setInterval(
        () => {
          if (store.settings().autoUpdates && !player.state.playing)
            void checkUpdates();
        },
        6 * 60 * 60 * 1000,
      ).unref();
    })
    .catch((error) => {
      console.error(
        error instanceof Error ? error.message : "Application startup failed.",
      );
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    if (player)
      void watch
        ?.leave()
        .catch(() => {})
        .then(() => player.stop())
        .finally(() => app.quit());
    else app.quit();
  });
}
