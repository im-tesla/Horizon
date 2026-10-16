export const gamepadActions = [
  "up",
  "down",
  "left",
  "right",
  "accept",
  "back",
  "pause",
  "rewind",
  "forward",
  "fullscreen",
  "scroll-up",
  "scroll-down",
] as const;
export type GamepadAction = (typeof gamepadActions)[number];
export type Direction = "up" | "down" | "left" | "right";
export const controllerCommands = [
  "accept",
  "back",
  "pause",
  "rewind",
  "forward",
  "fullscreen",
] as const;
export type ControllerCommand = (typeof controllerCommands)[number];
export type ControllerBindings = Record<ControllerCommand, number>;
export const defaultControllerBindings: ControllerBindings = {
  accept: 0,
  back: 1,
  pause: 9,
  rewind: 4,
  forward: 5,
  fullscreen: 3,
};
export const controllerLabels: Record<ControllerCommand, string> = {
  accept: "Select",
  back: "Back",
  pause: "Play / pause",
  rewind: "Back 10 seconds",
  forward: "Forward 10 seconds",
  fullscreen: "Fullscreen",
};
export const controllerButtons = [
  "A / Cross",
  "B / Circle",
  "X / Square",
  "Y / Triangle",
  "LB / L1",
  "RB / R1",
  "LT / L2",
  "RT / R2",
  "View / Share",
  "Menu / Options",
  "Left stick press",
  "Right stick press",
].map((label, value) => ({ value, label }));
export function remapController(
  bindings: ControllerBindings,
  command: ControllerCommand,
  button: number,
): ControllerBindings {
  const next = { ...bindings };
  const previous = next[command];
  const conflict = controllerCommands.find((action) => next[action] === button);
  if (conflict) next[conflict] = previous;
  next[command] = button;
  return next;
}
type Pad = Pick<
  Gamepad,
  "index" | "id" | "mapping" | "connected" | "buttons" | "axes"
>;
const repeating = new Set<GamepadAction>([
  "up",
  "down",
  "left",
  "right",
  "rewind",
  "forward",
  "scroll-up",
  "scroll-down",
]);

// Only Chromium's standard layout is safe to interpret across controller brands.
export class GamepadInput {
  private held = new Map<string, Map<GamepadAction, number>>();
  private bindingKey = "";
  suspend(): void {
    for (const held of this.held.values())
      for (const action of held.keys()) held.set(action, Infinity);
  }
  sample(
    pads: readonly (Pad | null)[],
    now: number,
    enabled = true,
    bindings: ControllerBindings = defaultControllerBindings,
  ): GamepadAction[] {
    const next = new Map<string, Map<GamepadAction, number>>();
    const actions = new Set<GamepadAction>();
    const key = controllerCommands
      .map((command) => bindings[command])
      .join(":");
    const changed = key !== this.bindingKey;
    this.bindingKey = key;
    for (const pad of pads) {
      if (!pad?.connected || pad.mapping !== "standard") continue;
      const id = `${pad.index}:${pad.id}`;
      const previous = this.held.get(id);
      const pressed = (index: number) =>
        !!pad.buttons[index]?.pressed || (pad.buttons[index]?.value ?? 0) > 0.6;
      const x = pad.axes[0] ?? 0,
        y = pad.axes[1] ?? 0;
      const horizontal = Math.abs(x) >= Math.abs(y);
      const active: GamepadAction[] = [];
      if (pressed(12) || (!horizontal && y < -0.55)) active.push("up");
      if (pressed(13) || (!horizontal && y > 0.55)) active.push("down");
      if (pressed(14) || (horizontal && x < -0.55)) active.push("left");
      if (pressed(15) || (horizontal && x > 0.55)) active.push("right");
      for (const action of controllerCommands)
        if (pressed(bindings[action])) active.push(action);
      if ((pad.axes[3] ?? 0) < -0.55) active.push("scroll-up");
      if ((pad.axes[3] ?? 0) > 0.55) active.push("scroll-down");
      const held = new Map<GamepadAction, number>();
      for (const action of active) {
        const due = previous?.get(action);
        // A controller first seen with held buttons must return to neutral.
        if (!previous || !enabled || changed) held.set(action, Infinity);
        else if (due === undefined || (repeating.has(action) && now >= due)) {
          actions.add(action);
          held.set(
            action,
            now +
              (due === undefined
                ? 420
                : action === "rewind" || action === "forward"
                  ? 350
                  : 150),
          );
        } else held.set(action, due);
      }
      next.set(id, held);
    }
    this.held = next;
    return [...actions];
  }
}

export interface FocusRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function directionalTarget(
  rects: readonly FocusRect[],
  from: number,
  direction: Direction,
): number {
  const origin = rects[from];
  if (!origin) return rects.length ? 0 : -1;
  const vertical = direction === "up" || direction === "down";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  let best = -1,
    score = Infinity;
  rects.forEach((rect, index) => {
    if (index === from) return;
    const forward =
      (vertical
        ? rect.top + rect.height / 2 - origin.top - origin.height / 2
        : rect.left + rect.width / 2 - origin.left - origin.width / 2) * sign;
    if (forward < 2) return;
    const side = Math.abs(
      vertical
        ? rect.left + rect.width / 2 - origin.left - origin.width / 2
        : rect.top + rect.height / 2 - origin.top - origin.height / 2,
    );
    const overlap = vertical
      ? Math.min(rect.left + rect.width, origin.left + origin.width) -
        Math.max(rect.left, origin.left)
      : Math.min(rect.top + rect.height, origin.top + origin.height) -
        Math.max(rect.top, origin.top);
    const candidate = forward + side * 0.5 + (overlap < -2 ? 1000 : 0);
    if (candidate < score) {
      best = index;
      score = candidate;
    }
  });
  return best;
}
