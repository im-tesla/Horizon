import { z } from "zod";

export const watchPlaybackSchema = z.object({
  mediaId: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
  position: z.number().finite().min(0),
  paused: z.boolean(),
  anchorAt: z.number().finite(),
  revision: z.number().int().min(0),
});
export const watchRoomSchema = z.object({
  code: z.string().regex(/^[A-Z2-9]{8}$/),
  serverTime: z.number().finite(),
  version: z.number().int().min(0),
  selectedMediaId: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
  waiting: z.boolean(),
  playback: watchPlaybackSchema,
  members: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(40),
        ready: z.boolean(),
        buffering: z.boolean(),
      }),
    )
    .max(12),
});
export type WatchPlayback = z.infer<typeof watchPlaybackSchema>;
export type WatchRoom = z.infer<typeof watchRoomSchema>;
export interface WatchState {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "error";
  room?: WatchRoom;
  memberId?: string;
  error?: string;
}
export interface WatchPlaybackRequest {
  mediaId: string;
  requestId: string;
}
export type WatchControl =
  | { action: "play"; mediaId: string; position?: number }
  | { action: "pause" | "resume" }
  | { action: "seek"; position: number };

export function watchPosition(
  playback: WatchPlayback,
  serverNow: number,
): number {
  return (
    playback.position +
    (playback.paused ? 0 : Math.max(0, serverNow - playback.anchorAt) / 1000)
  );
}
