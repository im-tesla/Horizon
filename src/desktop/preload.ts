import { contextBridge, ipcRenderer } from "electron";
import type { HorizonBridge } from "../shared/types";
const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`horizon:${name}`, ...args);
const listen = <T>(name: string, callback: (value: T) => void) => {
  const listener = (_event: unknown, value: T) => callback(value);
  ipcRenderer.on(`horizon:${name}`, listener);
  return () => ipcRenderer.removeListener(`horizon:${name}`, listener);
};
const bridge: HorizonBridge = {
  state: () => invoke("state"),
  saveSettings: (patch) => invoke("settings", patch),
  library: () => invoke("library"),
  metadata: (items, force) => invoke("metadata", items, force),
  searchMetadata: (query, kind) => invoke("metadata-search", query, kind),
  matchMetadata: (group, id, kind, seasons) =>
    invoke("metadata-match", group, id, kind, seasons),
  play: (id, restart) => invoke("play", id, restart),
  videoBounds: (bounds) => invoke("video-bounds", bounds),
  fullscreen: (enabled) => invoke("fullscreen", enabled),
  artworkTheme: (source) => invoke("artwork-theme", source),
  playerCommand: (command, value) => invoke("player-command", command, value),
  playerState: () => invoke("player-state"),
  playerKey: (key) => invoke("player-key", key),
  focusPlayerControl: (name) => invoke("player-focus", name),
  setWatched: (key, watched) => invoke("watched", key, watched),
  checkUpdates: () => invoke("updates"),
  updateState: () => invoke("update-state"),
  openUpdateDownload: () => invoke("update-download"),
  installUpdate: () => invoke("install-update"),
  onPlayer: (callback) => listen("player", callback),
  onPlayerBack: (callback) => listen("player-back", callback),
  onPlayerFocus: (callback) => listen("player-focus", callback),
  onHistory: (callback) => listen("history", callback),
  onSettings: (callback) => listen("settings", callback),
  onUpdate: (callback) => listen("update", callback),
  watchState: () => invoke("watch-state"),
  watchCreate: (name, id) => invoke("watch-create", name, id),
  watchJoin: (code, name) => invoke("watch-join", code, name),
  watchLeave: () => invoke("watch-leave"),
  watchPlay: (id) => invoke("watch-play", id),
  watchReady: (id) => invoke("watch-ready", id),
  watchCopyCode: () => invoke("watch-copy"),
  onWatchState: (callback) => listen("watch-state", callback),
  onWatchPlayback: (callback) => listen("watch-playback", callback),
  onWatchLobby: (callback) => listen("watch-lobby", callback),
};
contextBridge.exposeInMainWorld("horizon", bridge);
