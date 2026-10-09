import type { MediaItem } from "./types";

type EpisodeOrder = Pick<MediaItem, "season" | "episode" | "filename" | "id">;

export function compareEpisodes(a: EpisodeOrder, b: EpisodeOrder): number {
  return (
    (a.season ?? 0) - (b.season ?? 0) ||
    (a.episode ?? Number.MAX_SAFE_INTEGER) -
      (b.episode ?? Number.MAX_SAFE_INTEGER) ||
    a.filename.localeCompare(b.filename, undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    a.id.localeCompare(b.id)
  );
}

export function orderEpisodes<T extends EpisodeOrder>(
  items: readonly T[],
): T[] {
  return items.toSorted(compareEpisodes);
}
