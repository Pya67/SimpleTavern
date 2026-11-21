import { describe, expect, it } from "vitest";
import { answerBudget, THINKING_BUDGET, toCallSettings } from "@/lib/llm/params";
import { buildPrompt } from "@/lib/prompt/builder";
import { DEFAULT_TEMPLATE_BLOCKS } from "@/lib/defaults";
import type { ModelInfo } from "@/lib/llm/models";

const model = (p: Partial<ModelInfo> = {}): ModelInfo => ({
  id: "x/y",
  name: "Y",
  description: "",
  contextLength: 32000,
  promptPrice: 0,
  completionPrice: 0,
  supportedParams: ["max_tokens", "reasoning", "temperature"],
  reasoning: true,
  maxCompletion: null,
  ...p,
});

describe("toCallSettings token budget", () => {
  it("adds a thinking budget on top of the reply budget for reasoning models", () => {
    const { settings } = toCallSettings({ maxTokens: 600 }, model());
    expect(settings.maxOutputTokens).toBe(600 + THINKING_BUDGET.medium);
  });

  it("scales the thinking budget with effort and respects an explicit reasoning max", () => {
    expect(toCallSettings({ maxTokens: 600, reasoning: { enabled: true, effort: "high" } }, model()).settings.maxOutputTokens).toBe(600 + THINKING_BUDGET.high);
    expect(toCallSettings({ maxTokens: 600, reasoning: { enabled: true, maxTokens: 1000 } }, model()).settings.maxOutputTokens).toBe(1600);
  });

  it("sends effort none and no thinking budget when reasoning is turned off", () => {
    const r = toCallSettings({ maxTokens: 600, reasoning: { enabled: false, effort: "none" } }, model());
    expect(r.settings.maxOutputTokens).toBe(600);
    expect(r.providerOptions.openrouter.reasoning).toEqual({ effort: "none" });
  });

  it("leaves non-reasoning models alone and clamps to the model's max completion", () => {
    expect(toCallSettings({ maxTokens: 600 }, model({ reasoning: false })).settings.maxOutputTokens).toBe(600);
    expect(toCallSettings({ maxTokens: 600 }, model({ maxCompletion: 2000 })).settings.maxOutputTokens).toBe(2000);
  });

  it("raises the reply budget to fit a target word count", () => {
    expect(answerBudget({ maxTokens: 300, targetWords: 500 })).toBeGreaterThanOrEqual(800);
    expect(answerBudget({ maxTokens: 2000, targetWords: 100 })).toBe(2000);
  });
});

describe("target word count instruction", () => {
  const input = {
    blocks: DEFAULT_TEMPLATE_BLOCKS,
    character: { name: "Mira", description: "", personality: "", scenario: "", exampleDialogue: "", systemPrompt: "", postHistoryInstructions: "" },
    persona: { id: "p1", name: "Traveler", description: "" },
    personaNames: { p1: "Traveler" },
    history: [
      { id: "a", role: "assistant" as const, content: "Hello.", personaId: null },
      { id: "b", role: "user" as const, content: "Hi!", personaId: "p1" },
    ],
    memory: [],
    coveredIds: new Set<string>(),
    facts: [],
    contextSize: 8192,
    maxTokens: 500,
    countTokens: (s: string) => Math.ceil(s.length / 4),
  };

  it("adds a length note after the last message when replying", () => {
    const r = buildPrompt({ ...input, mode: "reply", targetWords: 250 });
    const idx = r.messages.findIndex((m) => m.content.includes("about 250 words"));
    expect(idx).toBeGreaterThan(r.messages.findIndex((m) => m.content === "Hi!"));
  });

  it("does not add it for impersonation or when unset", () => {
    expect(JSON.stringify(buildPrompt({ ...input, mode: "impersonate", targetWords: 250 }).messages)).not.toContain("about 250 words");
    expect(JSON.stringify(buildPrompt({ ...input, mode: "reply" }).messages)).not.toContain("[Length:");
  });
});
