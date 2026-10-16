import { test } from "node:test";
import assert from "node:assert/strict";
import {
  directionalTarget,
  GamepadInput,
  defaultControllerBindings,
  remapController,
} from "../src/shared/gamepad";
import { controllerBindingsSchema } from "../src/shared/controller-settings";

function pad(buttons: number[] = [], axes = [0, 0, 0, 0], index = 0) {
  return {
    index,
    id: `controller-${index}`,
    connected: true,
    mapping: "standard" as const,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: buttons.includes(i),
      value: buttons.includes(i) ? 1 : 0,
      touched: false,
    })),
  };
}
test("controller actions use standard mappings with edges and bounded held repeats", () => {
  const input = new GamepadInput();
  input.sample([pad()], 0);
  assert.deepEqual(input.sample([pad([0, 9, 15])], 1), [
    "right",
    "accept",
    "pause",
  ]);
  assert.deepEqual(input.sample([pad([0, 9, 15])], 400), []);
  assert.deepEqual(input.sample([pad([0, 9, 15])], 422), ["right"]);
  assert.deepEqual(input.sample([pad([0, 9, 15])], 450), []);
  assert.deepEqual(input.sample([pad([0, 9, 15])], 573), ["right"]);
  input.sample([pad()], 600);
  assert.deepEqual(input.sample([pad([0, 1, 3, 4, 5, 9])], 610), [
    "accept",
    "back",
    "pause",
    "rewind",
    "forward",
    "fullscreen",
  ]);
});
test("custom mappings swap conflicts, reject invalid settings and cannot fire a held button on save", () => {
  const swapped = remapController(defaultControllerBindings, "accept", 1);
  assert.equal(swapped.accept, 1);
  assert.equal(swapped.back, 0);
  assert.equal(controllerBindingsSchema.safeParse(swapped).success, true);
  for (const value of [
    { ...swapped, back: 1 },
    { ...swapped, pause: 12 },
    { ...swapped, pause: -1 },
    { accept: 0 },
  ])
    assert.equal(controllerBindingsSchema.safeParse(value).success, false);
  const input = new GamepadInput();
  input.sample([pad()], 0);
  assert.deepEqual(input.sample([pad([0])], 1), ["accept"]);
  assert.deepEqual(input.sample([pad([0])], 2, true, swapped), []);
  assert.deepEqual(input.sample([pad([0])], 1000, true, swapped), []);
  input.sample([pad()], 1001, true, swapped);
  assert.deepEqual(input.sample([pad([1])], 1002, true, swapped), ["accept"]);
  input.sample([pad()], 1003, true, swapped);
  assert.deepEqual(input.sample([pad([0])], 1004, true, swapped), ["back"]);
});
test("stick drift and diagonals cannot cause multiple direction actions", () => {
  const input = new GamepadInput();
  input.sample([pad()], 0);
  assert.deepEqual(input.sample([pad([], [0.4, -0.3, 0, 0.2])], 10), []);
  assert.deepEqual(input.sample([pad([], [0.7, -0.9, 0, 0.8])], 20), [
    "up",
    "scroll-down",
  ]);
});
test("reconnect and background held controls require release before acting", () => {
  const input = new GamepadInput();
  assert.deepEqual(input.sample([pad([0, 15])], 0), []);
  assert.deepEqual(input.sample([pad([0, 15])], 10000), []);
  input.sample([pad()], 10001);
  assert.deepEqual(input.sample([pad([0])], 10002), ["accept"]);
  assert.deepEqual(input.sample([pad([0, 15])], 10003, false), []);
  assert.deepEqual(input.sample([pad([0, 15])], 20000, true), []);
  input.sample([pad()], 20001);
  assert.deepEqual(input.sample([pad([15])], 20002), ["right"]);
  input.suspend();
  assert.deepEqual(input.sample([pad([15])], 25000), []);
  input.sample([pad()], 25001);
  assert.deepEqual(input.sample([pad([15])], 25002), ["right"]);
  input.sample([], 25003);
  assert.deepEqual(input.sample([pad([0])], 25004), []);
});
test("unmapped pads are ignored and multiple controllers do not duplicate actions", () => {
  const input = new GamepadInput();
  input.sample([pad(), pad([], undefined, 1)], 0);
  assert.deepEqual(input.sample([pad([0]), pad([0], undefined, 1)], 1), [
    "accept",
  ]);
  assert.deepEqual(
    new GamepadInput().sample([{ ...pad([0]), mapping: "" }], 1),
    [],
  );
});
test("spatial navigation follows rows and columns, including scrollable content", () => {
  const rects = [
    { left: 0, top: 100, width: 150, height: 40 },
    { left: 220, top: 100, width: 100, height: 40 },
    { left: 340, top: 100, width: 100, height: 40 },
    { left: 220, top: 1000, width: 100, height: 40 },
  ];
  assert.equal(directionalTarget(rects, 1, "right"), 2);
  assert.equal(directionalTarget(rects, 1, "left"), 0);
  assert.equal(directionalTarget(rects, 1, "down"), 3);
  assert.equal(directionalTarget(rects, 3, "up"), 1);
  assert.equal(directionalTarget(rects, 1, "up"), -1);
  assert.equal(directionalTarget([], 0, "down"), -1);
  assert.equal(
    directionalTarget(
      [
        { left: 384, top: 8, width: 40, height: 40 },
        { left: 284, top: 89, width: 122, height: 34 },
        { left: 354, top: 137, width: 36, height: 34 },
      ],
      0,
      "down",
    ),
    1,
    "Down from a popover close button must reach the first row instead of skipping it.",
  );
});
