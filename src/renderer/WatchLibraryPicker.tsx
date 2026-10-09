import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Film,
  Search,
  Tv,
  X,
} from "lucide-react";
import {
  groupKey,
  type MediaItem,
  type Metadata,
  type Progress,
} from "../shared/types";
import { resolution as format } from "../shared/media-formats";
import { MediaBadges, WatchedStatus, watchedCount } from "./MediaBadges";
import { orderEpisodes } from "../shared/media-order";

interface Title {
  key: string;
  title: string;
  kind: "movie" | "series";
  items: MediaItem[];
  metadata?: Metadata;
  search: string;
}
const fold = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
const duration = (seconds?: number) =>
  seconds ? `${Math.round(seconds / 60)} min` : "";

export function WatchLibraryPicker({
  items,
  metadata,
  serverId,
  history,
  selectedId,
  onSelect,
  onClose,
}: {
  items: MediaItem[];
  metadata: Record<string, Metadata>;
  serverId: string;
  history: Record<string, Progress>;
  selectedId: string;
  onSelect(id: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "movie" | "series">("all");
  const [limit, setLimit] = useState(60);
  const [seriesKey, setSeriesKey] = useState<string>();
  const [season, setSeason] = useState(1);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const titles = useMemo(() => {
    const result = new Map<string, Title>();
    for (const item of items) {
      // A series occupies one card; movie files remain individually selectable.
      const key = item.kind === "episode" ? groupKey(item) : item.id;
      const details = metadata[groupKey(item)];
      if (!result.has(key))
        result.set(key, {
          key,
          title: details?.title ?? item.title,
          kind: item.kind === "episode" ? "series" : "movie",
          items: [],
          metadata: details,
          search: "",
        });
      result.get(key)!.items.push(item);
    }
    return [...result.values()]
      .map((title) => ({
        ...title,
        items: orderEpisodes(title.items),
        search: fold(
          `${title.title} ${title.items[0].title} ${title.metadata?.year ?? title.items[0].year ?? ""}`,
        ),
      }))
      .sort(
        (a, b) =>
          a.title.localeCompare(b.title, undefined, { numeric: true }) ||
          (b.metadata?.year ?? b.items[0].year ?? 0) -
            (a.metadata?.year ?? a.items[0].year ?? 0),
      );
  }, [items, metadata]);
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  const matches = titles.filter(
    (title) =>
      (filter === "all" || title.kind === filter) &&
      words.every((word) => title.search.includes(word)),
  );
  const series = titles.find((title) => title.key === seriesKey);
  const seasons = series
    ? [...new Set(series.items.map((item) => item.season ?? 0))]
    : [];
  const currentSeason = seasons.includes(season) ? season : seasons[0];
  const episodes =
    series?.items.filter((item) => (item.season ?? 0) === currentSeason) ?? [];
  useEffect(() => {
    setLimit(60);
    list.current?.scrollTo(0, 0);
  }, [query, filter]);
  useEffect(() => {
    if (!seriesKey) search.current?.focus({ preventScroll: true });
    list.current?.scrollTo(0, 0);
  }, [seriesKey]);
  return (
    <section
      className="room-library page-enter"
      aria-label="Choose something to watch"
    >
      <div className="room-library-heading">
        <div>
          <span className="eyebrow subtle">FIND YOUR NEXT SHARED MOMENT</span>
          <h2>Choose something to watch</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close library browser"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {series ? (
        <>
          <button
            className="text-button picker-back"
            onClick={() => setSeriesKey(undefined)}
          >
            <ArrowLeft size={16} /> Back to titles
          </button>
          <div className="picker-series-heading">
            {series.metadata?.poster && (
              <img src={series.metadata.poster} alt="" />
            )}
            <div>
              <span className="eyebrow subtle">TV SERIES</span>
              <h3>{series.title}</h3>
              <p>
                {series.metadata?.overview ||
                  `${series.items.length} episodes in your library`}
              </p>
            </div>
          </div>
          <div
            className="picker-seasons"
            role="group"
            aria-label="Choose a season"
          >
            {seasons.map((number) => (
              <button
                key={number}
                className={number === currentSeason ? "active" : ""}
                aria-pressed={number === currentSeason}
                onClick={() => {
                  setSeason(number);
                  list.current?.scrollTo(0, 0);
                }}
              >
                {number === 0 ? "Specials" : `Season ${number}`}
              </button>
            ))}
          </div>
          <div className="picker-results picker-episodes" ref={list}>
            {episodes.map((item) => {
              const episode =
                series.metadata?.episodes?.[`${item.season}:${item.episode}`];
              return (
                <button
                  key={item.id}
                  className={`picker-episode ${item.id === selectedId ? "selected" : ""}`}
                  data-media-id={item.id}
                  aria-label={`Select ${series.title}, season ${item.season ?? 0}, episode ${item.episode ?? 0}`}
                  onClick={() => onSelect(item.id)}
                >
                  <div className="picker-episode-image">
                    {episode?.still ? (
                      <img
                        src={episode.still}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span>{String(item.episode ?? 0).padStart(2, "0")}</span>
                    )}
                  </div>
                  <div className="picker-episode-copy">
                    <strong>
                      {item.episode}.{" "}
                      {episode?.title ?? `Episode ${item.episode}`}
                    </strong>
                    <span>{episode?.overview || item.filename}</span>
                    <small className="episode-meta">
                      <span>{duration(item.duration)}</span>
                      <WatchedStatus
                        count={watchedCount([item], serverId, history)}
                      />
                    </small>
                    <MediaBadges item={item} />
                  </div>
                  {item.id === selectedId ? (
                    <Check size={19} />
                  ) : (
                    <ChevronRight size={19} />
                  )}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="picker-toolbar">
            <div className="picker-search">
              <Search size={18} />
              <input
                ref={search}
                aria-label="Search room library"
                placeholder="Search titles or year"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Clear title search"
                  onClick={() => {
                    setQuery("");
                    search.current?.focus();
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <div
              className="picker-filters"
              role="group"
              aria-label="Filter room library"
            >
              {(
                [
                  { value: "all", label: "All titles" },
                  { value: "movie", label: "Movies" },
                  { value: "series", label: "TV series" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  aria-pressed={filter === option.value}
                  className={filter === option.value ? "active" : ""}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <p className="picker-count" role="status">
            {matches.length.toLocaleString()}{" "}
            {matches.length === 1 ? "title" : "titles"}
            {query && ` matching “${query}”`}
          </p>
          <div className="picker-results" ref={list}>
            {matches.length ? (
              <>
                <div className="picker-grid">
                  {matches.slice(0, limit).map((title) => {
                    const item = title.items[0],
                      picked = title.items.some(
                        (item) => item.id === selectedId,
                      );
                    return (
                      <button
                        key={title.key}
                        className={`picker-title ${picked ? "selected" : ""}`}
                        data-media-id={
                          title.kind === "movie" ? item.id : undefined
                        }
                        aria-label={
                          title.kind === "series"
                            ? `Choose episodes of ${title.title}`
                            : `Select ${title.title}${item.year ? ` (${item.year})` : ""}${format(item) ? ` · ${format(item)}` : ""}`
                        }
                        onClick={() => {
                          if (title.kind === "series") {
                            setSeason(
                              title.items.find((item) => item.id === selectedId)
                                ?.season ??
                                title.items[0].season ??
                                0,
                            );
                            setSeriesKey(title.key);
                          } else onSelect(item.id);
                        }}
                      >
                        <div className="picker-poster">
                          {title.metadata?.poster ? (
                            <img
                              src={title.metadata.poster}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <div className="picker-poster-placeholder">
                              {title.kind === "series" ? (
                                <Tv size={30} strokeWidth={1.3} />
                              ) : (
                                <Film size={30} strokeWidth={1.3} />
                              )}
                              <span>{title.title}</span>
                            </div>
                          )}
                          {picked && (
                            <span className="picker-selected-mark">
                              <Check size={16} />
                            </span>
                          )}
                          <span className="picker-card-action">
                            {title.kind === "series"
                              ? "Choose episode"
                              : "Select movie"}
                            <ChevronRight size={14} />
                          </span>
                          {title.kind === "series" && (
                            <span className="picker-card-badge">
                              {title.items.length} episodes
                            </span>
                          )}
                        </div>
                        <strong title={title.title}>{title.title}</strong>
                        <span className="picker-title-meta">
                          {[
                            title.metadata?.year ?? item.year,
                            title.kind === "series"
                              ? "TV series"
                              : duration(item.duration) || "Movie",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <WatchedStatus
                          count={watchedCount(title.items, serverId, history)}
                          total={title.items.length}
                        />
                        {title.kind === "movie" && <MediaBadges item={item} />}
                      </button>
                    );
                  })}
                </div>
                {matches.length > limit && (
                  <div className="picker-more">
                    <button
                      className="secondary-button compact"
                      onClick={() => {
                        const nextIndex = limit;
                        setLimit((current) => current + 60);
                        requestAnimationFrame(() => {
                          const next =
                            list.current?.querySelectorAll<HTMLButtonElement>(
                              ".picker-title",
                            )[nextIndex];
                          next?.focus({ preventScroll: true });
                          next?.scrollIntoView({ block: "nearest" });
                        });
                      }}
                    >
                      Show more titles <ChevronRight size={15} />
                    </button>
                    <span>
                      {Math.min(limit, matches.length)} of{" "}
                      {matches.length.toLocaleString()}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="picker-empty">
                <Search size={28} strokeWidth={1.4} />
                <h3>{query ? "No matching titles" : "No titles here yet"}</h3>
                <p>
                  {query
                    ? "Try a different title or year, or change the filter."
                    : "Movies and series appear here when they are added to your server."}
                </p>
                {query && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setQuery("");
                      search.current?.focus();
                    }}
                  >
                    Clear search
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
