import { useEffect, useRef } from "react";
import {
  directionalTarget,
  GamepadInput,
  type Direction,
  type GamepadAction,
  type ControllerBindings,
  defaultControllerBindings,
} from "../shared/gamepad";

const selector = 'button,input:not([type="hidden"]),a[href],[tabindex="0"]';
function candidates() {
  return [...document.querySelectorAll<HTMLElement>(selector)].filter(
    (element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 2 &&
        rect.height > 2 &&
        !element.matches(':disabled,[aria-disabled="true"]') &&
        !element.closest(".visually-hidden,[hidden],[inert]") &&
        getComputedStyle(element).visibility !== "hidden" &&
        getComputedStyle(element).display !== "none"
      );
    },
  );
}
function key(element: HTMLElement, value: string) {
  return !element.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    }),
  );
}
export function navigateGamepad(action: GamepadAction): boolean {
  let target =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const options = candidates();
  if (target?.matches('[role="combobox"][aria-expanded="true"]')) {
    if (action === "back") return key(target, "Escape");
    if (action === "accept") return key(target, "Enter");
    if (action === "up" || action === "down")
      return key(target, action === "up" ? "ArrowUp" : "ArrowDown");
    return true;
  }
  if (action === "back") return false;
  if (action === "scroll-up" || action === "scroll-down") {
    let scroller = target?.parentElement;
    while (
      scroller &&
      !(
        scroller.scrollHeight > scroller.clientHeight + 2 &&
        /auto|scroll/.test(getComputedStyle(scroller).overflowY)
      )
    )
      scroller = scroller.parentElement;
    (scroller ?? document.scrollingElement)?.scrollBy({
      top: action === "scroll-up" ? -110 : 110,
      behavior: "instant",
    });
    return true;
  }
  if (!["up", "down", "left", "right", "accept"].includes(action)) return true;
  const first = !target || !options.includes(target);
  if (first) {
    // Start in the page content; the sidebar remains reachable with Left.
    target =
      options.find((element) => !!element.closest("main")) ??
      options[0] ??
      null;
  } else if (action !== "accept") {
    if (
      target instanceof HTMLInputElement &&
      target.type === "range" &&
      (action === "left" || action === "right")
    ) {
      const step = Number(target.step) || 1;
      const value = Math.max(
        Number(target.min) || 0,
        Math.min(
          Number(target.max) || 100,
          Number(target.value) + (action === "left" ? -step : step),
        ),
      );
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(target, String(value));
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    const index = directionalTarget(
      options.map((element) => element.getBoundingClientRect()),
      options.indexOf(target!),
      action as Direction,
    );
    if (index >= 0) target = options[index];
  }
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: "instant",
  });
  // First press only establishes focus, never starts an unseen destructive action.
  if (action === "accept" && !first && target && !key(target, "Enter"))
    target.click();
  return true;
}

export function useGamepad(
  page: string,
  onAction: (action: GamepadAction) => void,
  bindings: ControllerBindings = defaultControllerBindings,
) {
  const callback = useRef(onAction);
  callback.current = onAction;
  const mapping = useRef(bindings);
  mapping.current = bindings;
  useEffect(() => {
    if (document.documentElement.dataset.gamepad === "true")
      requestAnimationFrame(() => {
        if (!document.querySelector(".playback-page")) {
          const options = candidates();
          if (
            document.activeElement instanceof HTMLElement &&
            options.includes(document.activeElement) &&
            document.activeElement.closest("main")
          )
            return;
          const target = options.find((element) => !!element.closest("main"));
          target?.focus({ preventScroll: true });
          target?.scrollIntoView({ block: "nearest", behavior: "instant" });
        }
      });
  }, [page]);
  useEffect(() => {
    const input = new GamepadInput();
    let pending = false,
      disposed = false,
      checkAt = 0;
    const blur = () => {
      input.suspend();
    };
    const clearMode = (event?: Event) => {
      if (event && !event.isTrusted) return;
      if (!document.documentElement.dataset.gamepad) return;
      delete document.documentElement.dataset.gamepad;
      if (document.querySelector(".playback-page"))
        void window.horizon?.playerGamepad("release").catch(() => {});
    };
    const tick = () => {
      let pads: (Gamepad | null)[] = [];
      try {
        pads = [...navigator.getGamepads()];
      } catch {
        /* unsupported context */
      }
      const connected = pads.some(
        (pad) => pad?.connected && pad.mapping === "standard",
      );
      const now = performance.now();
      if (connected && !pending && now >= checkAt) {
        pending = true;
        void window.horizon
          ?.gamepadActive()
          .then((value) => {
            if (!disposed && !value) input.suspend();
          })
          .catch(() => {
            input.suspend();
          })
          .finally(() => {
            pending = false;
          });
        checkAt = now + 150;
      }
      const actions = input.sample(
        pads,
        now,
        !document.hidden,
        mapping.current,
      );
      if (!connected && document.documentElement.dataset.gamepad) clearMode();
      if (actions.length) {
        void window.horizon
          ?.gamepadActive()
          .then((foreground) => {
            if (disposed) return;
            if (!foreground) {
              input.suspend();
              return;
            }
            for (const action of actions) {
              document.documentElement.dataset.gamepad = "true";
              callback.current(action);
            }
          })
          .catch(() => {});
      }
    };
    const timer = setInterval(tick, 32);
    document.addEventListener("pointerdown", clearMode, true);
    document.addEventListener("pointermove", clearMode, true);
    document.addEventListener("keydown", clearMode, true);
    window.addEventListener("blur", blur);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("pointerdown", clearMode, true);
      document.removeEventListener("pointermove", clearMode, true);
      document.removeEventListener("keydown", clearMode, true);
      window.removeEventListener("blur", blur);
      delete document.documentElement.dataset.gamepad;
    };
  }, []);
}
