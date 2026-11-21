import { describe, expect, it } from "vitest";
import { parseJanitorData, parseJanitorLorebook } from "@/lib/cards/janitor";

const BOOK_ID = "2722d3b0-0b52-40b0-9741-55a7788ee7ae";
// Shape of JanitorAI's /hampter/script/<id> response (trimmed).
const entry = {
  activationMode: "standard",
  case_sensitive: true,
  comment: "",
  constant: false,
  content: "Devils are a race of supernatural entities.",
  enabled: true,
  insertion_order: 100,
  key: ["Devil", "Fiend"],
  keysRaw: "Devil, Fiend",
  keysecondary: [],
  matchWholeWords: true,
  name: "Devil",
  probability: 80,
  selectiveLogic: 0,
  placement: "default",
  placementPosition: "after",
};
const script = {
  type: "lorebook",
  id: BOOK_ID,
  title: "Chainsaw Man || Terminology Lorebook ||",
  description: "All about <b>CSM</b>.",
  depth: null,
  settings: '{"depth":3}',
  is_code_public: true,
  script: JSON.stringify([entry, { ...entry, name: "Pre", key: [], keysRaw: "Hell, Fear", placementPosition: "before", enabled: false }, { content: "" }]),
};

describe("parseJanitorLorebook", () => {
  it("maps entries and settings", () => {
    const { book, source } = parseJanitorLorebook(script);
    expect(source).toBe(`https://janitorai.com/scripts/${BOOK_ID}`);
    expect(book.name).toBe(script.title);
    expect(book.scanDepth).toBe(3);
    expect(book.description).toContain("All about CSM.");
    expect(book.entries).toHaveLength(2);
    expect(book.entries[0]).toMatchObject({ comment: "Devil", keys: ["Devil", "Fiend"], probability: 80, caseSensitive: true, wholeWord: true, position: "after_char", order: 100, enabled: true });
    expect(book.entries[1]).toMatchObject({ keys: ["Hell", "Fear"], position: "before_char", enabled: false });
  });

  it("accepts entries already parsed (as the userscript sends them)", () => {
    expect(parseJanitorLorebook({ ...script, script: [entry] }).book.entries).toHaveLength(1);
  });

  it("rejects code scripts and private lorebooks", () => {
    expect(() => parseJanitorLorebook({ ...script, type: "advanced" })).toThrow(/code, not a lorebook/);
    expect(() => parseJanitorLorebook({ ...script, script: null, is_code_public: false })).toThrow(/private/);
  });
});

describe("parseJanitorData with lorebooks", () => {
  it("parses attached lorebooks and keeps the ones that failed", () => {
    const r = parseJanitorData({
      id: "00c44cfe-bec5-44b1-8e0f-ace9b4c1aa8e",
      name: "Fami",
      personality: "A girl.",
      lorebooks: [script, { ...script, id: "not-a-uuid" }],
      lorebook_errors: [{ title: "Secret", reason: "The creator keeps this lorebook's entries private." }],
    });
    expect(r.lorebooks).toHaveLength(1);
    expect(r.skippedLorebooks.map((s) => s.title)).toEqual([script.title, "Secret"]);
  });
});
