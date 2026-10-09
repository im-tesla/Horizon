import type { ArtworkPalette } from "./types";

export const defaultPalette: ArtworkPalette = {
  accent: [178, 241, 218],
  ambient: [50, 86, 77],
};

// Weighted color buckets prefer prominent, saturated midtones over black borders
// and white lettering. The light accent remains readable on dark app surfaces.
export function artworkPalette(bitmap: Uint8Array): ArtworkPalette {
  const buckets = new Map<
    number,
    { weight: number; r: number; g: number; b: number }
  >();
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const [b, g, r, a] = bitmap.subarray(i, i + 4);
    if (a < 220) continue;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    const brightness = (max + min) / 2;
    const saturation = max ? (max - min) / max : 0;
    if (brightness < 24 || brightness > 230 || saturation < 0.12) continue;
    const weight = 0.25 + saturation;
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const bucket = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
    bucket.weight += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
    buckets.set(key, bucket);
  }
  const best = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!best) return defaultPalette;
  const ambient = [best.r, best.g, best.b].map((c) =>
    Math.round(c / best.weight),
  ) as [number, number, number];
  const accent = ambient.map((c) => Math.round(c * 0.38 + 255 * 0.62)) as [
    number,
    number,
    number,
  ];
  return { accent, ambient };
}
