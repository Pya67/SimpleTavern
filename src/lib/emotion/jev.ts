/**
 * Jev questions and answers for the emotion engine.
 *
 * Jev (TypeSafe, served by OpenRouter's Decisions API) doesn't write text: it reads a *state* and
 * answers typed questions with calibrated probabilities. Each emotion is a score on a 5-step rubric,
 * the shift toward {{user}} a score on a 7-step rubric, and mood/cause are choices. This module only
 * builds the questions and turns answers into engine input; run.ts does the HTTP call.
 *
 * Pure module: no DB, no network. Unit-tested in tests/unit/emotion.test.ts.
 */

import { EMOTIONS, NEUTRAL_BASELINE, groupOf, type Appraisal, type EmotionBaseline, type EmotionName, type EmotionVector } from "@/lib/emotion/engine";

export const JEV_MODEL = "typesafe/jev-1.14";

export type JevQuestion =
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

export type JevAnswer =
  | { type: "score"; score: number; confidence?: number | null }
  | { type: "choice"; choice: string; confidence?: number | null }
  | { type: "noul"; noul: number };

export type JevAnswers = Record<string, JevAnswer | undefined>;

interface Names {
  char: string;
  user: string;
}

const DESCRIBE: Record<EmotionName, string> = {
  joy: "joy (happiness, pleasure, amusement)",
  trust: "trust (feeling safe, relying on others, letting their guard down)",
  fear: "fear (anxiety, dread, feeling threatened)",
  surprise: "surprise (being caught off guard, astonishment)",
  sadness: "sadness (hurt, grief, loneliness, disappointment)",
  disgust: "disgust (contempt, revulsion, finding something beneath them)",
  anger: "anger (irritation, resentment, rage)",
  anticipation: "anticipation (eagerness, curiosity, wanting what comes next)",
  desire: "desire (sexual attraction to and arousal around {{user}}, being turned on; unwanted advances raise disgust or anger, not desire)",
};

const ins = (s: string, n: Names) => s.replaceAll("{{char}}", n.char).replaceAll("{{user}}", n.user);

/** Judge from the character, not from manners: the part that keeps chats from drifting into adoration. */
const PERSPECTIVE =
  "Judge strictly through {{char}}'s own personality, values, goals and history with {{user}}, not by general politeness. " +
  "A cruel, proud, hostile or guarded character may resent kindness, pity, flattery, being refused or being told what to do. " +
  "Trust is slow to earn and quick to lose. If {{char}} is hiding a feeling, judge the feeling, not the mask.";

// ---------------- per-turn appraisal ----------------

const IMPULSE_LEVELS = ["Much weaker than before", "A bit weaker than before", "No real change", "A bit stronger than before", "Much stronger than before"];
/** Impulse for each rubric step (score is the probability-weighted step index, so it's fractional). */
const IMPULSE_AT = [-40, -18, 0, 18, 40];

const AFFECTION_LEVELS = [
  "Much colder: {{char}} now resents, despises or distrusts {{user}} noticeably more",
  "Colder: {{char}} likes or trusts {{user}} a little less",
  "Slightly cooler",
  "No change in how {{char}} feels about {{user}}",
  "Slightly warmer",
  "Warmer: {{char}} likes or trusts {{user}} a little more",
  "Much warmer: a real breakthrough between them",
];
const AFFECTION_AT = [-15, -8, -3, 0, 3, 8, 15];

/** What set the feelings off; turned into the inner note. Ordered so "nothing" doesn't win by position. */
const CAUSES: Record<string, string> = {
  insult: "{{user}} insulted, mocked or belittled {{char}}",
  threat: "{{user}} threatened, hurt or scared {{char}}",
  deceit: "{{user}} lied to, manipulated or betrayed {{char}}",
  defiance: "{{user}} defied, refused, argued with or ordered {{char}} around",
  neglect: "{{user}} ignored, dismissed or let {{char}} down",
  kindness: "{{user}} was kind, caring or comforting",
  flirting: "{{user}} flirted, seduced, praised or got physically or sexually close",
  humor: "{{user}} joked or teased",
  help: "{{user}} helped {{char}} or gave them something",
  respect: "{{user}} showed respect, deference or obedience",
  scene: "something in the scene itself (not {{user}}) affected {{char}}",
  nothing: "nothing notable happened to {{char}}",
};

const CAUSE_NOTE: Record<string, string> = {
  insult: "{{user}} mocked them",
  threat: "{{user}} threatened them",
  deceit: "{{user}} lied to or played them",
  defiance: "{{user}} pushed back against them",
  neglect: "{{user}} brushed them off",
  kindness: "{{user}} was kind to them",
  flirting: "{{user}} came on to them",
  humor: "{{user}} teased them",
  help: "{{user}} helped them",
  respect: "{{user}} showed them respect",
  scene: "what's happening around them",
};

/** Choice keys → kaomoji group. Negative moods listed first to offset Jev's first-option lean. */
const MOODS: Record<string, { group: string; criteria: string }> = {
  neutral: { group: "", criteria: "Composed or neutral; nothing much shows" },
  angry: { group: "Angry", criteria: "Angry, irritated, hostile" },
  sad: { group: "Sad", criteria: "Sad, hurt, lonely" },
  shocked: { group: "Shocked / Confused", criteria: "Shocked, scared, confused, flustered" },
  smug: { group: "Smug / Sus", criteria: "Smug, scheming, suspicious, contemptuous, mischievous" },
  happy: { group: "Happy", criteria: "Happy, cheerful, excited" },
  love: { group: "Love", criteria: "Affectionate, tender, smitten" },
  aroused: { group: "Love", criteria: "Aroused, lustful, hot and bothered" },
};

export function appraisalQuestions(n: Names): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {};
  for (const e of EMOTIONS) {
    q[e] = {
      type: "score",
      instructions: ins(
        `Compare {{char}}'s ${DESCRIBE[e]} right after the latest exchange with "feelings_before". How did it change? Count what {{char}} shows in their own reply. ${PERSPECTIVE}`,
        n,
      ),
      criteria: IMPULSE_LEVELS,
    };
  }
  q.affection = {
    type: "score",
    instructions: ins(`How did the latest exchange change how {{char}} feels about {{user}}? ${PERSPECTIVE}`, n),
    criteria: AFFECTION_LEVELS.map((c) => ins(c, n)),
  };
  q.mood = {
    type: "choice",
    instructions: ins("Which best describes {{char}}'s mood at the end of the latest exchange, including what they hide?", n),
    criteria: Object.fromEntries(Object.entries(MOODS).map(([k, m]) => [k, m.criteria])),
  };
  q.cause = {
    type: "choice",
    instructions: ins("What in the latest exchange most affected {{char}}'s feelings?", n),
    criteria: Object.fromEntries(Object.entries(CAUSES).map(([k, c]) => [k, ins(c, n)])),
  };
  return q;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Linear interpolation of a fractional rubric step into a value table. */
function lerp(table: number[], score: number) {
  const s = clamp(score, 0, table.length - 1);
  const i = Math.floor(s);
  return i >= table.length - 1 ? table[i] : table[i] + (table[i + 1] - table[i]) * (s - i);
}

function scoreOf(a: JevAnswer | undefined): number | null {
  return a && a.type === "score" && typeof a.score === "number" && Number.isFinite(a.score) ? a.score : null;
}
function choiceOf(a: JevAnswer | undefined, minConfidence = 0): string | null {
  if (!a || a.type !== "choice" || typeof a.choice !== "string") return null;
  return a.confidence == null || a.confidence >= minConfidence ? a.choice : null;
}

function pick<T>(items: readonly T[], seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return items[Math.abs(h) % items.length];
}

/** Turn Jev's answers into an engine appraisal. Null when nothing usable came back. */
export function readAppraisal(answers: JevAnswers, n: Names): Appraisal | null {
  const impulse: Partial<EmotionVector> = {};
  let any = false;
  for (const e of EMOTIONS) {
    const s = scoreOf(answers[e]);
    if (s == null) continue;
    const v = lerp(IMPULSE_AT, s);
    // Ignore the jitter of a "no change" answer spread across neighbours.
    impulse[e] = Math.abs(v) < 4 ? 0 : Math.round(v);
    any = true;
  }
  const affScore = scoreOf(answers.affection);
  const affection = affScore == null ? 0 : Math.round(lerp(AFFECTION_AT, affScore) * 10) / 10;
  if (!any && affScore == null) return null;

  const mood = choiceOf(answers.mood);
  const cause = choiceOf(answers.cause, 0.3);
  const group = mood ? MOODS[mood]?.group : "";
  const kaomoji = group ? pick(groupOf(group), `${mood}:${cause ?? ""}`) : "";

  let note = "";
  if (cause && CAUSE_NOTE[cause]) {
    const toward = affection <= -2 ? `, and they think less of ${n.user} for it` : affection >= 2 ? `, and they're warming to ${n.user}` : "";
    note = ins(CAUSE_NOTE[cause], n) + toward + ".";
    note = note[0].toUpperCase() + note.slice(1);
  }
  return { impulse, affection, label: "", kaomoji, note };
}

// ---------------- baseline (once per chat) ----------------

const TEMPER_LEVELS = ["Almost never", "Rarely", "Sometimes", "Often", "Almost constantly"];
const TEMPER_AT = [3, 15, 30, 45, 60];
const DESIRE_LEVELS = ["None at all", "A faint spark", "Noticeable attraction", "Strong attraction", "Can barely keep it in check"];
const DESIRE_AT = [0, 10, 25, 42, 60];

const START_LEVELS = [
  "Hostile: hates {{user}} or wants to harm them",
  "Cold: contemptuous, resentful or deeply distrustful of {{user}}",
  "Wary: suspicious or guarded around {{user}}",
  "Neutral: no real opinion of {{user}} yet",
  "Friendly: open and well-disposed toward {{user}}",
  "Fond: clearly likes or cares about {{user}}",
  "Devoted: loves or is deeply attached to {{user}}",
];
const START_AT = [-70, -45, -20, 0, 15, 40, 70];

export function baselineQuestions(n: Names): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {};
  for (const e of EMOTIONS) {
    q[e] =
      e === "desire"
        ? {
            type: "score",
            instructions: ins(
              "At the very start of this scenario, how much sexual attraction or arousal does {{char}} feel toward {{user}}? Use the character sheet, scenario, greeting and any shared history.",
              n,
            ),
            criteria: DESIRE_LEVELS,
          }
        : {
            type: "score",
            instructions: ins(`From the character sheet and scenario: on an ordinary, uneventful day, how often does {{char}} feel ${DESCRIBE[e]}?`, n),
            criteria: TEMPER_LEVELS,
          };
  }
  q.affection = {
    type: "score",
    instructions: ins(
      "At the very start of this scenario, before anything has happened in the chat, how does {{char}} feel about {{user}}? Use the scenario, the greeting and any shared history. A villain, captor, rival or someone {{user}} wronged starts negative; a stranger usually starts neutral or wary.",
      n,
    ),
    criteria: START_LEVELS.map((c) => ins(c, n)),
  };
  return q;
}

/** Baseline from Jev's answers; emotions Jev skipped stay neutral. Null when nothing usable came back. */
export function readBaseline(answers: JevAnswers): EmotionBaseline | null {
  const v: EmotionBaseline = { ...NEUTRAL_BASELINE };
  let any = false;
  for (const e of EMOTIONS) {
    const s = scoreOf(answers[e]);
    if (s == null) continue;
    v[e] = Math.round(lerp(e === "desire" ? DESIRE_AT : TEMPER_AT, s));
    any = true;
  }
  const a = scoreOf(answers.affection);
  if (a != null) {
    v.affection = Math.round(lerp(START_AT, a));
    any = true;
  }
  return any ? v : null;
}
