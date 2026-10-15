import { test } from "node:test";
import assert from "node:assert/strict";
import { audioDeviceList, audioDeviceSchema } from "../src/shared/audio";

test("audio outputs retain engine device IDs with readable, unique labels and a system default", () => {
  const devices = audioDeviceList([
    { name: "auto", description: "Autoselect device" },
    { name: "wasapi/{headphones}", description: "USB Headphones" },
    { name: "wasapi/{receiver}", description: "Living room\n HDMI receiver" },
    { name: "wasapi/{headphones}", description: "Duplicate" },
    { name: "pulse/desk-output", description: "" },
    { name: "bad\nname", description: "Invalid device ID" },
    { name: 42, description: "Invalid entry" },
    null,
  ]);
  assert.deepEqual(devices, [
    { name: "auto", description: "System default" },
    { name: "wasapi/{headphones}", description: "USB Headphones" },
    { name: "wasapi/{receiver}", description: "Living room HDMI receiver" },
    { name: "pulse/desk-output", description: "pulse/desk-output" },
  ]);
  assert.deepEqual(audioDeviceList([]), [
    { name: "auto", description: "System default" },
  ]);
  for (const invalid of ["", "a\0b", "a\rb", "a\nb", "a".repeat(2049)])
    assert.equal(audioDeviceSchema.safeParse(invalid).success, false);
  for (const valid of [
    "auto",
    "wasapi/{guid}",
    "pulse/alsa_output.pci-0.hdmi-stereo",
    "alsa/hdmi:CARD=NVidia,DEV=0",
  ])
    assert.equal(audioDeviceSchema.safeParse(valid).success, true);
});
