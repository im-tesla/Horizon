import { z } from "zod";
import { defaultAudioDevice, type AudioDevice } from "./types";

export const audioDeviceSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const deviceSchema = z.object({
  name: audioDeviceSchema,
  description: z.string().max(4096),
});

export function audioDeviceList(value: unknown): AudioDevice[] {
  if (!Array.isArray(value)) throw new Error("Could not read audio outputs.");
  const devices = new Map<string, AudioDevice>([["auto", defaultAudioDevice]]);
  for (const item of value) {
    const device = deviceSchema.safeParse(item);
    if (!device.success || devices.has(device.data.name)) continue;
    devices.set(device.data.name, {
      name: device.data.name,
      description:
        device.data.description.replace(/\s+/g, " ").trim() || device.data.name,
    });
  }
  return [...devices.values()];
}
