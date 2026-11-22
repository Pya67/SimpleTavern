/**
 * Emotion engine: a small, deterministic state machine for a character's feelings.
 *
 * Every assistant reply gets an *appraisal* from Jev, a structured decision model (impulses per
 * emotion, a shift in affection, a mood and a cause; see lib/emotion/jev.ts). The engine — not the
 * model — owns the numbers: each turn emotions decay toward the character's baseline temperament,
 * then the impulses are applied with some inertia and clamped. That keeps moods coherent across a
 * long chat instead of jumping around with every reply.
 *
 * Feelings are deliberately asymmetric: hurt lands harder than kindness, and warming up gets slower
 * the warmer {{char}} already is. Otherwise every chat drifts into adoration.
 *
 * Pure module: no DB, no LLM. Unit-tested in tests/unit/emotion.test.ts.
 */

import { KAOMOJI_GROUPS } from "@/lib/kaomoji";

export const EMOTIONS = ["joy", "trust", "fear", "surprise", "sadness", "disgust", "anger", "anticipation", "desire"] as const;
export type EmotionName = (typeof EMOTIONS)[number];
export type EmotionVector = Record<EmotionName, number>;

export interface EmotionState {
  /** 0–100 intensity per core emotion. */
  v: EmotionVector;
  /** Feeling toward {{user}}, −100 (hostile) … 100 (devoted). */
  affection: number;
  /** Short mood label in the character's terms, e.g. "flustered". */
  label: string;
  /** Face from the app's kaomoji list (lib/kaomoji). */
  kaomoji: string;
  /** One sentence: why they feel this way / what's going on inside. */
  note: string;
  /** Set when the user edited the state by hand. */
  manual?: boolean;
}

/** Resting temperament plus where {{char}} stands with {{user}} when the chat starts. */
export type EmotionBaseline = EmotionVector & { affection?: number };

/** What the appraisal returns (before the engine applies it). */
export interface Appraisal {
  /** Impulses per emotion, −50 … 50. Missing = 0. */
  impulse: Partial<EmotionVector>;
  affection: number;
  label: string;
  /** A face from MOOD_KAOMOJIS, or "" to let the engine pick. */
  kaomoji: string;
  note: string;
}

export interface EngineConfig {
  /** Fraction of the distance to baseline recovered per turn (0 = never calms down, 1 = instant). */
  decay: number;
  /** Multiplier on impulses (character volatility). */
  sensitivity: number;
  /** Max affection change per turn — relationships move slowly. */
  maxAffectionStep: number;
  /** Multiplier on changes that hurt: affection lost, negative feelings provoked, joy/trust eased. */
  negativityBias: number;
  /** Multiplier on changes that feel good. Below 1 so goodwill has to be earned. */
  warmthBias: number;
}

export const DEFAULT_ENGINE: EngineConfig = { decay: 0.18, sensitivity: 1, maxAffectionStep: 14, negativityBias: 1.4, warmthBias: 0.7 };

export const NEUTRAL_BASELINE: EmotionVector = {
  joy: 20,
  trust: 15,
  fear: 8,
  surprise: 8,
  sadness: 8,
  disgust: 4,
  anger: 4,
  anticipation: 20,
  /** Sexual attraction / arousal toward {{user}} ("horny level"). */
  desire: 3,
};

/** The mood faces from the app's kaomoji list (animals carry no mood, so they're left out). */
export const MOOD_KAOMOJIS: readonly string[] = KAOMOJI_GROUPS.filter((g) => g.mood !== "Animals").flatMap((g) => g.items);

export const groupOf = (mood: string): readonly string[] => KAOMOJI_GROUPS.find((g) => g.mood === mood)?.items ?? MOOD_KAOMOJIS;

/** Which kaomoji group fits each emotion when the model doesn't choose a face. */
const EMOTION_FACES: Record<EmotionName, readonly string[]> = {
  joy: groupOf("Happy"),
  trust: groupOf("Love"),
  fear: groupOf("Shocked / Confused"),
  surprise: groupOf("Shocked / Confused"),
  sadness: groupOf("Sad"),
  disgust: groupOf("Smug / Sus"),
  anger: groupOf("Angry"),
  anticipation: groupOf("Smug / Sus"),
  desire: groupOf("Love"),
};

/** A face for the strongest emotion; `seed` (e.g. the label) varies it stably within the group. */
export function faceFor(v: EmotionVector, seed = "") {
  const [top] = dominant(v);
  const faces = v[top] < 30 ? groupOf("Happy").slice(0, 1) : EMOTION_FACES[top];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return faces[Math.abs(h) % faces.length];
}

const norm = (k: string) => k.normalize("NFKC").replace(/\s+/g, "");
const BY_NORM = new Map(MOOD_KAOMOJIS.map((k) => [norm(k), k]));

/** Accept a list number (1-based) or the face itself; anything not on the list becomes "". */
export function cleanKaomoji(x: unknown): string {
  if (typeof x === "number" || (typeof x === "string" && /^\s*#?\d+\s*$/.test(x))) {
    const i = Number(String(x).replace(/\D/g, "")) - 1;
    return MOOD_KAOMOJIS[i] ?? "";
  }
  if (typeof x !== "string") return "";
  return BY_NORM.get(norm(x)) ?? "";
}

const WORDS: Record<EmotionName, [string, string, string]> = {
  // mild, moderate, intense
  joy: ["content", "happy", "elated"],
  trust: ["at ease", "trusting", "devoted"],
  fear: ["uneasy", "afraid", "terrified"],
  surprise: ["curious", "surprised", "stunned"],
  sadness: ["wistful", "sad", "heartbroken"],
  disgust: ["put off", "disgusted", "revolted"],
  anger: ["irritated", "angry", "furious"],
  anticipation: ["interested", "eager", "consumed by anticipation"],
  desire: ["flirty", "aroused", "burning with desire"],
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (x: unknown, fallback = 0) => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() && Number.isFinite(Number(x)) ? Number(x) : fallback);

/** Emotions whose rise feels good (desire too: slow to build, quick to kill); the rest (fear, sadness, disgust, anger) hurt when provoked. */
const PLEASANT: ReadonlySet<EmotionName> = new Set(["joy", "trust", "anticipation", "desire"]);

export function initialState(baseline: EmotionBaseline = NEUTRAL_BASELINE): EmotionState {
  const v = {} as EmotionVector;
  for (const e of EMOTIONS) v[e] = Math.round(clamp(num(baseline[e], NEUTRAL_BASELINE[e]), 0, 100));
  const label = autoLabel(v);
  return { v, affection: Math.round(clamp(num(baseline.affection), -100, 100)), label, kaomoji: faceFor(v, label), note: "" };
}

/** Emotions sorted by intensity (strongest first). */
export function dominant(v: EmotionVector): EmotionName[] {
  return [...EMOTIONS].sort((a, b) => v[b] - v[a]);
}

function intensityWord(name: EmotionName, value: number) {
  const w = WORDS[name];
  return value >= 75 ? w[2] : value >= 45 ? w[1] : w[0];
}

/** Label derived from the numbers (used when the model gives none). */
export function autoLabel(v: EmotionVector) {
  const [a, b] = dominant(v);
  if (v[a] < 30) return "calm";
  const first = intensityWord(a, v[a]);
  return v[b] >= 40 && v[a] - v[b] < 20 ? `${first}, ${intensityWord(b, v[b])}` : first;
}

/** One engine step: decay toward baseline, apply scaled impulses, clamp. */
export function step(prev: EmotionState, appraisal: Appraisal, baseline: EmotionBaseline = NEUTRAL_BASELINE, cfg: EngineConfig = DEFAULT_ENGINE): EmotionState {
  const v = {} as EmotionVector;
  for (const e of EMOTIONS) {
    // Baselines saved before an emotion existed don't have it.
    const rest = clamp(num(baseline[e], NEUTRAL_BASELINE[e]), 0, 100);
    const cur = clamp(num(prev.v[e], rest), 0, 100);
    const decayed = cur + (rest - cur) * cfg.decay;
    const raw = clamp(num(appraisal.impulse[e]), -50, 50);
    const hurts = PLEASANT.has(e) ? raw < 0 : raw > 0;
    const impulse = raw * cfg.sensitivity * (hurts ? cfg.negativityBias : cfg.warmthBias);
    // Diminishing returns near the edges so one dramatic turn can't pin everything at 100.
    const room = impulse > 0 ? (100 - decayed) / 100 : decayed / 100;
    v[e] = Math.round(clamp(decayed + impulse * (0.4 + 0.6 * room), 0, 100));
  }
  const prevAff = clamp(num(prev.affection), -100, 100);
  let aff = clamp(num(appraisal.affection), -50, 50);
  // Losing goodwill is easy; earning it is slow, and slower the more of it there already is.
  aff = aff < 0 ? aff * cfg.negativityBias : aff * cfg.warmthBias * (1 - Math.max(0, prevAff) / 140);
  const affStep = clamp(aff, -cfg.maxAffectionStep, cfg.maxAffectionStep);
  const affection = Math.round(clamp(prevAff + affStep, -100, 100));
  const label = cleanLabel(appraisal.label) || autoLabel(v);
  const kaomoji = cleanKaomoji(appraisal.kaomoji) || faceFor(v, label);
  return { v, affection, label, kaomoji, note: cleanNote(appraisal.note) };
}

function cleanLabel(s: unknown) {
  return typeof s === "string" ? s.replace(/["*_`]/g, "").trim().toLowerCase().slice(0, 40) : "";
}
export function cleanNote(s: unknown) {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 240) : "";
}
/** Normalize anything stored in the DB into a valid state (old/partial rows, manual edits). */
export function normalizeState(x: unknown, baseline: EmotionBaseline = NEUTRAL_BASELINE): EmotionState | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Partial<EmotionState>;
  const v = {} as EmotionVector;
  for (const e of EMOTIONS) v[e] = Math.round(clamp(num(o.v?.[e], num(baseline[e], NEUTRAL_BASELINE[e])), 0, 100));
  return {
    v,
    affection: Math.round(clamp(num(o.affection), -100, 100)),
    label: cleanLabel(o.label) || autoLabel(v),
    kaomoji: cleanKaomoji(o.kaomoji) || faceFor(v, cleanLabel(o.label)),
    note: cleanNote(o.note),
    ...(o.manual ? { manual: true } : {}),
  };
}

export function affectionWord(a: number) {
  if (a <= -60) return "hostile";
  if (a <= -25) return "cold";
  if (a < -8) return "wary";
  if (a <= 8) return "neutral";
  if (a < 30) return "warm";
  if (a < 60) return "fond";
  if (a < 85) return "deeply attached";
  return "devoted";
}

/** Most recent assistant emotion on a path, before `beforeIndex` (exclusive). */
export function latestEmotion(path: { role: string; emotion?: EmotionState | null }[], beforeIndex = path.length): EmotionState | null {
  for (let i = Math.min(beforeIndex, path.length) - 1; i >= 0; i--) {
    const m = path[i];
    if (m.role === "assistant" && m.emotion) return m.emotion;
  }
  return null;
}

/** Plain description of a state: mood, strongest feelings, stance toward {{user}}, inner note. */
export interface DescribeOptions {
  /** Leave desire out (the chat's "show desire to the model" switch is off). */
  hideDesire?: boolean;
}

const DESIRE_WORDS = /\b(flirty|aroused|desire|lust\w*|horny|hot and bothered)\b/i;

export function describeState(s: EmotionState, opts: DescribeOptions = {}) {
  const v = opts.hideDesire ? { ...s.v, desire: 0 } : s.v;
  const strong = dominant(v)
    .filter((e) => v[e] >= 30)
    .slice(0, 3);
  const feelings = strong.length ? strong.map((e) => `${intensityWord(e, v[e])} (${e} ${v[e]}/100)`).join(", ") : "calm, no strong feelings";
  // A label like "aroused" would give it away; describe the rest of the mood instead.
  const label = opts.hideDesire && DESIRE_WORDS.test(s.label) ? autoLabel(v) : s.label;
  const sign = s.affection > 0 ? "+" : "";
  let out = `mood: ${label}. Feeling ${feelings}. Toward {{user}}: ${affectionWord(s.affection)} (${sign}${s.affection}).`;
  if (s.note) out += ` Inside: ${s.note}`;
  return out;
}

/** Prompt text injected near the end of the history. `{{char}}`/`{{user}}` resolve later. */
export function describeForPrompt(s: EmotionState, opts: DescribeOptions = {}) {
  return `[{{char}}'s current emotional state — ${describeState(s, opts)} Let this color {{char}}'s tone, word choice, body language and decisions naturally. Feelings can shift in response to what happens next; don't name the emotions outright or mention numbers.]`;
}
