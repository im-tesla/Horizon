import { Check } from "lucide-react";
import { formatBadges } from "../shared/media-formats";
import { historyKey, type MediaItem, type Progress } from "../shared/types";

export function MediaBadges({ item }: { item: MediaItem }) {
  const badges = formatBadges(item);
  if (!badges.length) return null;
  return (
    <span className="media-badges" aria-label="Media formats">
      {badges.map((badge) => (
        <span
          key={badge.kind}
          className={`media-badge media-badge-${badge.kind}`}
          title={badge.detail}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}
export function watchedCount(
  items: MediaItem[],
  serverId: string,
  history: Record<string, Progress>,
): number {
  return items.filter((item) => history[historyKey(serverId, item.id)]?.watched)
    .length;
}
export function WatchedStatus({
  count,
  total = 1,
}: {
  count: number;
  total?: number;
}) {
  if (!count) return null;
  const complete = count === total;
  return (
    <span className={`watched-status ${complete ? "complete" : "partial"}`}>
      {complete ? (
        <Check size={13} strokeWidth={2} aria-hidden="true" />
      ) : (
        <svg
          className="watched-progress"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <circle className="watched-progress-track" cx="8" cy="8" r="5.5" />
          <circle
            cx="8"
            cy="8"
            r="5.5"
            pathLength="1"
            strokeDasharray={`${count / total} 1`}
            transform="rotate(-90 8 8)"
          />
        </svg>
      )}
      <span>{complete ? "Watched" : `${count}/${total} watched`}</span>
    </span>
  );
}
