import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { defaultSubtitleStyle, subtitleStyleSchema } from "../shared/subtitles";
import type {
  LocalState,
  Metadata,
  Progress,
  PublicSettings,
  Settings,
} from "../shared/types";

interface DiskState {
  settings: Omit<Settings, "token" | "tmdbKey">;
  secrets: { token?: string; tmdbKey?: string };
  history: Record<string, Progress>;
  metadata: Record<string, Metadata>;
  matches: Record<string, number | null>;
}
export class ClientStore {
  private data: DiskState;
  private secrets: { token: string; tmdbKey: string };
  private file: string;
  constructor(directory: string, defaults: Partial<Settings> = {}) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, "state.json");
    this.data = {
      settings: {
        serverUrl: defaults.serverUrl ?? "",
        mpvPath: defaults.mpvPath ?? "",
        watchName: "Guest",
        ...defaultSubtitleStyle,
        subtitleLanguage: "en",
        metadataLanguage: "en-US",
        autoUpdates: true,
      },
      secrets: {},
      history: {},
      metadata: {},
      matches: {},
    };
    if (existsSync(this.file)) {
      try {
        const saved = JSON.parse(readFileSync(this.file, "utf8"));
        // Retire the old audio preferences without touching history or secrets.
        const {
          audioMode: _mode,
          audioDevice: _device,
          ...settings
        } = saved.settings ?? {};
        this.data = {
          ...this.data,
          ...saved,
          settings: { ...this.data.settings, ...settings },
        };
      } catch {
        try {
          renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        } catch {}
      }
    }
    for (const [key, schema] of Object.entries(subtitleStyleSchema.shape)) {
      const value = schema.safeParse(
        this.data.settings[key as keyof typeof defaultSubtitleStyle],
      );
      Object.assign(this.data.settings, {
        [key]: value.success
          ? value.data
          : defaultSubtitleStyle[key as keyof typeof defaultSubtitleStyle],
      });
    }
    this.secrets = {
      token: this.decrypt(this.data.secrets.token) || defaults.token || "",
      tmdbKey:
        this.decrypt(this.data.secrets.tmdbKey) || defaults.tmdbKey || "",
    };
  }
  private secure(): boolean {
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        safeStorage.getSelectedStorageBackend() !== "basic_text")
    );
  }
  private encrypt(value: string): string {
    return this.secure()
      ? `encrypted:${safeStorage.encryptString(value).toString("base64")}`
      : `local:${Buffer.from(value).toString("base64")}`;
  }
  private decrypt(value?: string): string {
    if (!value) return "";
    try {
      return value.startsWith("encrypted:")
        ? safeStorage.decryptString(Buffer.from(value.slice(10), "base64"))
        : value.startsWith("local:")
          ? Buffer.from(value.slice(6), "base64").toString("utf8")
          : "";
    } catch {
      return "";
    }
  }
  settings(): Settings {
    return { ...this.data.settings, ...this.secrets };
  }
  publicSettings(): PublicSettings {
    return {
      ...this.data.settings,
      hasToken: !!this.secrets.token,
      hasTmdbKey: !!this.secrets.tmdbKey,
      secureStorage: this.secure(),
    };
  }
  state(): LocalState {
    return {
      settings: this.publicSettings(),
      history: this.data.history,
      metadata: this.data.metadata,
      matches: this.data.matches,
    };
  }
  saveSettings(patch: Partial<Settings>): PublicSettings {
    const { token, tmdbKey, ...settings } = patch;
    if (token !== undefined && token.trim()) this.secrets.token = token.trim();
    if (tmdbKey !== undefined && tmdbKey.trim())
      this.secrets.tmdbKey = tmdbKey.trim();
    if (
      settings.metadataLanguage &&
      settings.metadataLanguage !== this.data.settings.metadataLanguage
    )
      this.data.metadata = {};
    this.data.settings = { ...this.data.settings, ...settings };
    this.persist();
    return this.publicSettings();
  }
  progress(key: string): Progress | undefined {
    return this.data.history[key];
  }
  setProgress(key: string, value: Progress): void {
    this.data.history[key] = value;
    this.persist();
  }
  setWatched(key: string, watched: boolean): Record<string, Progress> {
    const previous = this.data.history[key];
    this.data.history[key] = {
      position: previous?.position ?? 0,
      duration: previous?.duration ?? 0,
      watched,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return this.data.history;
  }
  metadata(): Record<string, Metadata> {
    return this.data.metadata;
  }
  matches(): Record<string, number | null> {
    return this.data.matches;
  }
  setMetadata(key: string, value: Metadata): void {
    this.data.metadata[key] = value;
    this.persist();
  }
  match(key: string, id: number | null): void {
    this.data.matches[key] = id;
    delete this.data.metadata[key];
    this.persist();
  }
  private persist(): void {
    this.data.secrets = {
      token: this.encrypt(this.secrets.token),
      tmdbKey: this.encrypt(this.secrets.tmdbKey),
    };
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data, null, 2), {
      mode: 0o600,
    });
    renameSync(`${this.file}.tmp`, this.file);
  }
}
