import { describe, expect, it } from "vitest";
import { KAOMOJI_GROUPS } from "@/lib/kaomoji";
import {
  DEFAULT_ENGINE,
  MOOD_KAOMOJIS,
  cleanKaomoji,
  EMOTIONS,
  NEUTRAL_BASELINE,
  describeForPrompt,
  initialState,
  latestEmotion,
  normalizeState,
  step,
  type Appraisal,
} from "@/lib/emotion/engine";
import { appraisalQuestions, baselineQuestions, readAppraisal, readBaseline, type JevAnswers } from "@/lib/emotion/jev";
import { buildPrompt, type BuildInput } from "@/lib/prompt/builder";
import { DEFAULT_TEMPLATE_BLOCKS } from "@/lib/defaults";

const quiet: Appraisal = { impulse: {}, affection: 0, label: "", kaomoji: "", note: "" };

describe("emotion engine step", () => {
  it("decays toward the baseline when nothing happens", () => {
    let s = initialState();
    s = { ...s, v: { ...s.v, anger: 90 } };
    for (let i = 0; i < 10; i++) s = step(s, quiet);
    expect(s.v.anger).toBeLessThan(25);
    expect(s.v.anger).toBeGreaterThanOrEqual(NEUTRAL_BASELINE.anger);
  });

  it("applies impulses with diminishing returns near the top", () => {
    const s0 = initialState();
    const s1 = step(s0, { ...quiet, impulse: { joy: 40 } });
    expect(s1.v.joy).toBeGreaterThan(s0.v.joy + 20);
    // Repeated maximal provocation can approach but not exceed 100.
    let s = s0;
    for (let i = 0; i < 20; i++) s = step(s, { ...quiet, impulse: { anger: 50 } });
    expect(s.v.anger).toBeLessThanOrEqual(100);
    expect(s.v.anger).toBeGreaterThan(80);
  });

  it("lets hurt land harder than kindness", () => {
    const s0 = initialState();
    const warmer = step(s0, { ...quiet, affection: 8 });
    const colder = step(s0, { ...quiet, affection: -8 });
    expect(Math.abs(colder.affection)).toBeGreaterThan(warmer.affection * 1.5);
    const hurt = step(s0, { ...quiet, impulse: { anger: 20 } }).v.anger - s0.v.anger;
    const glad = step(s0, { ...quiet, impulse: { joy: 20 } }).v.joy - s0.v.joy;
    expect(hurt).toBeGreaterThan(glad);
  });

  it("makes warming up slower the warmer they already are", () => {
    const fond = { ...initialState(), affection: 70 };
    const stranger = initialState();
    expect(step(fond, { ...quiet, affection: 8 }).affection - 70).toBeLessThan(step(stranger, { ...quiet, affection: 8 }).affection);
    // Souring is not dampened.
    expect(step(fond, { ...quiet, affection: -8 }).affection - 70).toBe(step(stranger, { ...quiet, affection: -8 }).affection);
  });

  it("tracks desire: slow to build, quick to kill, and safe with old baselines", () => {
    const s0 = initialState();
    const up = step(s0, { ...quiet, impulse: { desire: 20 } }).v.desire - s0.v.desire;
    const down = { ...s0, v: { ...s0.v, desire: 60 } };
    const drop = 60 - step(down, { ...quiet, impulse: { desire: -20 } }).v.desire;
    expect(up).toBeGreaterThan(0);
    expect(drop).toBeGreaterThan(up);
    const oldBaseline: Partial<typeof NEUTRAL_BASELINE> = { ...NEUTRAL_BASELINE };
    delete oldBaseline.desire;
    const s = step(s0, quiet, oldBaseline as typeof NEUTRAL_BASELINE);
    expect(Number.isFinite(s.v.desire)).toBe(true);
    expect(readBaseline({ desire: score(4) })!.desire).toBe(60);
  });

  it("starts from the baseline's affection", () => {
    expect(initialState({ ...NEUTRAL_BASELINE, affection: -45 }).affection).toBe(-45);
    expect(initialState().affection).toBe(0);
  });

  it("clamps out-of-range impulses and limits affection per turn", () => {
    const s = step(initialState(), { ...quiet, impulse: { fear: 999 }, affection: 80 });
    expect(s.v.fear).toBeLessThanOrEqual(100);
    expect(s.affection).toBe(DEFAULT_ENGINE.maxAffectionStep);
  });

  it("falls back to an automatic label and a face from the matching kaomoji group", () => {
    const s = step(initialState(), { ...quiet, impulse: { sadness: 50 } });
    expect(s.label).toMatch(/sad|wistful|heartbroken/);
    expect(KAOMOJI_GROUPS.find((g) => g.mood === "Sad")!.items).toContain(s.kaomoji);
  });

  it("only keeps faces from the list", () => {
    expect(cleanKaomoji(1)).toBe(MOOD_KAOMOJIS[0]);
    expect(cleanKaomoji("#3")).toBe(MOOD_KAOMOJIS[2]);
    expect(cleanKaomoji(" (╥﹏╥) ")).toBe("(╥﹏╥)");
    expect(cleanKaomoji("😢")).toBe("");
    expect(cleanKaomoji(999)).toBe("");
    // Animals carry no mood.
    expect(MOOD_KAOMOJIS).not.toContain("ʕ•ᴥ•ʔ");
  });
});

const names = { char: "Mira", user: "Traveler" };
const score = (n: number) => ({ type: "score" as const, score: n, confidence: 0.6 });
const choice = (c: string, confidence = 0.7) => ({ type: "choice" as const, choice: c, confidence });

describe("Jev questions and answers", () => {
  it("asks one score per emotion plus affection, mood and cause, with names filled in", () => {
    const q = appraisalQuestions(names);
    for (const e of EMOTIONS) expect(q[e].type).toBe("score");
    expect(Object.keys(q)).toEqual(expect.arrayContaining(["affection", "mood", "cause"]));
    const text = JSON.stringify(q);
    expect(text).toContain("Mira");
    expect(text).toContain("Traveler");
    expect(text).not.toContain("{{");
    expect(JSON.stringify(baselineQuestions(names))).toContain("very start of this scenario");
  });

  it("maps rubric scores onto impulses and affection", () => {
    const a = readAppraisal({ anger: score(4), joy: score(0), trust: score(2.05), affection: score(1), mood: choice("angry"), cause: choice("insult") }, names)!;
    expect(a.impulse.anger).toBe(40);
    expect(a.impulse.joy).toBe(-40);
    expect(a.impulse.trust).toBe(0); // jitter around "no change" is ignored
    expect(a.affection).toBe(-8);
    expect(KAOMOJI_GROUPS.find((g) => g.mood === "Angry")!.items).toContain(a.kaomoji);
    expect(a.note).toBe("Traveler mocked them, and they think less of Traveler for it.");
  });

  it("interpolates fractional scores and skips unsure causes", () => {
    const a = readAppraisal({ fear: score(3.5), affection: score(4.5), cause: choice("kindness", 0.1) }, names)!;
    expect(a.impulse.fear).toBe(29);
    expect(a.affection).toBe(5.5);
    expect(a.note).toBe("");
    expect(a.kaomoji).toBe("");
  });

  it("returns null when nothing usable came back", () => {
    expect(readAppraisal({}, names)).toBeNull();
    expect(readAppraisal({ mood: choice("happy") } as JevAnswers, names)).toBeNull();
    expect(readBaseline({})).toBeNull();
  });

  it("reads a baseline with a starting affection", () => {
    const b = readBaseline({ anger: score(4), joy: score(1), affection: score(1) })!;
    expect(b.anger).toBe(60);
    expect(b.joy).toBe(15);
    expect(b.trust).toBe(NEUTRAL_BASELINE.trust);
    expect(b.affection).toBe(-45);
    expect(initialState(b).affection).toBe(-45);
  });

  it("normalizes partial stored states", () => {
    const s = normalizeState({ v: { joy: 140 }, affection: -500 })!;
    expect(s.v.joy).toBe(100);
    expect(s.affection).toBe(-100);
    for (const e of EMOTIONS) expect(typeof s.v[e]).toBe("number");
    expect(normalizeState(null)).toBeNull();
  });
});

describe("prompt integration", () => {
  const base = (p: Partial<BuildInput> = {}): BuildInput => ({
    blocks: DEFAULT_TEMPLATE_BLOCKS,
    character: { name: "Mira", description: "", personality: "", scenario: "", exampleDialogue: "", systemPrompt: "", postHistoryInstructions: "" },
    persona: { id: "p1", name: "Traveler", description: "" },
    personaNames: {},
    history: [
      { id: "a", role: "assistant", content: "Hello.", personaId: null },
      { id: "b", role: "user", content: "Hi!", personaId: "p1" },
    ],
    memory: [],
    coveredIds: new Set(),
    facts: [],
    contextSize: 8192,
    maxTokens: 300,
    mode: "reply",
    countTokens: (s) => Math.ceil(s.length / 4),
    ...p,
  });

  it("injects the state right before the latest message, with macros resolved", () => {
    const emotion = describeForPrompt(step(initialState(), { ...quiet, impulse: { joy: 40 }, label: "cheerful" }));
    const r = buildPrompt(base({ emotion, targetWords: 120 }));
    const idx = r.messages.findIndex((m) => m.content.includes("current emotional state"));
    const hi = r.messages.findIndex((m) => m.content === "Hi!");
    expect(idx).toBe(hi - 1);
    expect(r.messages[idx].content).toContain("Mira's current emotional state");
    expect(r.messages[idx].content).toContain("Toward Traveler");
    // The length note stays right after the latest message.
    expect(r.messages[hi + 1].content).toContain("[Length:");
    expect(r.breakdown.items.some((i) => i.kind === "emotion")).toBe(true);
  });

  it("can hide desire from the model", () => {
    const s = { ...initialState(), v: { ...initialState().v, desire: 80, anger: 40 }, label: "burning with desire" };
    expect(describeForPrompt(s)).toContain("desire 80/100");
    const hidden = describeForPrompt(s, { hideDesire: true });
    expect(hidden).not.toMatch(/desire|aroused|flirty/);
    expect(hidden).toContain("anger 40/100");
  });

  it("leaves it out when impersonating", () => {
    const r = buildPrompt(base({ emotion: describeForPrompt(initialState()), mode: "impersonate" }));
    expect(r.messages.some((m) => m.content.includes("emotional state"))).toBe(false);
  });

  it("finds the latest stored state on a path", () => {
    const s = initialState();
    const path = [
      { role: "assistant", emotion: s },
      { role: "user", emotion: null },
      { role: "assistant", emotion: null },
    ];
    expect(latestEmotion(path)).toBe(s);
    expect(latestEmotion(path, 0)).toBeNull();
  });
});
