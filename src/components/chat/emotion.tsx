"use client";
import { motion } from "motion/react";
import { cn } from "cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EMOTIONS, affectionWord, dominant, type EmotionName, type EmotionState, type EmotionVector } from "@/lib/emotion/engine";

/** Plutchik's wheel hues (plus pink for desire), at a lightness that reads on both themes. */
export const EMOTION_COLOR: Record<EmotionName, string> = {
  joy: "oklch(0.82 0.15 90)",
  trust: "oklch(0.75 0.15 135)",
  fear: "oklch(0.62 0.13 160)",
  surprise: "oklch(0.72 0.11 210)",
  sadness: "oklch(0.62 0.15 255)",
  disgust: "oklch(0.6 0.15 310)",
  anger: "oklch(0.63 0.2 25)",
  anticipation: "oklch(0.74 0.15 55)",
  desire: "oklch(0.68 0.19 355)",
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function EmotionBars({ v, baseline, only, compact }: { v: EmotionVector; baseline?: EmotionVector | null; only?: EmotionName[]; compact?: boolean }) {
  const list = only ?? EMOTIONS;
  return (
    <div className={cn("grid gap-x-3", compact ? "gap-y-1.5" : "gap-y-2")}>
      {list.map((e) => (
        <div key={e} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2 text-xs">
          <span className="text-muted-foreground">{cap(e)}</span>
          <div className="surface-well relative h-1.5 overflow-hidden rounded-full">
            <motion.div
              className="h-full rounded-full"
              style={{ background: EMOTION_COLOR[e] }}
              initial={false}
              animate={{ width: `${v[e]}%` }}
              transition={{ type: "spring", stiffness: 140, damping: 22 }}
            />
            {/* Resting level: where this emotion drifts back to. */}
            {baseline?.[e] != null && <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${baseline[e]}%` }} aria-hidden />}
          </div>
          <span className="text-right tabular-nums text-muted-foreground">{v[e]}</span>
        </div>
      ))}
    </div>
  );
}

/** −100 … 100, filled from the centre. */
export function AffectionMeter({ value }: { value: number }) {
  const pct = Math.abs(value) / 2;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">Toward you</span>
        <span className="tabular-nums">
          {cap(affectionWord(value))} <span className="text-muted-foreground">({value > 0 ? "+" : ""}{value})</span>
        </span>
      </div>
      <div className="surface-well relative h-1.5 overflow-hidden rounded-full">
        <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" aria-hidden />
        <motion.div
          className={cn("absolute inset-y-0 rounded-full", value >= 0 ? "bg-brand" : "bg-destructive")}
          initial={false}
          animate={value >= 0 ? { left: "50%", width: `${pct}%` } : { left: `${50 - pct}%`, width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 140, damping: 22 }}
        />
      </div>
    </div>
  );
}

/** Mood chip next to the character's name on a reply. */
export function EmotionChip({ emotion, pending, onOpenPanel }: { emotion: EmotionState | null; pending: boolean; onOpenPanel: () => void }) {
  if (!emotion) {
    if (!pending) return null;
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
        <span className="size-1.5 animate-pulse rounded-full bg-brand" /> reading mood…
      </span>
    );
  }
  const top = dominant(emotion.v).slice(0, 3);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(
              "flex max-w-64 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              pending && "animate-pulse",
            )}
            aria-label={`Mood: ${emotion.label}`}
          />
        }
      >
        <span className="shrink-0 whitespace-nowrap" aria-hidden>
          {emotion.kaomoji}
        </span>
        <span className="truncate">{emotion.label}</span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-72 space-y-3 p-3">
        <div className="flex items-start gap-2.5">
          <span className="shrink-0 whitespace-nowrap text-lg leading-tight" aria-hidden>
            {emotion.kaomoji}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{cap(emotion.label)}</div>
            {emotion.note && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{emotion.note}</p>}
          </div>
        </div>
        <EmotionBars v={emotion.v} only={top} compact />
        <AffectionMeter value={emotion.affection} />
        <button onClick={onOpenPanel} className="text-xs font-medium text-brand hover:underline">
          Open emotion panel
        </button>
      </PopoverContent>
    </Popover>
  );
}
