import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import type { CSSProperties, KeyboardEvent } from "react";

interface Option<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function Dropdown<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className = "",
  placeholder = "Choose…",
  control,
}: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange(value: T): void;
  className?: string;
  placeholder?: string;
  control?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.findIndex((option) => option.value === value);
  const [active, setActive] = useState(selected < 0 ? 0 : selected);
  const [position, setPosition] = useState<CSSProperties>();
  const search = useRef({ text: "", time: 0 });
  const enabled = options
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((index) => index >= 0);
  const show = (index = selected) => {
    setActive(enabled.includes(index) ? index : (enabled[0] ?? 0));
    search.current = { text: "", time: 0 };
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    onChange(option.value);
    trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const gap = 6,
        gutter = 12;
      if (rect.bottom <= gutter || rect.top >= window.innerHeight - gutter) {
        setOpen(false);
        return;
      }
      const width = Math.min(
        Math.max(rect.width, 180),
        window.innerWidth - gutter * 2,
      );
      const below = window.innerHeight - rect.bottom - gap - gutter;
      const above = rect.top - gap - gutter;
      const upwards =
        below < Math.min(292, options.length * 36 + 12) && above > below;
      setPosition({
        left: Math.max(
          gutter,
          Math.min(rect.left, window.innerWidth - width - gutter),
        ),
        width,
        maxHeight: Math.max(36, Math.min(292, upwards ? above : below)),
        ...(upwards
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
        transformOrigin: upwards ? "bottom" : "top",
      });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  useEffect(() => {
    if (!enabled.length) setOpen(false);
    else if (active >= options.length)
      setActive(selected < 0 ? enabled[0] : selected);
  }, [options.length, enabled.length, active, selected]);
  const keydown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Escape" && !open) return;
    if (
      ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(
        event.key,
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") setOpen(false);
      else if (event.key === "Enter" || event.key === " ")
        open ? choose(active) : show();
      else if (event.key === "Home") {
        show(enabled[0]);
      } else if (event.key === "End") {
        show(enabled[enabled.length - 1]);
      } else if (!open) show();
      else {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const index = enabled.indexOf(active);
        setActive(
          enabled[(index + direction + enabled.length) % enabled.length],
        );
      }
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      const text =
        (now - search.current.time < 600 ? search.current.text : "") +
        event.key.toLocaleLowerCase();
      const query = [...text].every((letter) => letter === text[0])
        ? text[0]
        : text;
      search.current = { text, time: now };
      const index = [
        ...enabled.filter((index) => index > active),
        ...enabled.filter((index) => index <= active),
      ].find((index) =>
        options[index].label.toLocaleLowerCase().startsWith(query),
      );
      if (index !== undefined) {
        setActive(index);
        setOpen(true);
      }
    }
  };
  return (
    <div className={`dropdown ${className}`}>
      <button
        ref={trigger}
        type="button"
        className="dropdown-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={!enabled.length}
        data-player-control={control}
        onKeyDown={keydown}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span>{options[selected]?.label ?? placeholder}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="listbox"
            aria-label={label}
            className="dropdown-menu"
            style={position}
          >
            {options.map((option, index) => (
              <div
                id={`${id}-${index}`}
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className="dropdown-option"
                data-active={index === active || undefined}
                onPointerMove={() => {
                  if (!option.disabled) setActive(index);
                }}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {option.value === value && (
                  <Check size={14} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>,
          trigger.current?.closest(".app-shell") ?? document.body,
        )}
    </div>
  );
}
