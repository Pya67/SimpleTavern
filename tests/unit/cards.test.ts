import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { parseCardFile, parseCardJson, toCardV3 } from "@/lib/cards/card";
import { b64encodeUtf8, readTextChunks, writeTextChunks } from "@/lib/cards/png";

const character = {
  name: "Mira",
  description: "An innkeeper. <BOT> likes <USER>.",
  personality: "witty",
  scenario: "storm",
  firstMessage: "Hi",
  alternateGreetings: ["Hello again"],
  exampleDialogue: "",
  systemPrompt: "",
  postHistoryInstructions: "",
  creatorNotes: "notes",
  creator: "me",
  characterVersion: "1",
  tags: ["fantasy"],
  extensions: {},
};

describe("character cards", () => {
  it("normalizes legacy placeholders and V1 fields", () => {
    const p = parseCardJson({ name: "Old", description: "<BOT> and <USER>", first_mes: "hey" });
    expect(p.spec).toBe("v1");
    expect(p.character.description).toBe("{{char}} and {{user}}");
  });

  it("round-trips V3 with an embedded lorebook through PNG tEXt chunks", async () => {
    const book = {
      name: "Lore",
      description: "",
      scanDepth: 4,
      tokenBudget: 500,
      recursive: true,
      entries: [
        {
          comment: "Mill",
          keys: ["mill"],
          secondaryKeys: [],
          selectiveLogic: "and_any" as const,
          content: "The mill burned.",
          constant: false,
          position: "at_depth" as const,
          depth: 2,
          order: 50,
          probability: 100,
          caseSensitive: false,
          wholeWord: true,
          enabled: true,
        },
      ],
    };
    const cards = toCardV3(character, book);
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#f00" } }).png().toBuffer();
    const out = writeTextChunks(new Uint8Array(png), { chara: b64encodeUtf8(JSON.stringify(cards.v2)), ccv3: b64encodeUtf8(JSON.stringify(cards.v3)) });
    expect(Object.keys(readTextChunks(out)).sort()).toEqual(["ccv3", "chara"]);
    expect((await sharp(Buffer.from(out)).metadata()).width).toBe(8);
    const parsed = parseCardFile(out);
    expect(parsed.spec).toBe("v3");
    expect(parsed.character.name).toBe("Mira");
    expect(parsed.character.description).toBe("An innkeeper. {{char}} likes {{user}}.");
    expect(parsed.character.alternateGreetings).toEqual(["Hello again"]);
    expect(parsed.book?.entries[0]).toMatchObject({ keys: ["mill"], position: "at_depth", depth: 2, order: 50 });
  });

  it("rejects PNGs without card data", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).png().toBuffer();
    expect(() => parseCardFile(new Uint8Array(png), "x.png")).toThrow(/no embedded character data/);
  });
});
