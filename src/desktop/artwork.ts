import { nativeImage } from "electron";
import { artworkPalette, defaultPalette } from "../shared/palette";
import type { ArtworkPalette } from "../shared/types";

const cache = new Map<string, Promise<ArtworkPalette>>();
export function themeFromArtwork(source: string): Promise<ArtworkPalette> {
  const url = new URL(source);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "image.tmdb.org" ||
    !url.pathname.startsWith("/t/p/") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Unsupported artwork URL.");
  const cached = cache.get(source);
  if (cached) return cached;
  const result = (async () => {
    const response = await fetch(source, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (
      !response.ok ||
      Number(response.headers.get("content-length")) > 6 * 1024 * 1024
    )
      return defaultPalette;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 6 * 1024 * 1024) return defaultPalette;
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return defaultPalette;
    return artworkPalette(
      image.resize({ width: 64, height: 64, quality: "good" }).toBitmap(),
    );
  })().catch(() => {
    cache.delete(source);
    return defaultPalette;
  });
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(source, result);
  return result;
}
