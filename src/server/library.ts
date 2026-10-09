import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  realpath,
  stat,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import { parseFilename } from "../shared/filenames";
import type { Library, MediaItem, MediaTrack } from "../shared/types";

const exec = promisify(execFile);
const probeVersion = 2;
const videoExtensions = new Set([
  ".mkv",
  ".mp4",
  ".m4v",
  ".avi",
  ".mov",
  ".ts",
  ".m2ts",
  ".mts",
  ".webm",
  ".mpg",
  ".mpeg",
]);
const subtitleExtensions = new Set([
  ".srt",
  ".ass",
  ".ssa",
  ".vtt",
  ".sub",
  ".sup",
]);
interface IndexedItem {
  item: MediaItem;
  file: string;
  subtitles: Map<string, string>;
  fingerprint: string;
}
export interface LibraryOptions {
  mediaDir: string;
  dataDir: string;
  ffprobe?: string;
  polling?: boolean;
}
export class MediaLibrary extends EventEmitter {
  private files = new Map<string, IndexedItem>();
  private watcher?: ReturnType<typeof chokidar.watch>;
  private timer?: NodeJS.Timeout;
  private reconciliation?: NodeJS.Timeout;
  private scanPromise?: Promise<void>;
  private rescan = false;
  private stopped = false;
  private revision = 0;
  private scannedAt = "";
  private root = "";
  serverId = "";
  constructor(private options: LibraryOptions) {
    super();
  }
  async start(): Promise<void> {
    await mkdir(this.options.mediaDir, { recursive: true });
    await mkdir(this.options.dataDir, { recursive: true });
    this.root = await realpath(this.options.mediaDir);
    const identityFile = path.join(this.options.dataDir, "identity");
    try {
      this.serverId = (await readFile(identityFile, "utf8")).trim();
    } catch {
      this.serverId = randomUUID();
      await writeFile(identityFile, this.serverId, { mode: 0o600 });
    }
    try {
      const cache: {
        probeVersion?: number;
        items: { item: MediaItem; relative: string; fingerprint: string }[];
      } = JSON.parse(
        await readFile(path.join(this.options.dataDir, "index.json"), "utf8"),
      );
      for (const entry of cache.items)
        this.files.set(entry.item.id, {
          ...entry,
          // Refresh old profiles once while preserving added dates and IDs.
          fingerprint:
            cache.probeVersion === probeVersion ? entry.fingerprint : "",
          file: path.resolve(this.root, entry.relative),
          subtitles: new Map(),
        });
    } catch {
      /* A missing or stale cache is rebuilt from the media folder. */
    }
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      followSymlinks: false,
      usePolling: this.options.polling,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 250 },
      ignored: (file, entry) =>
        entry?.isDirectory() === true && path.basename(file).startsWith("."),
    });
    this.watcher.on("all", () => this.schedule());
    // Rename/delete can occur before chokidar's pending add event settles.
    // Native events reconcile that race after the same upload stability period.
    this.watcher.on("raw", () => this.schedule(2500));
    this.watcher.on("error", (error) => this.emit("watch-error", error));
    await new Promise<void>((resolve) => this.watcher!.once("ready", resolve));
    this.reconciliation = setInterval(() => this.schedule(), 60000);
    this.reconciliation.unref();
    await this.scan();
  }
  snapshot(): Library {
    return {
      serverId: this.serverId,
      revision: this.revision,
      scannedAt: this.scannedAt,
      scanning: !!this.scanPromise,
      items: [...this.files.values()]
        .map((value) => value.item)
        .sort(
          (a, b) =>
            a.title.localeCompare(b.title) ||
            (a.season ?? 0) - (b.season ?? 0) ||
            (a.episode ?? 0) - (b.episode ?? 0),
        ),
    };
  }
  private schedule(delay = 350): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.scan().catch((error) => this.emit("scan-error", error));
    }, delay);
  }
  async scan(): Promise<void> {
    if (this.scanPromise) {
      this.rescan = true;
      return this.scanPromise;
    }
    this.scanPromise = (async () => {
      do {
        this.rescan = false;
        await this.scanOnce();
      } while (this.rescan && !this.stopped);
    })();
    try {
      await this.scanPromise;
    } finally {
      this.scanPromise = undefined;
    }
  }
  private async scanOnce(): Promise<void> {
    const candidates: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (
          entry.isFile() &&
          videoExtensions.has(path.extname(file).toLowerCase())
        )
          candidates.push(file);
      }
    };
    await walk(this.root);
    const next = new Map<string, IndexedItem>();
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < candidates.length) {
        const file = candidates[cursor++];
        try {
          const info = await stat(file);
          if (!info.size) continue;
          const relative = path.relative(this.root, file).replaceAll("\\", "/");
          const id = createHash("sha256")
            .update(relative)
            .digest("hex")
            .slice(0, 32);
          const fingerprint = `${info.size}:${info.mtimeMs}`;
          const cached = this.files.get(id);
          const probe =
            cached?.fingerprint === fingerprint
              ? {
                  duration: cached.item.duration,
                  tracks: cached.item.tracks,
                  probeError: cached.item.probeError,
                }
              : await this.probe(file);
          // A file changing during probing is retried after writing settles.
          const after = await stat(file);
          if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) {
            this.schedule();
            continue;
          }
          const item: MediaItem = {
            id,
            filename: path.basename(file),
            ...parseFilename(path.basename(file), path.dirname(relative)),
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
            addedAt: cached?.item.addedAt ?? new Date().toISOString(),
            ...probe,
            subtitles: [],
          };
          const subtitles = new Map<string, string>();
          const stem = path.parse(file).name.toLocaleLowerCase();
          for (const sibling of await readdir(path.dirname(file), {
            withFileTypes: true,
          })) {
            if (
              !sibling.isFile() ||
              !subtitleExtensions.has(path.extname(sibling.name).toLowerCase())
            )
              continue;
            const subStem = path.parse(sibling.name).name.toLocaleLowerCase();
            if (subStem !== stem && !subStem.startsWith(`${stem}.`)) continue;
            const sid = createHash("sha256")
              .update(sibling.name)
              .digest("hex")
              .slice(0, 16);
            subtitles.set(sid, path.join(path.dirname(file), sibling.name));
            item.subtitles.push({
              id: sid,
              name: sibling.name,
              language:
                subStem.slice(stem.length + 1).split(".")[0] || undefined,
            });
          }
          next.set(id, { item, file, subtitles, fingerprint });
        } catch {
          /* Removed or temporarily unreadable files are excluded from this scan. */
        }
      }
    };
    await Promise.all([worker(), worker()]);
    const changed =
      JSON.stringify(
        [...this.files.values()]
          .map((v) => v.item)
          .sort((a, b) => a.id.localeCompare(b.id)),
      ) !==
      JSON.stringify(
        [...next.values()]
          .map((v) => v.item)
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    this.files = next;
    this.scannedAt = new Date().toISOString();
    if (changed) {
      this.revision++;
      this.emit("changed", this.revision);
    }
    const cache = {
      probeVersion,
      items: [...next.values()].map((v) => ({
        item: v.item,
        fingerprint: v.fingerprint,
        relative: path.relative(this.root, v.file),
      })),
    };
    const cachePath = path.join(this.options.dataDir, "index.json");
    await writeFile(`${cachePath}.tmp`, JSON.stringify(cache), { mode: 0o600 });
    await rename(`${cachePath}.tmp`, cachePath);
  }
  private async probe(
    file: string,
  ): Promise<{ duration?: number; tracks: MediaTrack[]; probeError?: string }> {
    try {
      const { stdout } = await exec(
        this.options.ffprobe ?? "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration:stream=codec_type,codec_name,profile,channels,channel_layout,width,height:stream_tags=language,title",
          "-of",
          "json",
          file,
        ],
        { timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      );
      const result = JSON.parse(stdout);
      const tracks: MediaTrack[] = (result.streams ?? [])
        .filter((s: { codec_type: string }) =>
          ["audio", "video", "subtitle"].includes(s.codec_type),
        )
        .map((s: any) => ({
          type: s.codec_type,
          codec: s.codec_name ?? "unknown",
          profile: typeof s.profile === "string" ? s.profile : undefined,
          channelLayout: s.channel_layout,
          channels: s.channels,
          width: s.width,
          height: s.height,
          language: s.tags?.language,
          title: s.tags?.title,
        }));
      const duration = Number(result.format?.duration);
      return {
        tracks,
        duration:
          Number.isFinite(duration) && duration > 0 ? duration : undefined,
      };
    } catch {
      return {
        tracks: [],
        probeError:
          "Media inspection unavailable. Check ffprobe installation or file integrity.",
      };
    }
  }
  async resolve(id: string, subtitleId?: string): Promise<string | undefined> {
    const entry = this.files.get(id);
    const file = subtitleId ? entry?.subtitles.get(subtitleId) : entry?.file;
    if (!file) return undefined;
    try {
      if ((await lstat(file)).isSymbolicLink()) return undefined;
      const resolved = await realpath(file);
      const relative = path.relative(this.root, resolved);
      if (
        relative.startsWith(`..${path.sep}`) ||
        relative === ".." ||
        path.isAbsolute(relative)
      )
        return undefined;
      return resolved;
    } catch {
      return undefined;
    }
  }
  async close(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.reconciliation);
    await this.watcher?.close();
    await this.scanPromise;
  }
}
