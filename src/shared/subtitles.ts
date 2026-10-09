import { z } from "zod";
import type { SubtitleStyle } from "./types";

export const subtitleStyleSchema = z.object({
  subtitleFont: z.enum(["Inter", "Noto Serif", "Noto Sans Mono"]),
  subtitleSize: z.number().int().min(16).max(72),
  subtitleOutline: z.number().min(0).max(4),
  subtitleShadow: z.number().min(0).max(6),
  subtitleBold: z.boolean(),
  subtitleColor: z.enum(["white", "warm", "yellow"]),
  subtitleBackground: z.boolean(),
});
export const defaultSubtitleStyle: SubtitleStyle = {
  subtitleFont: "Inter",
  subtitleSize: 36,
  subtitleOutline: 0.8,
  subtitleShadow: 1.2,
  subtitleBold: false,
  subtitleColor: "white",
  subtitleBackground: false,
};
export const subtitleColors = {
  white: "#FFF7F7F8",
  warm: "#FFFFEAC5",
  yellow: "#FFFFDF80",
} as const;
export function subtitleProperties(
  style: SubtitleStyle,
): Record<string, string | number> {
  return {
    "sub-font": style.subtitleFont,
    "sub-font-size": style.subtitleSize,
    "sub-outline-size": style.subtitleOutline,
    "sub-shadow-offset": style.subtitleShadow,
    "sub-bold": style.subtitleBold ? "yes" : "no",
    "sub-color": subtitleColors[style.subtitleColor],
    "sub-border-style": style.subtitleBackground
      ? "background-box"
      : "outline-and-shadow",
    "sub-ass-override": "force",
  };
}
