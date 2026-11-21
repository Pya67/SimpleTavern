"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Debounced autosave. Only saves when the value actually differs from the last saved value
 * (robust to StrictMode double effects); flushes a pending save on unmount.
 */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, { delay = 700, enabled = true } = {}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const serialized = JSON.stringify(value);
  const lastSaved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  const saveRef = useRef(save);
  latest.current = value;
  saveRef.current = save;

  // Baseline = first value seen while enabled.
  if (enabled && lastSaved.current === null) lastSaved.current = serialized;

  const flush = async () => {
    const snap = JSON.stringify(latest.current);
    // No baseline yet (data not loaded) or nothing changed -> nothing to save.
    if (lastSaved.current === null || snap === lastSaved.current) return;
    setState("saving");
    try {
      await saveRef.current(latest.current);
      lastSaved.current = snap;
      setState("saved");
    } catch {
      setState("error");
    }
  };

  useEffect(() => {
    if (!enabled || serialized === lastSaved.current) return;
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, enabled]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return state;
}
