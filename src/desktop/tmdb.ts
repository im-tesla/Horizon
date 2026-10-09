import type { MediaItem, Metadata } from "../shared/types";
import { groupKey } from "../shared/types";
import type { ClientStore } from "./store";
const image = (file: string | undefined | null, size = "w780") =>
  file ? `https://image.tmdb.org/t/p/${size}${file}` : undefined;
export class Tmdb {
  private pending = new Map<string, Promise<Metadata | undefined>>();
  private failed = new Map<string, number>();
  constructor(private store: ClientStore) {}
  private async request(
    endpoint: string,
    parameters: Record<string, string> = {},
  ): Promise<any> {
    const settings = this.store.settings();
    if (!settings.tmdbKey)
      throw new Error("Add your TMDB API key in Settings to identify titles.");
    const url = new URL(`https://api.themoviedb.org/3/${endpoint}`);
    url.search = new URLSearchParams({
      ...parameters,
      api_key: settings.tmdbKey,
      language: settings.metadataLanguage,
    }).toString();
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch {
      throw new Error("Cannot reach TMDB. Cached metadata is still available.");
    }
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "TMDB rejected the API key. Check Settings."
          : `TMDB request failed (${response.status}).`,
      );
    return response.json();
  }
  private map(result: any, kind: "movie" | "tv"): Metadata {
    return {
      tmdbId: result.id,
      kind,
      title: result.title ?? result.name,
      overview: result.overview ?? "",
      poster: image(result.poster_path, "w500"),
      backdrop: image(result.backdrop_path, "w1280"),
      year:
        Number(
          (result.release_date ?? result.first_air_date ?? "").slice(0, 4),
        ) || undefined,
      rating: result.vote_average,
      genres: result.genres?.map((g: any) => g.name),
    };
  }
  async search(
    query: string,
    kind: "movie" | "tv",
    year?: number,
  ): Promise<Metadata[]> {
    const parameters: Record<string, string> = {
      query,
      include_adult: "false",
    };
    if (year)
      parameters[kind === "movie" ? "year" : "first_air_date_year"] =
        String(year);
    const result = await this.request(`search/${kind}`, parameters);
    return (result.results ?? [])
      .slice(0, 12)
      .map((r: any) => this.map(r, kind));
  }
  private async detail(
    id: number,
    kind: "movie" | "tv",
    seasons: number[],
  ): Promise<Metadata> {
    const metadata = this.map(await this.request(`${kind}/${id}`), kind);
    if (kind === "tv") {
      metadata.episodes = {};
      for (const season of [...new Set(seasons)]) {
        try {
          const result = await this.request(`tv/${id}/season/${season}`);
          for (const episode of result.episodes ?? [])
            metadata.episodes[`${season}:${episode.episode_number}`] = {
              title: episode.name,
              overview: episode.overview ?? "",
              still: image(episode.still_path),
            };
        } catch {
          /* Show metadata remains useful when a season is unavailable. */
        }
      }
    }
    return metadata;
  }
  async match(
    group: string,
    id: number | null,
    kind: "movie" | "tv",
    seasons: number[],
  ): Promise<Record<string, Metadata>> {
    this.store.match(group, id);
    this.failed.delete(group);
    if (id !== null)
      this.store.setMetadata(group, await this.detail(id, kind, seasons));
    return this.store.metadata();
  }
  async resolve(
    items: MediaItem[],
    force = false,
  ): Promise<Record<string, Metadata>> {
    if (!this.store.settings().tmdbKey) return this.store.metadata();
    const groups = new Map<string, MediaItem[]>();
    for (const item of items) {
      const key = groupKey(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const queue = [...groups.entries()];
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const [key, group] = queue[cursor++];
        if (this.store.matches()[key] === null) continue;
        const cached = this.store.metadata()[key];
        const missingEpisodes = group.some(
          (i) =>
            i.kind === "episode" &&
            !cached?.episodes?.[`${i.season}:${i.episode}`],
        );
        if (!force && cached && !missingEpisodes) continue;
        if (!force && (this.failed.get(key) ?? 0) > Date.now() - 5 * 60 * 1000)
          continue;
        if (this.pending.has(key)) {
          await this.pending.get(key);
          continue;
        }
        const promise = (async () => {
          try {
            const first = group[0],
              kind = first.kind === "episode" ? "tv" : "movie";
            const override = this.store.matches()[key];
            let id = override ?? cached?.tmdbId;
            if (!id) {
              let results = await this.search(first.title, kind, first.year);
              if (!results.length && first.year)
                results = await this.search(first.title, kind);
              const normalize = (s: string) =>
                s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
              const best =
                results.find(
                  (r) =>
                    normalize(r.title) === normalize(first.title) &&
                    (!first.year || r.year === first.year),
                ) ??
                results.find(
                  (r) => normalize(r.title) === normalize(first.title),
                );
              // Avoid assigning an unrelated popular result to demo clips or ambiguous filenames.
              if (!best) {
                this.failed.set(key, Date.now());
                return undefined;
              }
              id = best.tmdbId;
            }
            const metadata = await this.detail(
              id,
              kind,
              group.flatMap((i) => (i.season === undefined ? [] : [i.season])),
            );
            this.store.setMetadata(key, metadata);
            return metadata;
          } catch (error) {
            this.failed.set(key, Date.now());
            throw error;
          }
        })();
        this.pending.set(key, promise);
        try {
          await promise;
        } finally {
          this.pending.delete(key);
        }
      }
    };
    await Promise.all([worker(), worker()]);
    return this.store.metadata();
  }
}
