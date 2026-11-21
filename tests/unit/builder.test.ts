import { describe, expect, it } from "vitest";
import { buildPrompt, type BuildInput, type HistoryMessage } from "@/lib/prompt/builder";
import { DEFAULT_TEMPLATE_BLOCKS } from "@/lib/defaults";

const ct = (s: string) => Math.ceil(s.length / 4);
const msg = (i: number, role: HistoryMessage["role"], content: string, personaId: string | null = "p1"): HistoryMessage => ({
  id: `m${i}`,
  role,
  content,
  personaId: role === "user" ? personaId : null,
});

function base(p: Partial<BuildInput> = {}): BuildInput {
  return {
    blocks: DEFAULT_TEMPLATE_BLOCKS,
    character: { name: "Mira", description: "An innkeeper.", personality: "witty", scenario: "A storm.", exampleDialogue: "", systemPrompt: "", postHistoryInstructions: "" },
    persona: { id: "p1", name: "Traveler", description: "A wanderer." },
    personaNames: { p1: "Traveler", p2: "Vale" },
    history: [msg(0, "assistant", "Hello there."), msg(1, "user", "Hi!"), msg(2, "assistant", "Welcome.")],
    memory: [],
    coveredIds: new Set(),
    facts: [],
    contextSize: 8192,
    maxTokens: 500,
    mode: "reply",
    countTokens: ct,
    ...p,
  };
}

describe("buildPrompt", () => {
  it("merges leading system blocks and resolves macros", () => {
    const r = buildPrompt(base());
    expect(r.messages[0].role).toBe("system");
    expect(r.messages[0].content).toContain("You are Mira");
    expect(r.messages[0].content).toContain('<user_persona name="Traveler">');
    expect(r.messages[0].content).toContain("A wanderer.");
    expect(r.messages.filter((m) => m.role !== "system").map((m) => m.content)).toEqual(["Hello there.", "Hi!", "Welcome."]);
  });

  it("labels user turns when several personas spoke", () => {
    const r = buildPrompt(base({ history: [msg(0, "user", "One", "p1"), msg(1, "assistant", "ok"), msg(2, "user", "Two", "p2")] }));
    const users = r.messages.filter((m) => m.role === "user").map((m) => m.content);
    expect(users).toEqual(["Traveler: One", "Vale: Two"]);
  });

  it("drops oldest history beyond the budget and reports it", () => {
    const history = Array.from({ length: 200 }, (_, i) => msg(i, i % 2 ? "user" : "assistant", "word ".repeat(40)));
    const r = buildPrompt(base({ history, contextSize: 2048, maxTokens: 256 }));
    expect(r.breakdown.historyDropped).toBeGreaterThan(0);
    expect(r.breakdown.total).toBeLessThanOrEqual(r.breakdown.budget);
  });

  it("replaces covered messages with memory", () => {
    const r = buildPrompt(base({ memory: [{ id: "c", content: "They met in a storm." }], coveredIds: new Set(["m0", "m1"]) }));
    expect(r.messages[0].content).toContain("They met in a storm.");
    expect(r.messages.some((m) => m.content === "Hi!")).toBe(false);
    expect(r.breakdown.compactedCovered).toBe(2);
  });

  it("injects the author's note at depth", () => {
    const r = buildPrompt(base({ authorsNote: "Keep it tense.", authorsNoteDepth: 1 }));
    const idx = r.messages.findIndex((m) => m.content.includes("Keep it tense."));
    expect(r.messages[idx + 1].content).toBe("Welcome.");
  });

  it("continue mode ends on the assistant message", () => {
    const r = buildPrompt(base({ mode: "continue", character: { ...base().character, postHistoryInstructions: "Be vivid." } }));
    expect(r.messages[r.messages.length - 1]).toEqual({ role: "assistant", content: "Welcome." });
  });

  it("impersonate adds an instruction for the user", () => {
    const r = buildPrompt(base({ mode: "impersonate" }));
    expect(r.messages[r.messages.length - 1].content).toContain("Traveler's next message");
    // The post-history reminder (write as {{char}}) must not contradict the impersonate task.
    expect(r.messages.some((m) => m.content.includes("Write Mira's next reply"))).toBe(false);
  });

  it("ends a normal reply with the post-history reminder", () => {
    const r = buildPrompt(base());
    const last = r.messages[r.messages.length - 1];
    expect(last.role).toBe("system");
    expect(last.content).toContain("Write Mira's next reply to Traveler's last message");
  });

  it("character overrides can include the template text with {{original}}", () => {
    const r = buildPrompt(base({ character: { ...base().character, systemPrompt: "{{original}}\n\nExtra: {{char}} lisps.", postHistoryInstructions: "Short replies." } }));
    expect(r.messages[0].content).toContain("You are Mira.");
    expect(r.messages[0].content).toContain("Extra: Mira lisps.");
    const last = r.messages[r.messages.length - 1];
    expect(last.content).toBe("Short replies.");
  });
});
