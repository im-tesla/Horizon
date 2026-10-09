import type { MediaItem, MediaTrack } from "./types";

export interface FormatBadge {
  kind: "resolution" | "video" | "audio";
  label: string;
  detail: string;
}
export function resolution(item: MediaItem): string {
  const video = item.tracks.find((track) => track.type === "video");
  const width = video?.width ?? 0,
    height = video?.height ?? 0;
  // Widescreen releases often remove black bars without changing resolution class.
  if (height >= 4000 || width >= 7600) return "8K";
  if (height >= 2000 || width >= 3800) return "4K";
  if (height >= 1400 || width >= 2500) return "1440p";
  if (height >= 1000 || width >= 1900) return "1080p";
  if (height >= 700 || width >= 1260) return "720p";
  if (height > 0) return `${height}p`;
  const hint = item.filename.match(
    /(?:^|[ ._\-])(2160p|1080p|720p|480p|4k)(?:[ ._\-]|$)/i,
  )?.[1];
  return /^(2160p|4k)$/i.test(hint ?? "") ? "4K" : (hint?.toLowerCase() ?? "");
}
const videoNames: Record<string, string> = {
  hevc: "H.265",
  h265: "H.265",
  h264: "H.264",
  av1: "AV1",
  vp9: "VP9",
  vp8: "VP8",
  mpeg2video: "MPEG-2",
  vc1: "VC-1",
};
const audioNames: Record<string, string> = {
  eac3: "DD+",
  ac3: "Dolby Digital",
  truehd: "TrueHD",
  dts: "DTS",
  aac: "AAC",
  flac: "FLAC",
  opus: "Opus",
  mp3: "MP3",
  vorbis: "Vorbis",
  alac: "ALAC",
};
export function isAtmos(track: MediaTrack): boolean {
  return (
    track.type === "audio" &&
    ["eac3", "truehd"].includes(track.codec.toLowerCase()) &&
    /\batmos\b/i.test(track.profile ?? "")
  );
}
function channels(track: MediaTrack): string {
  const layout = track.channelLayout?.toLowerCase();
  const surround = layout?.match(/\b([3-9]\.\d(?:\.\d)?)\b/)?.[1];
  if (surround) return surround;
  if (layout === "stereo" || track.channels === 2) return "Stereo";
  if (layout === "mono" || track.channels === 1) return "Mono";
  return track.channels ? `${track.channels} channels` : "";
}
export function audioFormat(track: MediaTrack): string {
  const codec = track.codec.toLowerCase();
  const channel = channels(track);
  if (isAtmos(track)) return ["Atmos", channel].filter(Boolean).join(" · ");
  // Stereo is the useful headline on a small badge; the tooltip retains its codec.
  if (channel === "Stereo" || channel === "Mono") return channel;
  const name = codec.startsWith("pcm_")
    ? "PCM"
    : /DTS-HD MA/i.test(track.profile ?? "")
      ? "DTS-HD MA"
      : (audioNames[codec] ?? (codec === "unknown" ? "" : codec.toUpperCase()));
  return [name, channel].filter(Boolean).join(" · ");
}
export function formatBadges(item: MediaItem): FormatBadge[] {
  const badges: FormatBadge[] = [];
  const video = item.tracks.find((track) => track.type === "video");
  const size = resolution(item);
  if (size)
    badges.push({
      kind: "resolution",
      label: size,
      detail:
        video?.width && video.height
          ? `${size === "4K" ? "4K / 2160p class" : size} · ${video.width} × ${video.height}`
          : `${size} · indicated by filename`,
    });
  const codec = video?.codec.toLowerCase();
  if (codec && codec !== "unknown")
    badges.push({
      kind: "video",
      label: videoNames[codec] ?? codec.toUpperCase(),
      detail: [videoNames[codec] ?? codec.toUpperCase(), video?.profile]
        .filter(Boolean)
        .join(" · "),
    });
  const audio = item.tracks.filter((track) => track.type === "audio");
  const best = [...audio].sort(
    (a, b) =>
      Number(isAtmos(b)) - Number(isAtmos(a)) ||
      (b.channels ?? 0) - (a.channels ?? 0),
  )[0];
  if (best && audioFormat(best))
    badges.push({
      kind: "audio",
      label: audioFormat(best),
      detail: `Available audio: ${audio.map((track) => [track.language, track.profile ?? audioNames[track.codec] ?? track.codec.toUpperCase(), channels(track)].filter(Boolean).join(" · ")).join("; ")}`,
    });
  return badges;
}
