import { describe, expect, it } from "vitest";
import { KAOMOJI_GROUPS } from "@/lib/kaomoji";
import {
  APPRAISAL_PROMPT,
  DEFAULT_ENGINE,
  MOOD_KAOMOJIS,
  cleanKaomoji,
  EMOTIONS,
  NEUTRAL_BASELINE,
  describeForPrompt,
  initialState,
  latestEmotion,
  normalizeState,
  parseAppraisal,
  parseBaseline,
  step,
  type Appraisal,
} from "@/lib/emotion/engine";
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

  it("lists every mood face by number in the appraisal prompt", () => {
    for (const [i, k] of MOOD_KAOMOJIS.entries()) expect(APPRAISAL_PROMPT).toContain(`${i + 1} ${k}`);
  });
});

describe("parsing model replies", () => {
  it("reads fenced JSON with trailing commas and string numbers", () => {
    const a = parseAppraisal('Sure!\n```json\n{"impulse":{"joy":"12","anger":-5,},"affection":3,"label":"Pleased","kaomoji":"2","note":"Glad they came back."}\n```');
    expect(a).toEqual({ impulse: { joy: 12, anger: -5 }, affection: 3, label: "pleased", kaomoji: MOOD_KAOMOJIS[1], note: "Glad they came back." });
  });

  it("accepts flat emotion keys", () => {
    expect(parseAppraisal('{"fear": 20, "label": "spooked"}')?.impulse).toEqual({ fear: 20 });
  });

  it("returns null for junk", () => {
    expect(parseAppraisal("I can't do that.")).toBeNull();
    expect(parseAppraisal("{}")).toBeNull();
  });

  it("parses and caps a baseline", () => {
    const b = parseBaseline('{"joy": 95, "sadness": 30}')!;
    expect(b.joy).toBe(70);
    expect(b.sadness).toBe(30);
    expect(b.trust).toBe(NEUTRAL_BASELINE.trust);
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
