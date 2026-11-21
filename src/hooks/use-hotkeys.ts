"use client";
import { useEffect, useRef } from "react";

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

function norm(e: KeyboardEvent) {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  let k = e.key.toLowerCase();
  if (e.code?.startsWith("Key")) k = e.code.slice(3).toLowerCase();
  if (e.code?.startsWith("Digit")) k = e.code.slice(5);
  if (k === " ") k = "space";
  parts.push(k);
  return parts.join("+");
}

/** Global hotkeys. Keys like "mod+k", "alt+p", "?". Plain keys are ignored while typing. */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const combo = norm(e);
      const plain = !combo.includes("mod") && !combo.includes("alt");
      const fn = ref.current[combo] ?? (e.key === "?" && !typing ? ref.current["?"] : undefined);
      if (!fn) return;
      if (plain && typing && combo !== "escape") return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
