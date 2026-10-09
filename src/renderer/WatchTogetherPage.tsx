import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  LoaderCircle,
  Play,
  UsersRound,
  ArrowRight,
  LogOut,
  LayoutGrid,
} from "lucide-react";
import {
  groupKey,
  type Library,
  type Metadata,
  type PlayerState,
  type Progress,
} from "../shared/types";
import type { WatchState } from "../shared/watch-together";
import { WatchLibraryPicker } from "./WatchLibraryPicker";
import { MediaBadges, WatchedStatus, watchedCount } from "./MediaBadges";

export function WatchTogetherPage({
  watch,
  library,
  metadata,
  history,
  name,
  player,
  onReturn,
  onError,
}: {
  watch: WatchState;
  library?: Library;
  metadata: Record<string, Metadata>;
  history: Record<string, Progress>;
  name: string;
  player: PlayerState;
  onReturn(): Promise<void>;
  onError(message: string): void;
}) {
  const [displayName, setDisplayName] = useState(name);
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState(watch.room?.selectedMediaId ?? "");
  const [browsing, setBrowsing] = useState(false);
  const browser = useRef<HTMLDivElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const room = watch.room;
  useEffect(() => {
    setSelected(watch.room?.selectedMediaId ?? "");
    setBrowsing(!!watch.room && !watch.room.selectedMediaId);
  }, [watch.room?.code]);
  const browse = () => {
    setBrowsing(true);
    requestAnimationFrame(() =>
      browser.current?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      }),
    );
  };
  const select = (id: string) => {
    setSelected(id);
    setBrowsing(false);
    requestAnimationFrame(() => {
      preview.current?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      playButton.current?.focus({ preventScroll: true });
    });
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      const message = (
        failure instanceof Error
          ? failure.message
          : "Could not connect to the room."
      ).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
      setError(message);
    } finally {
      setBusy(false);
    }
  };
  const title = (id: string) => {
    const item = library?.items.find((item) => item.id === id);
    if (!item) return "Choose a title";
    return `${metadata[groupKey(item)]?.title ?? item.title}${item.kind === "episode" ? ` · S${String(item.season).padStart(2, "0")} E${String(item.episode).padStart(2, "0")}` : ""}`;
  };
  const itemId = selected || room?.selectedMediaId || "";
  const item = library?.items.find((item) => item.id === itemId);
  const details = item ? metadata[groupKey(item)] : undefined;
  const canReturn = player.playing && player.mediaId === room?.playback.mediaId;
  return (
    <section
      className="together-page page-enter"
      aria-labelledby="together-title"
    >
      <div className="page-heading">
        <span className="eyebrow subtle">A SHARED MOMENT</span>
        <h1 id="together-title">Watch together</h1>
        <p>Your friends. The same scene. Original quality for everyone.</p>
      </div>
      {(error || watch.error) && (
        <div className="notice error" role="alert">
          {error || watch.error}
        </div>
      )}
      {!room ? (
        <div className="together-start">
          <div className="together-intro">
            <div className="together-symbol">
              <UsersRound size={34} strokeWidth={1.4} />
            </div>
            <h2>A movie night, wherever you are.</h2>
            <p>
              Everyone can pause, play, and seek. Each person streams the
              original file to their own app, with their own audio and
              subtitles.
            </p>
            <p className="field-note">
              Friends connect to the same Horizon server in Settings, then enter
              your room code.
            </p>
          </div>
          <form
            className="together-card"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() =>
                window.horizon!.watchJoin(code, displayName.trim()),
              );
            }}
          >
            <label>
              Your name
              <input
                aria-label="Your name"
                value={displayName}
                maxLength={40}
                required
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={busy || !displayName.trim() || !library}
              onClick={() =>
                void run(() => window.horizon!.watchCreate(displayName.trim()))
              }
            >
              {busy ? (
                <LoaderCircle size={17} className="spinning" />
              ) : (
                <UsersRound size={17} />
              )}{" "}
              Create a room
            </button>
            <div className="together-divider">
              <span>or join your friends</span>
            </div>
            <label>
              Room code
              <input
                aria-label="Room code"
                className="room-code-input"
                value={code}
                placeholder="XXXXXXXX"
                maxLength={8}
                required
                pattern="[A-Z2-9]{8}"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) =>
                  setCode(
                    event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""),
                  )
                }
              />
            </label>
            <button
              className="secondary-button"
              disabled={busy || code.length !== 8 || !library}
              type="submit"
            >
              Join room <ArrowRight size={17} />
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="room-header">
            <div>
              <span className="eyebrow subtle">INVITE YOUR FRIENDS</span>
              <button
                className="room-code"
                aria-label="Copy room code"
                onClick={() =>
                  void window
                    .horizon!.watchCopyCode()
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                    .catch((failure) => onError(String(failure)))
                }
              >
                {room.code}
                {copied ? <Check size={20} /> : <Copy size={20} />}
              </button>
              <p className="field-note">
                Share this code with friends connected to the same server.
              </p>
            </div>
            <button
              className="secondary-button compact"
              disabled={busy}
              onClick={() => void run(() => window.horizon!.watchLeave())}
            >
              <LogOut size={16} /> Leave room
            </button>
          </div>
          <div className="room-grid">
            <div
              className="room-selection"
              id="room-title-browser"
              ref={browser}
            >
              {browsing ? (
                <WatchLibraryPicker
                  items={library?.items ?? []}
                  metadata={metadata}
                  history={history}
                  serverId={library?.serverId ?? ""}
                  selectedId={itemId}
                  onSelect={select}
                  onClose={() => setBrowsing(false)}
                />
              ) : (
                <div className="together-card room-movie" ref={preview}>
                  {details?.poster && (
                    <img className="room-poster" src={details.poster} alt="" />
                  )}
                  <div className="room-movie-copy">
                    <span className="eyebrow subtle">
                      {item ? "SELECTED FOR TONIGHT" : "YOUR NEXT MOVIE NIGHT"}
                    </span>
                    <h2>{title(itemId)}</h2>
                    {item && (
                      <div className="room-format-status">
                        <WatchedStatus
                          count={watchedCount(
                            [item],
                            library?.serverId ?? "",
                            history,
                          )}
                        />
                        <MediaBadges item={item} />
                      </div>
                    )}
                    <p>
                      {details?.overview ??
                        "Choose a movie or episode from your server’s library."}
                    </p>
                    <button
                      className="secondary-button compact room-browse"
                      aria-expanded={browsing}
                      aria-controls="room-title-browser"
                      onClick={browse}
                    >
                      <LayoutGrid size={16} />
                      {item ? "Change selection" : "Browse library"}
                    </button>
                    <div className="room-play-actions">
                      <button
                        ref={playButton}
                        className="primary-button"
                        disabled={busy || !item || watch.status !== "connected"}
                        onClick={() =>
                          void run(() => window.horizon!.watchPlay(itemId))
                        }
                      >
                        <Play size={17} fill="currentColor" />
                        {room.playback.mediaId
                          ? "Play selection"
                          : "Start together"}
                      </button>
                      {canReturn && (
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => void run(onReturn)}
                        >
                          Return to movie <ArrowRight size={16} />
                        </button>
                      )}
                    </div>
                    <p className="field-note" role="status">
                      {room.waiting
                        ? "Waiting for everyone to be ready…"
                        : room.playback.mediaId
                          ? room.playback.paused
                            ? "Playback paused"
                            : "Watching together"
                          : "Ready when you are. Everyone can start playback."}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="together-card room-viewers">
              <h3>
                <UsersRound size={18} /> In the room{" "}
                <span>{room.members.length}/12</span>
              </h3>
              <ul>
                {room.members.map((member) => (
                  <li key={member.id}>
                    <span className="viewer-avatar">
                      {member.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <strong>
                        {member.name}
                        {member.id === watch.memberId && <small> You</small>}
                      </strong>
                      <span>
                        {!room.playback.mediaId
                          ? "In the lobby"
                          : member.buffering
                            ? "Buffering"
                            : member.ready
                              ? "Ready to watch"
                              : "Opening stream…"}
                      </span>
                    </div>
                    <span
                      className={`status-dot ${member.ready && !member.buffering ? "online" : ""}`}
                    />
                  </li>
                ))}
              </ul>
              <p className="field-note">
                Playback starts when everyone is ready. Pause and seeking are
                shared; audio and subtitles are your own.
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
