import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Film,
  LayoutGrid,
  LoaderCircle,
  MonitorPlay,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Speaker,
  Tv,
  UsersRound,
  X,
} from "lucide-react";
import {
  groupKey,
  historyKey,
  type Library,
  type LocalState,
  type MediaItem,
  type Metadata,
  type PlayerState,
  type PlayerKey,
  type PublicSettings,
  type Settings,
  type UpdateState,
} from "../shared/types";
import { WatchTogetherPage } from "./WatchTogetherPage";
import type { WatchState } from "../shared/watch-together";
import { defaultPalette } from "../shared/palette";
import { resolution as quality, formatBadges } from "../shared/media-formats";
import { MediaBadges, WatchedStatus, watchedCount } from "./MediaBadges";

type View = "all" | "movie" | "tv" | "continue" | "watched";
type Page = "library" | "settings" | "details" | "player" | "together";
interface Group {
  key: string;
  items: MediaItem[];
  metadata?: Metadata;
  title: string;
}
const bridge = window.horizon;

function useArtworkTheme(source?: string) {
  const [palette, setPalette] = useState(defaultPalette);
  useEffect(() => {
    let active = true;
    if (!source || !bridge) setPalette(defaultPalette);
    else
      void bridge
        .artworkTheme(source)
        .then((next) => {
          if (active) setPalette(next);
        })
        .catch(() => {
          if (active) setPalette(defaultPalette);
        });
    return () => {
      active = false;
    };
  }, [source]);
  return {
    "--accent-rgb": palette.accent.join(" "),
    "--ambient-rgb": palette.ambient.join(" "),
  } as CSSProperties;
}
const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : "Something went wrong.").replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
const time = (seconds: number) => {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};
const runtime = (seconds?: number) =>
  seconds
    ? `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}h ` : ""}${Math.floor((seconds % 3600) / 60)}m`
    : "";
const audio = (item: MediaItem) =>
  formatBadges(item).find((badge) => badge.kind === "audio")?.label ?? "";
const seasonEpisode = (item: MediaItem) =>
  `S${String(item.season).padStart(2, "0")} E${String(item.episode).padStart(2, "0")}`;

export default function App() {
  const [local, setLocal] = useState<LocalState>();
  const [library, setLibrary] = useState<Library>();
  const libraryRef = useRef<Library | undefined>(undefined);
  libraryRef.current = library;
  const [watch, setWatch] = useState<WatchState>({ status: "idle" });
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [error, setError] = useState("");
  const [metadataError, setMetadataError] = useState("");
  const [connected, setConnected] = useState(false);
  const [page, setPage] = useState<Page>("library");
  const [detailKey, setDetailKey] = useState<string>();
  const [playbackId, setPlaybackId] = useState<string>();
  const [starting, setStarting] = useState<string>();
  const [player, setPlayer] = useState<PlayerState>({
    playing: false,
    paused: false,
    position: 0,
    duration: 0,
    volume: 100,
    tracks: [],
    devices: [],
  });
  const [update, setUpdate] = useState<UpdateState>({
    status: "disabled",
    message: "Updates are enabled in GitHub release builds.",
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshInFlight = useRef(false);
  const refresh = useCallback(async (manual = false) => {
    if (!bridge || refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (manual) setBusy(true);
    try {
      const next = await bridge.library();
      setLibrary(next);
      setConnected(true);
      setError("");
      setMetadataBusy(true);
      try {
        const metadata = await bridge.metadata(next.items);
        setLocal((value) => (value ? { ...value, metadata } : value));
        setMetadataError("");
      } catch (failure) {
        setMetadataError(errorText(failure));
        const state = await bridge.state();
        setLocal(state);
      } finally {
        setMetadataBusy(false);
      }
    } catch (failure) {
      setError(errorText(failure));
      setConnected(false);
    } finally {
      refreshInFlight.current = false;
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!bridge) return;
    void bridge.state().then((state) => {
      setLocal(state);
      if (!state.settings.serverUrl || !state.settings.hasToken)
        setPage("settings");
      else void refresh(true);
    });
    const offPlayer = bridge.onPlayer((state) => {
      setPlayer(state);
      if (state.error) setError(state.error);
      if (state.playing) setStarting(undefined);
    });
    const offHistory = bridge.onHistory((history) =>
      setLocal((state) => (state ? { ...state, history } : state)),
    );
    const offSettings = bridge.onSettings((settings) =>
      setLocal((state) => (state ? { ...state, settings } : state)),
    );
    const offUpdate = bridge.onUpdate(setUpdate);
    void bridge
      .updateState()
      .then(setUpdate)
      .catch(() => {});
    const offBack = bridge.onPlayerBack(() => setPage("details"));
    void bridge.watchState().then(setWatch);
    const offWatch = bridge.onWatchState((state) => {
      setWatch(state);
      const me = state.room?.members.find(
        (member) => member.id === state.memberId,
      );
      if (me)
        setLocal((current) =>
          current
            ? {
                ...current,
                settings: { ...current.settings, watchName: me.name },
              }
            : current,
        );
    });
    const offLobby = bridge.onWatchLobby(() => setPage("together"));
    const offPlayback = bridge.onWatchPlayback((request) => {
      void (async () => {
        const current = libraryRef.current ?? (await bridge.library());
        setLibrary(current);
        const item = current.items.find((item) => item.id === request.mediaId);
        if (!item) throw new Error("This movie is no longer in the library.");
        await stagePlayer(item);
        await bridge.watchReady(request.requestId);
      })().catch((failure) => {
        setStarting(undefined);
        setError(errorText(failure));
      });
    });
    const timer = setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      offPlayer();
      offHistory();
      offSettings();
      offUpdate();
      offBack();
      offWatch();
      offLobby();
      offPlayback();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "k" &&
        !document.querySelector(".playback-page")
      ) {
        event.preventDefault();
        setPage("library");
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (event.key === "Escape" && !document.querySelector(".playback-page"))
        setPage("library");
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const allGroups = useMemo(() => {
    const result = new Map<string, Group>();
    for (const item of library?.items ?? []) {
      const key = groupKey(item);
      const metadata = local?.metadata[key];
      if (!result.has(key))
        result.set(key, {
          key,
          items: [],
          metadata,
          title: metadata?.title ?? item.title,
        });
      result.get(key)!.items.push(item);
    }
    return [...result.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [library, local?.metadata]);
  const getProgress = (item: MediaItem) =>
    local?.history[historyKey(library?.serverId ?? "", item.id)];
  const nextItem = (group: Group) =>
    group.items.find((item) => {
      const p = getProgress(item);
      return p && p.position > 0 && !p.watched;
    }) ??
    group.items.find((item) => !getProgress(item)?.watched) ??
    group.items[0];
  const groups = allGroups.filter((group) => {
    if (
      query &&
      !`${group.title} ${group.items[0].title}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
    )
      return false;
    if (view === "movie" && group.items[0].kind !== "movie") return false;
    if (view === "tv" && group.items[0].kind !== "episode") return false;
    if (
      view === "continue" &&
      !group.items.some((item) => {
        const p = getProgress(item);
        return p && p.position > 0 && !p.watched;
      })
    )
      return false;
    if (
      view === "watched" &&
      !group.items.some((item) => getProgress(item)?.watched)
    )
      return false;
    return true;
  });
  const featured = [...groups].sort(
    (a, b) =>
      Number(!!b.metadata?.backdrop) - Number(!!a.metadata?.backdrop) ||
      (b.metadata?.rating ?? 0) - (a.metadata?.rating ?? 0),
  )[0];
  const detail = allGroups.find((group) => group.key === detailKey);
  const playbackItem = library?.items.find((item) => item.id === playbackId);
  const playbackGroup = allGroups.find((group) =>
    group.items.some((item) => item.id === playbackId),
  );
  const themedGroup =
    page === "details"
      ? detail
      : page === "player"
        ? playbackGroup
        : page === "together"
          ? (allGroups.find((group) =>
              group.items.some(
                (item) => item.id === watch.room?.selectedMediaId,
              ),
            ) ?? featured)
          : featured;
  const theme = useArtworkTheme(
    themedGroup?.metadata?.poster ?? themedGroup?.metadata?.backdrop,
  );
  function openDetails(key: string) {
    setDetailKey(key);
    setPage("details");
  }
  const resumeGroups = allGroups.filter((group) =>
    group.items.some((item) => {
      const p = getProgress(item);
      return p && p.position > 0 && !p.watched;
    }),
  );
  async function stagePlayer(item: MediaItem) {
    setStarting(item.id);
    setError("");
    setPlaybackId(item.id);
    setDetailKey(groupKey(item));
    setPage("player");
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const rect = document
      .querySelector(".video-surface")
      ?.getBoundingClientRect();
    if (!rect) throw new Error("The in-app video surface is unavailable.");
    await bridge!.videoBounds({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      scale: window.devicePixelRatio,
    });
  }
  async function play(item: MediaItem, restart = false) {
    if (!bridge || starting) return;
    try {
      await stagePlayer(item);
      await bridge.play(item.id, restart);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setStarting(undefined);
    }
  }
  async function together(item: MediaItem) {
    try {
      await bridge!.watchCreate(local?.settings.watchName ?? "Guest", item.id);
      setPage("together");
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  async function watched(item: MediaItem, value: boolean) {
    try {
      const history = await bridge!.setWatched(
        historyKey(library!.serverId, item.id),
        value,
      );
      setLocal((state) => (state ? { ...state, history } : state));
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  const labels: Record<View, string> = {
    all: "Your library",
    movie: "Movies",
    tv: "TV series",
    continue: "Continue watching",
    watched: "Watched",
  };
  const nav: { view: View; label: string; icon: typeof Film }[] = [
    { view: "all", label: "Library", icon: LayoutGrid },
    { view: "movie", label: "Movies", icon: Film },
    { view: "tv", label: "TV series", icon: Tv },
    { view: "continue", label: "Continue watching", icon: Clock3 },
    { view: "watched", label: "Watched", icon: CheckCheck },
  ];
  return (
    <div
      className={`app-shell ${page === "player" ? "is-playing" : ""}`}
      style={theme}
    >
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => {
            setView("all");
            setQuery("");
            setPage("library");
          }}
          aria-label="Horizon home"
        >
          <span>
            horizon<span className="brand-dot">.</span>
          </span>
        </button>
        <div className="sidebar-heading">YOUR SPACE</div>
        <nav aria-label="Library navigation">
          {nav.map((item) => (
            <button
              key={item.view}
              className={`nav-item ${page === "library" && view === item.view ? "active" : ""}`}
              onClick={() => {
                setView(item.view);
                setQuery("");
                setPage("library");
              }}
            >
              <item.icon size={18} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.view === "continue" && resumeGroups.length > 0 && (
                <small>{resumeGroups.length}</small>
              )}
            </button>
          ))}
          <button
            className={`nav-item ${page === "together" ? "active" : ""}`}
            onClick={() => setPage("together")}
          >
            <UsersRound size={18} strokeWidth={1.7} />
            <span>Watch together</span>
            {watch.room && <small>{watch.room.members.length}</small>}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <Settings2 size={18} />
            <span>Settings</span>
            {update.status === "ready" && <span className="update-dot" />}
          </button>
          <div className="server-status">
            <span className={`status-dot ${connected ? "online" : ""}`} />
            <span>{connected ? "Server connected" : "Server offline"}</span>
          </div>
        </div>
      </aside>
      <main className="main-content">
        {page !== "player" && (
          <header className="topbar">
            {page !== "library" && (
              <button
                className="icon-button page-back"
                aria-label="Back to library"
                onClick={() => setPage("library")}
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <div className="breadcrumb">
              Your space <span>/</span>{" "}
              <strong>
                {page === "settings"
                  ? "Settings"
                  : page === "together"
                    ? "Watch together"
                    : page === "details"
                      ? detail?.title
                      : labels[view]}
              </strong>
            </div>
            {page === "library" && (
              <>
                <div className="search-box">
                  <Search size={17} />
                  <input
                    ref={searchRef}
                    aria-label="Search your library"
                    placeholder="Search your library"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <kbd>Ctrl K</kbd>
                  {query && (
                    <button
                      className="icon-button"
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <button
                  className={`icon-button refresh ${busy ? "spinning" : ""}`}
                  aria-label="Refresh library"
                  disabled={busy}
                  onClick={() => void refresh(true)}
                >
                  <RefreshCw size={18} />
                </button>
              </>
            )}
          </header>
        )}
        {page !== "library" && page !== "player" && error && (
          <div className="notice error route-error" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {page === "library" && (
          <div className="page-scroll page-enter" key={view}>
            {!bridge && (
              <div className="notice error">
                Open Horizon with <code>npm run dev</code> or the installed
                desktop app to connect to your server.
              </div>
            )}
            {error && (
              <div className="notice error" role="alert">
                <span>{error}</span>
                <button
                  className="icon-button"
                  onClick={() => setError("")}
                  aria-label="Dismiss error"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {metadataError && (
              <div className="notice" role="status">
                <span>{metadataError}</span>
                <button
                  className="text-button"
                  onClick={() => setPage("settings")}
                >
                  Settings <ArrowRight size={14} />
                </button>
              </div>
            )}
            {featured &&
              !query &&
              view !== "continue" &&
              view !== "watched" && (
                <section
                  className={`hero ${featured.metadata?.backdrop ? "with-image" : ""}`}
                  aria-label="Featured title"
                  style={
                    featured.metadata?.backdrop
                      ? {
                          backgroundImage: `url("${featured.metadata.backdrop}")`,
                        }
                      : undefined
                  }
                >
                  <div className="hero-shade" />
                  <div className="hero-content">
                    <div className="eyebrow">
                      <span /> FROM YOUR LIBRARY
                    </div>
                    <h1>{featured.title}</h1>
                    <div className="hero-meta">
                      {featured.metadata?.year ?? featured.items[0].year}
                      <span className="meta-dot" />
                      {featured.items[0].kind === "episode"
                        ? `${new Set(featured.items.map((i) => i.season)).size} season${new Set(featured.items.map((i) => i.season)).size > 1 ? "s" : ""}`
                        : runtime(featured.items[0].duration)}
                      {featured.metadata?.genres?.[0] && (
                        <>
                          <span className="meta-dot" />
                          {featured.metadata.genres[0]}
                        </>
                      )}
                      {quality(featured.items[0]) && (
                        <span className="format-badge">
                          {quality(featured.items[0])}
                        </span>
                      )}
                      <span className="format-badge original">ORIGINAL</span>
                    </div>
                    <p>
                      {featured.metadata?.overview ||
                        "Your media, exactly as it was meant to be experienced. Stream the original file with native playback and your choice of sound."}
                    </p>
                    <div className="hero-actions">
                      <button
                        className="primary-button"
                        disabled={!!starting}
                        onClick={() => void play(nextItem(featured))}
                      >
                        {starting === nextItem(featured).id ? (
                          <LoaderCircle className="spinning" size={18} />
                        ) : (
                          <Play size={18} fill="currentColor" />
                        )}
                        {getProgress(nextItem(featured))?.position &&
                        !getProgress(nextItem(featured))?.watched
                          ? "Resume watching"
                          : "Watch now"}
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => openDetails(featured.key)}
                      >
                        View details <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="hero-corner">
                    <Speaker size={15} />
                    <span>{audio(featured.items[0]) || "Native audio"}</span>
                  </div>
                </section>
              )}
            {resumeGroups.length > 0 && view === "all" && !query && (
              <section className="continue-section">
                <div className="section-title">
                  <h2>Pick up where you left off</h2>
                  <button
                    className="text-button"
                    onClick={() => setView("continue")}
                  >
                    View all <ArrowRight size={15} />
                  </button>
                </div>
                <div className="continue-grid">
                  {resumeGroups.slice(0, 3).map((group) => {
                    const item = nextItem(group),
                      progress = getProgress(item)!;
                    return (
                      <button
                        className="continue-card"
                        key={group.key}
                        onClick={() => void play(item)}
                      >
                        {group.metadata?.backdrop ? (
                          <img src={group.metadata.backdrop} alt="" />
                        ) : (
                          <div className="continue-placeholder" />
                        )}
                        <span className="continue-play">
                          <Play size={18} fill="currentColor" />
                        </span>
                        <div className="continue-copy">
                          <strong>{group.title}</strong>
                          <span>
                            {item.kind === "episode"
                              ? seasonEpisode(item)
                              : "Movie"}{" "}
                            ·{" "}
                            {runtime(
                              Math.max(
                                0,
                                progress.duration - progress.position,
                              ),
                            )}{" "}
                            left
                          </span>
                        </div>
                        <div className="continue-progress">
                          <span
                            style={{
                              width: `${Math.min(100, (progress.position / (progress.duration || 1)) * 100)}%`,
                            }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            <section className="library-section">
              <div className="section-title">
                <div>
                  <div className="eyebrow subtle">CURATED BY YOU</div>
                  <h2>
                    {query ? `Results for “${query}”` : labels[view]}{" "}
                    <span className="count">{groups.length}</span>
                  </h2>
                </div>
                <div className="library-tools">
                  {metadataBusy && (
                    <span className="matching">
                      <LoaderCircle size={13} className="spinning" /> Finding
                      details
                    </span>
                  )}
                  <span className="sort-label">
                    <SlidersHorizontal size={14} /> A–Z
                  </span>
                </div>
              </div>
              {busy && !library ? (
                <div className="empty-state">
                  <LoaderCircle size={30} className="spinning" />
                  <h3>Connecting to your library</h3>
                  <p>Your next watch is on its way.</p>
                </div>
              ) : groups.length ? (
                <div className="poster-grid">
                  {groups.map((group, index) => {
                    const item = nextItem(group);
                    return (
                      <button
                        className="poster-card"
                        key={group.key}
                        style={
                          {
                            "--card-delay": `${Math.min(index, 10) * 35}ms`,
                          } as CSSProperties
                        }
                        onClick={() => openDetails(group.key)}
                      >
                        <div className="poster-art">
                          {group.metadata?.poster ? (
                            <img
                              src={group.metadata.poster}
                              alt={`${group.title} poster`}
                              loading="lazy"
                            />
                          ) : (
                            <div className="poster-placeholder">
                              <Film size={32} strokeWidth={1} />
                              <span>{group.title}</span>
                            </div>
                          )}
                          <div className="poster-shade" />
                          <span className="poster-play">
                            <Play size={24} fill="currentColor" />
                          </span>
                          {group.items[0].kind === "episode" && (
                            <span className="episode-count">
                              {group.items.length} episodes
                            </span>
                          )}
                        </div>
                        <h3>{group.title}</h3>
                        <div className="poster-meta">
                          <span>
                            {[
                              group.metadata?.year ?? item.year,
                              group.metadata?.genres?.[0] ??
                                (item.kind === "episode"
                                  ? "TV series"
                                  : runtime(item.duration) || "Movie"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                        <WatchedStatus
                          count={watchedCount(
                            group.items,
                            library?.serverId ?? "",
                            local?.history ?? {},
                          )}
                          total={group.items.length}
                        />
                        {item.kind === "movie" && <MediaBadges item={item} />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  <Film size={34} strokeWidth={1.2} />
                  <h3>
                    {query
                      ? "No matching titles"
                      : view === "continue"
                        ? "A fresh start"
                        : view === "watched"
                          ? "Your story starts here"
                          : connected
                            ? "Your library is ready for movies"
                            : "Bring your library home"}
                  </h3>
                  <p>
                    {query
                      ? "Try a different title."
                      : view === "continue"
                        ? "Movies and episodes you start will appear here."
                        : view === "watched"
                          ? "Finished movies and episodes will appear here."
                          : connected
                            ? "Add media to your server’s folder. Horizon will find it automatically."
                            : "Connect your server to see your movies and series."}
                  </p>
                  {!connected && (
                    <button
                      className="primary-button"
                      onClick={() => setPage("settings")}
                    >
                      Connect server <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
        {page === "settings" && local && (
          <SettingsPage
            settings={local.settings}
            update={update}
            onClose={() => setPage("library")}
            onError={setError}
            onUpdate={setUpdate}
            onSave={async (patch) => {
              const settings = await bridge!.saveSettings(patch);
              setLocal((state) => (state ? { ...state, settings } : state));
              if (!local.settings.hasToken) setPage("library");
              await refresh(true);
            }}
          />
        )}
        {page === "details" && detail && (
          <DetailPage
            key={detail.key}
            group={detail}
            next={nextItem(detail)}
            history={local?.history ?? {}}
            serverId={library!.serverId}
            starting={starting}
            onPlay={play}
            onTogether={together}
            onWatched={watched}
            onMetadata={(metadata) =>
              setLocal((state) => (state ? { ...state, metadata } : state))
            }
            onError={setError}
          />
        )}
        {page === "together" && local && (
          <WatchTogetherPage
            watch={watch}
            library={library}
            metadata={local.metadata}
            history={local.history}
            name={local.settings.watchName}
            player={player}
            onError={setError}
            onReturn={async () => {
              const item = library?.items.find(
                (item) => item.id === player.mediaId,
              );
              if (item) {
                await stagePlayer(item);
                setStarting(undefined);
              }
            }}
          />
        )}
        {page === "player" && playbackItem && (
          <PlayerPage
            player={player}
            settings={local?.settings}
            item={playbackItem}
            group={playbackGroup}
            starting={!!starting}
            error={error}
            onError={setError}
            onPlay={() => void play(playbackItem, true)}
            onBack={async () => {
              await bridge!.playerCommand("stop");
              await bridge!.fullscreen(false);
              setPage(detail ? "details" : "library");
            }}
          />
        )}
      </main>
    </div>
  );
}

function PlayerPage({
  player,
  settings,
  item,
  group,
  starting,
  error,
  onError,
  onBack,
  onPlay,
}: {
  player: PlayerState;
  settings?: PublicSettings;
  item: MediaItem;
  group?: Group;
  starting: boolean;
  error: string;
  onError(message: string): void;
  onBack(): Promise<void>;
  onPlay(): void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(
    () => setFullscreen(player.fullscreen ?? false),
    [player.fullscreen],
  );
  useEffect(
    () =>
      bridge!.onPlayerFocus(() => {
        document
          .querySelector<HTMLButtonElement>(
            ".player-accessibility .play-control",
          )
          ?.focus();
      }),
    [],
  );
  const back = () =>
    void onBack().catch((failure) => onError(errorText(failure)));
  const toggleFullscreen = useCallback(() => {
    const next = !fullscreen;
    void bridge!
      .fullscreen(next)
      .then(() => setFullscreen(next))
      .catch((failure) => onError(errorText(failure)));
  }, [fullscreen, onError]);
  useLayoutEffect(() => {
    const update = () => {
      const rect = surface.current?.getBoundingClientRect();
      if (rect)
        void bridge!
          .videoBounds({
            x: Math.max(0, rect.x),
            y: Math.max(0, rect.y),
            width: rect.width,
            height: rect.height,
            scale: window.devicePixelRatio,
          })
          .catch((failure) => onError(errorText(failure)));
    };
    const observer = new ResizeObserver(update);
    if (surface.current) observer.observe(surface.current);
    update();
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      void bridge!.videoBounds(null);
    };
  }, [onError]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      const key: PlayerKey | undefined =
        event.code === "Space"
          ? "SPACE"
          : event.key === "ArrowLeft"
            ? "LEFT"
            : event.key === "ArrowRight"
              ? "RIGHT"
              : event.key === "Escape"
                ? "ESC"
                : event.key.toLowerCase() === "f"
                  ? "f"
                  : undefined;
      if (key && player.playing) {
        if (key === "SPACE" && event.target instanceof HTMLButtonElement)
          return;
        event.preventDefault();
        void bridge!
          .playerKey(key)
          .catch((failure) => onError(errorText(failure)));
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        toggleFullscreen();
      }
      if (event.key === "Escape" && fullscreen) {
        void bridge!.fullscreen(false);
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [player.playing, fullscreen, toggleFullscreen, onError]);
  return (
    <section className="playback-page" aria-label="In-app player">
      <header
        className={`playback-header ${player.playing ? "visually-hidden" : ""}`}
      >
        <button className="secondary-button" onClick={back}>
          <ArrowLeft size={17} /> Back to title
        </button>
        <div>
          <h1>{group?.title ?? item.title}</h1>
          <p>
            {item.kind === "episode" ? seasonEpisode(item) : "Movie"} ·{" "}
            {quality(item) || "Original quality"} · {audio(item)}
          </p>
        </div>
        <button
          className="icon-button fullscreen-button"
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize2 size={21} /> : <Maximize2 size={21} />}
        </button>
      </header>
      <div
        className="video-surface"
        ref={surface}
        onDoubleClick={toggleFullscreen}
      >
        {!player.playing && (
          <div className="video-status">
            {starting ? (
              <>
                <LoaderCircle size={32} className="spinning" />
                <p>Opening your stream…</p>
              </>
            ) : (
              <>
                <Play size={34} />
                <h2>
                  {error ? "Playback couldn’t start" : "Ready when you are"}
                </h2>
                {error && <p role="alert">{error}</p>}
                <button className="primary-button" onClick={onPlay}>
                  Play again
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {player.playing && (
        <div
          className="player-accessibility visually-hidden"
          role="group"
          aria-label="Playback controls"
          onFocusCapture={(event) => {
            const target = event.target as HTMLElement;
            void bridge!.focusPlayerControl(
              target.dataset.playerControl ?? "pause",
            );
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              void bridge!.focusPlayerControl("");
          }}
        >
          <PlayerBar
            player={player}
            settings={settings}
            onError={onError}
            onStop={back}
          />
        </div>
      )}
    </section>
  );
}

function PlayerBar({
  player,
  settings,
  onError,
  onStop,
}: {
  player: PlayerState;
  settings?: PublicSettings;
  onError(message: string): void;
  onStop(): void;
}) {
  const command = (
    action: Parameters<NonNullable<typeof bridge>["playerCommand"]>[0],
    value?: number,
  ) => {
    void bridge!
      .playerCommand(action, value)
      .catch((error) => onError(errorText(error)));
  };
  return (
    <div className="player-bar">
      <div className="playing-title">
        <div className="audio-wave">
          <span />
          <span />
          <span />
        </div>
        <div>
          <strong>{player.title}</strong>
          <span>Original audio · HDMI</span>
        </div>
      </div>
      <button
        className="play-control"
        data-player-control="pause"
        aria-label={player.paused ? "Resume playback" : "Pause playback"}
        onClick={() => command("pause")}
      >
        {player.paused ? (
          <Play size={19} fill="currentColor" />
        ) : (
          <Pause size={19} fill="currentColor" />
        )}
      </button>
      <div className="seek-control">
        <span>{time(player.position)}</span>
        <input
          aria-label="Playback position"
          data-player-control="seek"
          type="range"
          min="0"
          max={player.duration || 1}
          value={player.position}
          onChange={(event) => command("seek", Number(event.target.value))}
        />
        <span>{time(player.duration)}</span>
      </div>
      <select
        aria-label="Audio track"
        data-player-control="tracks"
        value={
          player.tracks.find((t) => t.type === "audio" && t.selected)?.id ?? ""
        }
        onChange={(event) => command("audio", Number(event.target.value))}
      >
        {player.tracks
          .filter((t) => t.type === "audio")
          .map((track) => (
            <option key={track.id} value={track.id}>
              {track.title ?? track.lang ?? `Audio ${track.id}`} · {track.codec}
            </option>
          ))}
      </select>
      <select
        aria-label="Subtitle track"
        data-player-control="tracks"
        value={
          player.tracks.find((t) => t.type === "sub" && t.selected)?.id ?? -1
        }
        onChange={(event) => command("subtitle", Number(event.target.value))}
      >
        <option value={-1}>Subtitles off</option>
        {player.tracks
          .filter((t) => t.type === "sub")
          .map((track) => (
            <option key={track.id} value={track.id}>
              {track.title ?? track.lang ?? `Subtitle ${track.id}`}
            </option>
          ))}
      </select>
      {settings && (
        <fieldset
          aria-label="Subtitle appearance"
          data-player-control="subtitle-style"
        >
          <legend>Subtitle appearance</legend>
          <label>
            Subtitle font
            <select
              value={settings.subtitleFont}
              onChange={(event) =>
                void bridge!
                  .saveSettings({
                    subtitleFont: event.target
                      .value as Settings["subtitleFont"],
                  })
                  .catch((error) => onError(errorText(error)))
              }
            >
              <option value="Inter">Modern · Inter</option>
              <option value="Noto Serif">Serif · Noto Serif</option>
              <option value="Noto Sans Mono">Mono · Noto Sans Mono</option>
            </select>
          </label>
          {(
            [
              ["subtitleSize", "Subtitle font size", 16, 72, 2],
              ["subtitleOutline", "Subtitle outline", 0, 4, 0.2],
              ["subtitleShadow", "Subtitle shadow", 0, 6, 0.4],
            ] as const
          ).map(([field, label, min, max, step]) => (
            <label key={field}>
              {label}
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={settings[field]}
                onChange={(event) =>
                  void bridge!
                    .saveSettings({ [field]: Number(event.target.value) })
                    .catch((error) => onError(errorText(error)))
                }
              />
            </label>
          ))}
          <label>
            Subtitle color
            <select
              value={settings.subtitleColor}
              onChange={(event) =>
                void bridge!
                  .saveSettings({
                    subtitleColor: event.target
                      .value as Settings["subtitleColor"],
                  })
                  .catch((error) => onError(errorText(error)))
              }
            >
              <option value="white">White</option>
              <option value="warm">Warm</option>
              <option value="yellow">Yellow</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.subtitleBold}
              onChange={(event) =>
                void bridge!
                  .saveSettings({ subtitleBold: event.target.checked })
                  .catch((error) => onError(errorText(error)))
              }
            />
            Bold subtitles
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.subtitleBackground}
              onChange={(event) =>
                void bridge!
                  .saveSettings({ subtitleBackground: event.target.checked })
                  .catch((error) => onError(errorText(error)))
              }
            />
            Subtitle background
          </label>
        </fieldset>
      )}
      <button
        className="icon-button"
        aria-label="Stop playback"
        data-player-control="back"
        onClick={onStop}
      >
        <X size={19} />
      </button>
    </div>
  );
}

function SettingsPage({
  settings,
  update,
  onClose,
  onSave,
  onError,
  onUpdate,
}: {
  settings: PublicSettings;
  update: UpdateState;
  onClose(): void;
  onSave(patch: Partial<Settings>): Promise<void>;
  onError(message: string): void;
  onUpdate(state: UpdateState): void;
}) {
  const [form, setForm] = useState({ ...settings, token: "", tmdbKey: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const change = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const {
      hasToken: _token,
      hasTmdbKey: _key,
      secureStorage: _secure,
      ...patch
    } = form;
    try {
      await onSave(patch);
      setForm((current) => ({ ...current, token: "", tmdbKey: "" }));
      setSaved(true);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <form onSubmit={submit}>
        <div className="settings-content page-enter">
          <div className="page-heading">
            <span className="eyebrow subtle">YOUR PREFERENCES</span>
            <h1 id="settings-title">Settings</h1>
            <p>Make Horizon feel like home.</p>
          </div>
          <div className="settings-grid">
            <div className="settings-section">
              <h3>
                <MonitorPlay size={18} /> Your server
              </h3>
              <label>
                Server address
                <input
                  autoFocus
                  placeholder="https://media.example.com"
                  value={form.serverUrl}
                  onChange={(event) => change("serverUrl", event.target.value)}
                  required
                />
              </label>
              <label>
                Access token
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={
                    settings.hasToken
                      ? "Saved · leave blank to keep"
                      : "Your server’s access token"
                  }
                  value={form.token}
                  onChange={(event) => change("token", event.target.value)}
                  required={!settings.hasToken}
                />
              </label>
              <p className="field-note">
                Watched history and playback positions are saved on this device.
              </p>
            </div>
            <div className="settings-section">
              <h3>
                <Film size={18} /> Library details
              </h3>
              <label>
                TMDB API key
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={
                    settings.hasTmdbKey
                      ? "Saved · leave blank to keep"
                      : "Your TMDB API key"
                  }
                  value={form.tmdbKey}
                  onChange={(event) => change("tmdbKey", event.target.value)}
                />
              </label>
              <div className="field-row">
                <label>
                  Metadata language
                  <select
                    value={form.metadataLanguage}
                    onChange={(event) =>
                      change("metadataLanguage", event.target.value)
                    }
                  >
                    <option value="en-US">English</option>
                    <option value="pl-PL">Polski</option>
                    <option value="de-DE">Deutsch</option>
                    <option value="fr-FR">Français</option>
                    <option value="es-ES">Español</option>
                  </select>
                </label>
                <label>
                  Preferred subtitles
                  <input
                    placeholder="en,pl"
                    value={form.subtitleLanguage}
                    onChange={(event) =>
                      change("subtitleLanguage", event.target.value)
                    }
                  />
                </label>
              </div>
              <label>
                Subtitle size{" "}
                <span className="range-value">{form.subtitleSize}</span>
                <input
                  type="range"
                  min="16"
                  max="72"
                  value={form.subtitleSize}
                  onChange={(event) =>
                    change("subtitleSize", Number(event.target.value))
                  }
                />
              </label>
            </div>
            <div className="settings-section">
              <h3>
                <ArrowDownToLine size={18} /> Updates
              </h3>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.autoUpdates}
                  onChange={(event) =>
                    change("autoUpdates", event.target.checked)
                  }
                />
                <span>Automatically check and download updates</span>
              </label>
              <p className="field-note">
                {update.message}
                {update.percent !== undefined
                  ? ` ${Math.round(update.percent)}%`
                  : ""}
              </p>
              <div className="update-actions">
                <button
                  type="button"
                  className="secondary-button compact"
                  disabled={
                    update.status === "checking" ||
                    update.status === "downloading"
                  }
                  onClick={() =>
                    void bridge!
                      .checkUpdates()
                      .then(onUpdate)
                      .catch((error) => onError(errorText(error)))
                  }
                >
                  Check for updates
                </button>
                {update.downloadUrl && (
                  <button
                    type="button"
                    className="primary-button compact"
                    onClick={() =>
                      void bridge!
                        .openUpdateDownload()
                        .catch((error) => onError(errorText(error)))
                    }
                  >
                    Download update
                  </button>
                )}
                {update.status === "ready" && (
                  <button
                    type="button"
                    className="primary-button compact"
                    onClick={() =>
                      void bridge!
                        .installUpdate()
                        .catch((error) => onError(errorText(error)))
                    }
                  >
                    Install & restart
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="privacy-note">
            {settings.secureStorage
              ? "Credentials are protected using your operating system’s secret storage."
              : "Credentials are saved locally. Enable your Linux desktop keyring for encrypted storage."}
          </p>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="settings-actions">
          <span className="save-status" role="status">
            {saved && (
              <>
                <Check size={15} /> Changes saved
              </>
            )}
          </span>
          <button
            className="secondary-button cancel-button"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary-button" disabled={saving} type="submit">
            {saving && <LoaderCircle size={16} className="spinning" />}Save
            settings <Check size={16} />
          </button>
        </div>
      </form>
    </section>
  );
}

function DetailPage({
  group,
  next,
  history,
  serverId,
  starting,
  onPlay,
  onTogether,
  onWatched,
  onMetadata,
  onError,
}: {
  group: Group;
  next: MediaItem;
  history: LocalState["history"];
  serverId: string;
  starting?: string;
  onPlay(item: MediaItem, restart?: boolean): Promise<void>;
  onTogether(item: MediaItem): Promise<void>;
  onWatched(item: MediaItem, value: boolean): Promise<void>;
  onMetadata(metadata: Record<string, Metadata>): void;
  onError(message: string): void;
}) {
  const seasons = [...new Set(group.items.map((i) => i.season ?? 0))].sort(
    (a, b) => a - b,
  );
  const [season, setSeason] = useState(next.season ?? seasons[0]);
  const [identifying, setIdentifying] = useState(false);
  const [search, setSearch] = useState(group.items[0].title);
  const [results, setResults] = useState<Metadata[]>([]);
  const [busy, setBusy] = useState(false);
  const isSeries = group.items[0].kind === "episode";
  const progress = history[historyKey(serverId, next.id)];
  async function find(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      setResults(
        await bridge!.searchMetadata(search, isSeries ? "tv" : "movie"),
      );
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function match(id: number | null) {
    setBusy(true);
    try {
      onMetadata(
        await bridge!.matchMetadata(
          group.key,
          id,
          isSeries ? "tv" : "movie",
          seasons,
        ),
      );
      setIdentifying(false);
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-page page-enter" aria-labelledby="detail-title">
      <div
        className="detail-cover"
        style={
          group.metadata?.backdrop
            ? { backgroundImage: `url("${group.metadata.backdrop}")` }
            : undefined
        }
      >
        <div />
        <span className="detail-kicker">
          {isSeries ? "TV SERIES" : "MOVIE"} · ORIGINAL QUALITY
        </span>
      </div>
      <div className="detail-body">
        {group.metadata?.poster && (
          <img
            className="detail-poster"
            src={group.metadata.poster}
            alt={`${group.title} poster`}
          />
        )}
        <h2 id="detail-title">{group.title}</h2>
        <div className="detail-meta">
          {group.metadata?.year ?? next.year} <span>·</span>{" "}
          {isSeries
            ? `${group.items.length} episodes in your library`
            : runtime(next.duration)}{" "}
          {group.metadata?.rating ? (
            <>
              <span>·</span> ★ {group.metadata.rating.toFixed(1)}
            </>
          ) : null}
        </div>
        <MediaBadges item={next} />
        <p className="overview">
          {group.metadata?.overview ||
            "No description yet. Identify this title to add its poster and details."}
        </p>
        <div className="detail-actions">
          <button
            className="primary-button"
            disabled={!!starting}
            onClick={() => void onPlay(next)}
          >
            {starting === next.id ? (
              <LoaderCircle className="spinning" size={17} />
            ) : (
              <Play size={17} fill="currentColor" />
            )}
            {progress?.position && !progress.watched ? "Resume" : "Watch now"}
            {isSeries && ` · ${seasonEpisode(next)}`}
          </button>
          <button
            className="secondary-button"
            onClick={() => void onTogether(next)}
          >
            <UsersRound size={17} /> Watch together
          </button>
          {!isSeries && (
            <>
              <button
                className={`secondary-button ${progress?.watched ? "watched-action" : ""}`}
                aria-pressed={!!progress?.watched}
                onClick={() => void onWatched(next, !progress?.watched)}
              >
                <Check size={17} />
                {progress?.watched ? "Watched" : "Mark watched"}
              </button>
              {!!progress?.position && (
                <button
                  className="text-button"
                  disabled={!!starting}
                  onClick={() => void onPlay(next, true)}
                >
                  Start over
                </button>
              )}
            </>
          )}
        </div>
        <div className="technical-info">
          <span>{(next.size / 1024 ** 3).toFixed(2)} GB</span>
          <span>
            {next.tracks.filter((t) => t.type === "subtitle").length +
              next.subtitles.length}{" "}
            subtitle tracks
          </span>
        </div>
        {isSeries && (
          <div className="episodes">
            <div className="section-title">
              <h3>Episodes</h3>
              <div className="select-wrapper">
                <select
                  aria-label="Season"
                  value={season}
                  onChange={(event) => setSeason(Number(event.target.value))}
                >
                  {seasons.map((number) => (
                    <option key={number} value={number}>
                      Season {number}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
            </div>
            {group.items
              .filter((i) => i.season === season)
              .map((item) => {
                const episode =
                    group.metadata?.episodes?.[
                      `${item.season}:${item.episode}`
                    ],
                  p = history[historyKey(serverId, item.id)];
                return (
                  <div
                    className={`episode-row ${p?.watched ? "episode-watched" : ""}`}
                    key={item.id}
                  >
                    <button
                      className="episode-thumbnail"
                      disabled={!!starting}
                      aria-label={`Play episode ${item.episode}`}
                      onClick={() => void onPlay(item)}
                    >
                      {episode?.still ? (
                        <img src={episode.still} alt="" />
                      ) : (
                        <span>{String(item.episode).padStart(2, "0")}</span>
                      )}
                      <Play size={20} fill="currentColor" />
                    </button>
                    <button
                      className="episode-copy"
                      disabled={!!starting}
                      onClick={() => void onPlay(item)}
                    >
                      <strong>
                        {item.episode}.{" "}
                        {episode?.title ?? `Episode ${item.episode}`}
                      </strong>
                      <p>{episode?.overview || item.filename}</p>
                      <span className="episode-meta">
                        <span>
                          {runtime(item.duration)}
                          {p?.position && !p.watched
                            ? ` · Resume at ${time(p.position)}`
                            : ""}
                        </span>
                        <WatchedStatus count={p?.watched ? 1 : 0} />
                      </span>
                      <MediaBadges item={item} />
                      {p?.position && !p.watched ? (
                        <div className="episode-progress">
                          <span
                            style={{
                              width: `${Math.min(100, (p.position / (p.duration || 1)) * 100)}%`,
                            }}
                          />
                        </div>
                      ) : null}
                    </button>
                    <button
                      className={`icon-button ${p?.watched ? "is-watched" : ""}`}
                      aria-label={`${p?.watched ? "Mark unwatched" : "Mark watched"} episode ${item.episode}`}
                      onClick={() => void onWatched(item, !p?.watched)}
                    >
                      <Check size={19} />
                    </button>
                  </div>
                );
              })}
          </div>
        )}
        <div className="identify-section">
          <button
            className="text-button"
            onClick={() => setIdentifying(!identifying)}
          >
            <Search size={14} />
            {group.metadata ? "Correct title match" : "Identify title"}
          </button>
          {identifying && (
            <div className="identify-panel">
              <form onSubmit={find}>
                <input
                  aria-label="Search TMDB"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button className="secondary-button compact" disabled={busy}>
                  Search
                </button>
              </form>
              {busy && <LoaderCircle size={18} className="spinning" />}
              {results.map((result) => (
                <button
                  className="match-result"
                  key={result.tmdbId}
                  disabled={busy}
                  onClick={() => void match(result.tmdbId)}
                >
                  {result.poster && <img src={result.poster} alt="" />}
                  <span>
                    <strong>{result.title}</strong>
                    <small>{result.year}</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void match(null)}
              >
                Keep filename · remove metadata match
              </button>
            </div>
          )}
        </div>
        <div className="filename">{next.filename}</div>
      </div>
    </section>
  );
}
