import path from "node:path";
import type { ParsedName } from "./types";

const releaseMarker =
  /\b(?:2160p|1080[pi]|720p|480p|4k|8k|web[ .-]?(?:dl|rip)|blu[ .-]?ray|brrip|bdrip|hdtv|dvdrip|remux|x26[45]|h[ .-]?26[45]|hevc|avc|av1|10bit|8bit|ddp?|dd\+|eac3|ac3|aac|dts|truehd|dual|multi|nf|amzn|dsnp|untouched|repack|proper)\b/i;
function clean(input: string): string {
  return input
    .replace(/[._]/g, " ")
    .replace(/[[(].*?[\])]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s-]+$/, "")
    .trim();
}
export function parseFilename(
  filename: string,
  relativeDirectory = "",
): ParsedName {
  const stem = path.parse(filename).name;
  const episode =
    /(?:\b|[._ -])s(\d{1,3})[ ._-]*e(\d{1,4})(?:\b|[._ -])/i.exec(stem) ??
    /(?:\b|[._ -])(\d{1,2})x(\d{2,3})(?:\b|[._ -])/i.exec(stem);
  let prefix = episode ? stem.slice(0, episode.index) : stem;
  if (episode && !clean(prefix)) {
    const directories = relativeDirectory.split(/[\\/]/).filter(Boolean);
    prefix =
      directories
        .reverse()
        .find((part) => !/^(?:season|s)[ ._-]*\d+$/i.test(part)) ?? prefix;
    prefix = prefix.replace(
      /[ ._-]*(?:season[ ._-]*\d+|s\d+|complete).*$/i,
      "",
    );
  }
  const yearMatch = /(?:^|[ ._(\[-])((?:19|20)\d{2})(?=$|[ ._)\]-])/.exec(
    prefix,
  );
  const year =
    yearMatch && yearMatch.index > 0 ? Number(yearMatch[1]) : undefined;
  if (yearMatch && yearMatch.index > 0)
    prefix = prefix.slice(0, yearMatch.index);
  const marker = releaseMarker.exec(prefix);
  if (marker) prefix = prefix.slice(0, marker.index);
  const title = clean(prefix) || clean(stem) || filename;
  return {
    title,
    year,
    kind: episode ? "episode" : "movie",
    ...(episode
      ? { season: Number(episode[1]), episode: Number(episode[2]) }
      : {}),
  };
}
