import { describe, expect, it } from "vitest";
import { keyMatches, scanLore, type LoreEntryInput } from "@/lib/prompt/lore";

const entry = (p: Partial<LoreEntryInput>): LoreEntryInput => ({
  id: crypto.randomUUID(),
  lorebookId: "b",
  comment: "",
  keys: [],
  secondaryKeys: [],
  selectiveLogic: "and_any",
  content: "content",
  constant: false,
  position: "after_char",
  depth: 4,
  order: 100,
  probability: 100,
  caseSensitive: false,
  wholeWord: true,
  enabled: true,
  ...p,
});
const book = { id: "b", scanDepth: 2, tokenBudget: 1000, recursive: false };
const ct = (s: string) => Math.ceil(s.length / 4);

describe("keyMatches", () => {
  it("matches whole words only by default", () => {
    expect(keyMatches("the old mill", "mill", false, true)).toBe(true);
    expect(keyMatches("the miller", "mill", false, true)).toBe(false);
    expect(keyMatches("the miller", "mill", false, false)).toBe(true);
  });
  it("supports regex keys", () => {
    expect(keyMatches("Dragon!", "/drag(on|oon)/i", false, true)).toBe(true);
  });
});

describe("scanLore", () => {
  it("fires on keywords within scan depth only", () => {
    const e = entry({ keys: ["mill"] });
    expect(scanLore({ books: [book], entries: [e], history: ["mill", "x", "y"], countTokens: ct })).toHaveLength(0);
    expect(scanLore({ books: [book], entries: [e], history: ["x", "the mill"], countTokens: ct })).toHaveLength(1);
  });
  it("respects secondary logic", () => {
    const e = entry({ keys: ["mill"], secondaryKeys: ["fire"], selectiveLogic: "and_any" });
    expect(scanLore({ books: [book], entries: [e], history: ["the mill"], countTokens: ct })).toHaveLength(0);
    expect(scanLore({ books: [book], entries: [e], history: ["the mill fire"], countTokens: ct })).toHaveLength(1);
    const n = entry({ keys: ["mill"], secondaryKeys: ["fire"], selectiveLogic: "not_any" });
    expect(scanLore({ books: [book], entries: [n], history: ["the mill fire"], countTokens: ct })).toHaveLength(0);
  });
  it("always includes constant entries and respects the budget by priority", () => {
    const a = entry({ constant: true, content: "x".repeat(40) });
    const b = entry({ keys: ["mill"], content: "y".repeat(40), order: 1 });
    const c = entry({ keys: ["mill"], content: "z".repeat(40), order: 50 });
    const fired = scanLore({ books: [{ ...book, tokenBudget: 20 }], entries: [a, b, c], history: ["mill"], countTokens: ct });
    expect(fired.map((f) => f.entry.id)).toEqual([a.id, c.id]);
  });
  it("recurses when enabled", () => {
    const a = entry({ keys: ["mill"], content: "The mill belongs to Orlan." });
    const b = entry({ keys: ["Orlan"], content: "Orlan is a miller." });
    expect(scanLore({ books: [book], entries: [a, b], history: ["mill"], countTokens: ct })).toHaveLength(1);
    expect(scanLore({ books: [{ ...book, recursive: true }], entries: [a, b], history: ["mill"], countTokens: ct })).toHaveLength(2);
  });
});
