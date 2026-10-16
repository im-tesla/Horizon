import { z } from "zod";
export const controllerBindingsSchema = z
  .object({
    accept: z.number().int().min(0).max(11),
    back: z.number().int().min(0).max(11),
    pause: z.number().int().min(0).max(11),
    rewind: z.number().int().min(0).max(11),
    forward: z.number().int().min(0).max(11),
    fullscreen: z.number().int().min(0).max(11),
  })
  .strict()
  .refine(
    (value) => new Set(Object.values(value)).size === 6,
    "Choose a different button for each action.",
  );
