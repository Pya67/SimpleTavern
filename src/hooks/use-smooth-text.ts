"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Reveals `target` in discrete chunks on a steady beat, so bursty network deltas render as an even
 * rhythm of phrases. To avoid stop-start stutter the reveal deliberately runs a little behind the
 * stream: it gathers a head start before the first chunk, then keeps a small reserve in hand so the
 * next beat always has something to show. Chunk size grows with the backlog so it never falls far
 * behind. Paired with the chunk fade in Markdown (duration ≈ 5 beats), about five chunks are fading
 * in at any moment.
 */
const BEAT_MS = 180;
const FLUSH_BEAT_MS = 80;
const DRAIN_BEATS = 4; // aim to clear the backlog within ~4 beats
const MIN_CHARS = 24; // roughly 4–5 words per chunk
const START_BUFFER_CHARS = 120; // gather this much before revealing anything…
const START_MAX_WAIT_MS = 800; // …or start anyway after this long
const RESERVE_CHARS = 36; // keep this much unrevealed while streaming so beats don't run dry
const STALL_MS = 450; // if the reserve can't be kept, reveal anyway after this long

/** Move `cut` forward to the end of the word it lands in (or the next phrase break nearby). */
function snapForward(t: string, cut: number) {
  if (cut >= t.length) return t.length;
  const re = /[\s]/g;
  re.lastIndex = cut;
  const m = re.exec(t);
  if (!m) return null; // last word may still be incomplete
  let end = m.index;
  // Prefer ending on punctuation if one is just ahead (keeps phrases together).
  const ahead = t.slice(end, end + 18).search(/[.,;:!?—…][\s"”)]/);
  if (ahead >= 0) {
    const p = end + ahead + 1;
    const after = /[\s]/g;
    after.lastIndex = p;
    const n = after.exec(t);
    if (n) end = n.index;
  }
  return end;
}

export function useSmoothText(target: string, streaming: boolean, enabled = true, initial = "") {
  const [shown, setShown] = useState(() => (streaming ? initial : target));
  const pos = useRef(streaming ? initial.length : target.length);
  const targetRef = useRef(target);
  const streamingRef = useRef(streaming);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When unrevealed text first appeared (for the start buffer), and when we last revealed a chunk. */
  const firstSeen = useRef<number | null>(null);
  const started = useRef(false);
  const lastReveal = useRef(0);

  targetRef.current = target;
  streamingRef.current = streaming;

  useEffect(() => {
    if (!enabled) {
      pos.current = target.length;
      setShown(target);
      return;
    }
    // Target was replaced (e.g. regenerate) -> restart.
    if (!target.startsWith(shown.slice(0, Math.min(shown.length, target.length)))) {
      pos.current = 0;
      started.current = false;
      firstSeen.current = null;
    }
    if (timer.current != null) return;
    const tick = () => {
      timer.current = null;
      const t = targetRef.current;
      const live = streamingRef.current;
      const backlog = t.length - pos.current;
      if (backlog <= 0) {
        if (!live) setShown(t);
        return;
      }
      const now = performance.now();
      if (live) {
        firstSeen.current ??= now;
        // Head start: let a few chunks' worth pile up so the reveal can run smoothly from the first beat.
        if (!started.current && backlog < START_BUFFER_CHARS && now - firstSeen.current < START_MAX_WAIT_MS) {
          timer.current = setTimeout(tick, BEAT_MS / 3);
          return;
        }
        // Keep a reserve so the next beat has text too — unless we've been waiting too long.
        if (started.current && backlog - RESERVE_CHARS < MIN_CHARS && now - lastReveal.current < STALL_MS) {
          timer.current = setTimeout(tick, BEAT_MS / 3);
          return;
        }
      }
      const size = Math.max(MIN_CHARS, Math.ceil((live ? backlog - RESERVE_CHARS : backlog) / DRAIN_BEATS));
      let cut = live ? snapForward(t, pos.current + size) : Math.min(t.length, pos.current + size * 2);
      if (cut == null) {
        // Only an unfinished word is left: wait for more text (or the end of the stream).
        timer.current = setTimeout(tick, BEAT_MS / 3);
        return;
      }
      if (!live) cut = snapForward(t, cut) ?? t.length;
      pos.current = cut;
      started.current = true;
      lastReveal.current = now;
      setShown(t.slice(0, cut));
      timer.current = setTimeout(tick, live ? BEAT_MS : FLUSH_BEAT_MS);
    };
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, streaming, enabled]);

  useEffect(
    () => () => {
      if (timer.current != null) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return enabled ? shown : target;
}
