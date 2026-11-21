/**
 * Emotion engine: a small, deterministic state machine for a character's feelings.
 *
 * Every assistant reply gets an *appraisal* from a cheap model (impulses per emotion, a mood label,
 * an inner note). The engine — not the model — owns the numbers: each turn emotions decay toward the
 * character's baseline temperament, then the impulses are applied with some inertia and clamped.
 * That keeps moods coherent across a long chat instead of jumping around with every reply.
 *
 * Pure module: no DB, no LLM. Unit-tested in tests/unit/emotion.test.ts.
 */

import { KAOMOJI_GROUPS } from "@/lib/kaomoji";

export const EMOTIONS = ["joy", "trust", "fear", "surprise", "sadness", "disgust", "anger", "anticipation"] as const;
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

/** What the appraisal model returns (before the engine applies it). */
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
}

export const DEFAULT_ENGINE: EngineConfig = { decay: 0.18, sensitivity: 1, maxAffectionStep: 12 };

export const NEUTRAL_BASELINE: EmotionVector = {
  joy: 25,
  trust: 25,
  fear: 8,
  surprise: 8,
  sadness: 8,
  disgust: 4,
  anger: 4,
  anticipation: 20,
};

/** The mood faces from the app's kaomoji list (animals carry no mood, so they're left out). */
export const MOOD_KAOMOJIS: readonly string[] = KAOMOJI_GROUPS.filter((g) => g.mood !== "Animals").flatMap((g) => g.items);

const groupOf = (mood: string): readonly string[] => KAOMOJI_GROUPS.find((g) => g.mood === mood)?.items ?? MOOD_KAOMOJIS;

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
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (x: unknown, fallback = 0) => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() && Number.isFinite(Number(x)) ? Number(x) : fallback);

export function initialState(baseline: EmotionVector = NEUTRAL_BASELINE): EmotionState {
  const v = { ...baseline };
  const label = autoLabel(v);
  return { v, affection: 0, label, kaomoji: faceFor(v, label), note: "" };
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
export function step(prev: EmotionState, appraisal: Appraisal, baseline: EmotionVector = NEUTRAL_BASELINE, cfg: EngineConfig = DEFAULT_ENGINE): EmotionState {
  const v = {} as EmotionVector;
  for (const e of EMOTIONS) {
    const cur = clamp(num(prev.v[e], baseline[e]), 0, 100);
    const decayed = cur + (baseline[e] - cur) * cfg.decay;
    const impulse = clamp(num(appraisal.impulse[e]), -50, 50) * cfg.sensitivity;
    // Diminishing returns near the edges so one dramatic turn can't pin everything at 100.
    const room = impulse > 0 ? (100 - decayed) / 100 : decayed / 100;
    v[e] = Math.round(clamp(decayed + impulse * (0.4 + 0.6 * room), 0, 100));
  }
  const affStep = clamp(num(appraisal.affection), -cfg.maxAffectionStep, cfg.maxAffectionStep);
  const affection = Math.round(clamp(num(prev.affection) + affStep, -100, 100));
  const label = cleanLabel(appraisal.label) || autoLabel(v);
  const kaomoji = cleanKaomoji(appraisal.kaomoji) || faceFor(v, label);
  return { v, affection, label, kaomoji, note: cleanNote(appraisal.note) };
}

function cleanLabel(s: unknown) {
  return typeof s === "string" ? s.replace(/["*_`]/g, "").trim().toLowerCase().slice(0, 40) : "";
}
function cleanNote(s: unknown) {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 240) : "";
}
/** Pull the first JSON object out of a model reply (tolerates code fences and chatter). */
function extractJson(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : raw;
  const start = src.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(src.slice(start, i + 1).replace(/,\s*([}\]])/g, "$1"));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Parse an appraisal reply. Returns null if nothing usable came back. */
export function parseAppraisal(raw: string): Appraisal | null {
  const o = extractJson(raw);
  if (!o) return null;
  const src = (o.impulse ?? o.impulses ?? o.emotions ?? o) as Record<string, unknown>;
  const impulse: Partial<EmotionVector> = {};
  let any = false;
  for (const e of EMOTIONS) {
    if (src && e in src) {
      impulse[e] = clamp(num(src[e]), -50, 50);
      any = true;
    }
  }
  const label = cleanLabel(o.label ?? o.mood);
  if (!any && !label) return null;
  return {
    impulse,
    affection: clamp(num(o.affection), -50, 50),
    label,
    kaomoji: cleanKaomoji(o.kaomoji ?? o.face),
    note: cleanNote(o.note ?? o.reason ?? o.inner),
  };
}

/** Parse a baseline-temperament reply (absolute 0–100 values). */
export function parseBaseline(raw: string): EmotionVector | null {
  const o = extractJson(raw);
  if (!o) return null;
  const src = (o.baseline ?? o) as Record<string, unknown>;
  const v = { ...NEUTRAL_BASELINE };
  let any = false;
  for (const e of EMOTIONS) {
    if (src && e in src) {
      // Temperament stays moderate: a baseline at 100 would leave no room to feel more.
      v[e] = Math.round(clamp(num(src[e], NEUTRAL_BASELINE[e]), 0, 70));
      any = true;
    }
  }
  return any ? v : null;
}

/** Normalize anything stored in the DB into a valid state (old/partial rows, manual edits). */
export function normalizeState(x: unknown, baseline: EmotionVector = NEUTRAL_BASELINE): EmotionState | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Partial<EmotionState>;
  const v = {} as EmotionVector;
  for (const e of EMOTIONS) v[e] = Math.round(clamp(num(o.v?.[e], baseline[e]), 0, 100));
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
export function describeState(s: EmotionState) {
  const strong = dominant(s.v).filter((e) => s.v[e] >= 30).slice(0, 3);
  const feelings = strong.length ? strong.map((e) => `${intensityWord(e, s.v[e])} (${e} ${s.v[e]}/100)`).join(", ") : "calm, no strong feelings";
  const sign = s.affection > 0 ? "+" : "";
  let out = `mood: ${s.label}. Feeling ${feelings}. Toward {{user}}: ${affectionWord(s.affection)} (${sign}${s.affection}).`;
  if (s.note) out += ` Inside: ${s.note}`;
  return out;
}

/** Prompt text injected near the end of the history. `{{char}}`/`{{user}}` resolve later. */
export function describeForPrompt(s: EmotionState) {
  return `[{{char}}'s current emotional state — ${describeState(s)} Let this color {{char}}'s tone, word choice, body language and decisions naturally. Feelings can shift in response to what happens next; don't name the emotions outright or mention numbers.]`;
}

export const APPRAISAL_PROMPT = `You are the emotion engine for a roleplay character named {{char}}. You read the latest exchange and judge how it changed {{char}}'s feelings. You never write story text.

Emotions (Plutchik): joy, trust, fear, surprise, sadness, disgust, anger, anticipation.
Return impulses: how much each emotion moved THIS turn, from -50 (strongly eased) to 50 (strongly provoked). 0 = unaffected. Most turns move only 1-3 emotions by 5-25. Reserve |impulse| > 35 for genuinely dramatic moments.
affection: change in {{char}}'s feelings toward {{user}} this turn, -15 to 15.
label: 1-3 word mood in {{char}}'s own terms (e.g. "flustered", "quietly furious", "smug").
kaomoji: the number of the face below that best fits that mood.
note: one short sentence of {{char}}'s inner state — what they feel and why, including anything they hide.

Judge from {{char}}'s personality and what actually happened, including what {{char}} shows in their reply. Reply with JSON only:
{"impulse":{"joy":0,"trust":0,"fear":0,"surprise":0,"sadness":0,"disgust":0,"anger":0,"anticipation":0},"affection":0,"label":"","kaomoji":1,"note":""}

Faces:
${KAOMOJI_GROUPS.filter((g) => g.mood !== "Animals")
  .map((g) => `${g.mood}: ` + g.items.map((k) => `${MOOD_KAOMOJIS.indexOf(k) + 1} ${k}`).join("  "))
  .join("\n")}`;

export const BASELINE_PROMPT = `You are the emotion engine for a roleplay character named {{char}}. From the character sheet, estimate {{char}}'s resting temperament: how strongly they feel each emotion on an ordinary, uneventful day, 0-70.
Emotions: joy, trust, fear, surprise, sadness, disgust, anger, anticipation.
A cheerful character might have joy 45; a guarded one trust 10; a melancholic one sadness 35. Reply with JSON only:
{"joy":25,"trust":25,"fear":8,"surprise":8,"sadness":8,"disgust":4,"anger":4,"anticipation":20}`;
