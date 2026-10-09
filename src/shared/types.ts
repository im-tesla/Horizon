export interface ParsedName {
  title: string;
  year?: number;
  kind: "movie" | "episode";
  season?: number;
  episode?: number;
}
export interface MediaTrack {
  type: "video" | "audio" | "subtitle";
  codec: string;
  profile?: string;
  channelLayout?: string;
  language?: string;
  title?: string;
  channels?: number;
  width?: number;
  height?: number;
}
export interface Sidecar {
  id: string;
  name: string;
  language?: string;
}
export interface MediaItem extends ParsedName {
  id: string;
  filename: string;
  size: number;
  modifiedAt: string;
  addedAt: string;
  duration?: number;
  tracks: MediaTrack[];
  subtitles: Sidecar[];
  probeError?: string;
}
export interface Library {
  serverId: string;
  revision: number;
  scannedAt: string;
  scanning: boolean;
  items: MediaItem[];
}
export interface Metadata {
  tmdbId: number;
  kind: "movie" | "tv";
  title: string;
  overview: string;
  poster?: string;
  backdrop?: string;
  year?: number;
  rating?: number;
  genres?: string[];
  episodes?: Record<
    string,
    { title: string; overview: string; still?: string }
  >;
}
export interface Progress {
  position: number;
  duration: number;
  watched: boolean;
  updatedAt: string;
}
export interface SubtitleStyle {
  subtitleFont: "Inter" | "Noto Serif" | "Noto Sans Mono";
  subtitleSize: number;
  subtitleOutline: number;
  subtitleShadow: number;
  subtitleBold: boolean;
  subtitleColor: "white" | "warm" | "yellow";
  subtitleBackground: boolean;
}
export interface Settings extends SubtitleStyle {
  serverUrl: string;
  token: string;
  tmdbKey: string;
  mpvPath: string;
  watchName: string;
  subtitleLanguage: string;
  metadataLanguage: string;
  autoUpdates: boolean;
}
export interface PublicSettings extends Omit<Settings, "token" | "tmdbKey"> {
  hasToken: boolean;
  hasTmdbKey: boolean;
  secureStorage: boolean;
}
export interface LocalState {
  settings: PublicSettings;
  history: Record<string, Progress>;
  metadata: Record<string, Metadata>;
  matches: Record<string, number | null>;
}
export interface PlayerTrack {
  id: number;
  type: "audio" | "sub" | "video";
  title?: string;
  lang?: string;
  codec?: string;
  selected?: boolean;
  external?: boolean;
}
export interface PlayerState {
  playing: boolean;
  paused: boolean;
  key?: string;
  mediaId?: string;
  title?: string;
  position: number;
  duration: number;
  volume: number;
  tracks: PlayerTrack[];
  devices: { name: string; description: string }[];
  error?: string;
  controlsReady?: boolean;
  controlsVisible?: boolean;
  controlsMenu?: "audio" | "sub" | "style";
  fullscreen?: boolean;
  loaded?: boolean;
  buffering?: boolean;
}
export interface VideoBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}
export type PlayerKey = "SPACE" | "LEFT" | "RIGHT" | "f" | "ESC";
export interface ArtworkPalette {
  accent: [number, number, number];
  ambient: [number, number, number];
}
export interface UpdateState {
  status:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "error";
  message: string;
  percent?: number;
  downloadUrl?: string;
}
export interface HorizonBridge {
  state(): Promise<LocalState>;
  saveSettings(patch: Partial<Settings>): Promise<PublicSettings>;
  library(): Promise<Library>;
  metadata(
    items: MediaItem[],
    force?: boolean,
  ): Promise<Record<string, Metadata>>;
  searchMetadata(query: string, kind: "movie" | "tv"): Promise<Metadata[]>;
  matchMetadata(
    group: string,
    id: number | null,
    kind: "movie" | "tv",
    seasons: number[],
  ): Promise<Record<string, Metadata>>;
  play(itemId: string, restart?: boolean): Promise<void>;
  videoBounds(bounds: VideoBounds | null): Promise<void>;
  fullscreen(enabled: boolean): Promise<void>;
  artworkTheme(source: string): Promise<ArtworkPalette>;
  playerCommand(
    command: "pause" | "seek" | "audio" | "subtitle" | "stop",
    value?: number,
  ): Promise<void>;
  playerState(): Promise<PlayerState>;
  playerKey(key: PlayerKey): Promise<void>;
  focusPlayerControl(name: string): Promise<void>;
  watchState(): Promise<WatchState>;
  watchCreate(name: string, mediaId?: string): Promise<void>;
  watchJoin(code: string, name: string): Promise<void>;
  watchLeave(): Promise<void>;
  watchPlay(mediaId: string): Promise<void>;
  watchReady(requestId: string): Promise<void>;
  watchCopyCode(): Promise<void>;
  onWatchState(callback: (state: WatchState) => void): () => void;
  onWatchPlayback(
    callback: (request: WatchPlaybackRequest) => void,
  ): () => void;
  onWatchLobby(callback: () => void): () => void;
  setWatched(key: string, watched: boolean): Promise<Record<string, Progress>>;
  checkUpdates(): Promise<UpdateState>;
  openUpdateDownload(): Promise<void>;
  updateState(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onPlayer(callback: (state: PlayerState) => void): () => void;
  onPlayerBack(callback: () => void): () => void;
  onPlayerFocus(callback: () => void): () => void;
  onHistory(callback: (history: Record<string, Progress>) => void): () => void;
  onSettings(callback: (settings: PublicSettings) => void): () => void;
  onUpdate(callback: (state: UpdateState) => void): () => void;
}
export function groupKey(item: ParsedName): string {
  return `${item.kind === "episode" ? "tv" : "movie"}:${item.title.toLocaleLowerCase("en-US")}:${item.year ?? ""}`;
}
export function historyKey(serverId: string, itemId: string): string {
  return `${serverId}:${itemId}`;
}
import type { WatchState, WatchPlaybackRequest } from "./watch-together";
