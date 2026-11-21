import { b64decodeUtf8, isPng, readTextChunks } from "@/lib/cards/png";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ParsedCharacter {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  alternateGreetings: string[];
  exampleDialogue: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  creator: string;
  characterVersion: string;
  tags: string[];
  extensions: Record<string, unknown>;
}

export interface ParsedLoreEntry {
  comment: string;
  keys: string[];
  secondaryKeys: string[];
  selectiveLogic: "and_any" | "and_all" | "not_any" | "not_all";
  content: string;
  constant: boolean;
  position: "before_char" | "after_char" | "at_depth";
  depth: number;
  order: number;
  probability: number;
  caseSensitive: boolean;
  wholeWord: boolean;
  enabled: boolean;
}

export interface ParsedBook {
  name: string;
  description: string;
  scanDepth: number;
  tokenBudget: number;
  recursive: boolean;
  entries: ParsedLoreEntry[];
}

export interface ParsedCard {
  character: ParsedCharacter;
  book: ParsedBook | null;
  spec: "v1" | "v2" | "v3";
}

const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(s).filter((x) => x.trim()) : typeof v === "string" && v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

/** Card text uses {{char}}/{{user}}; older cards use <BOT>/<USER>. */
function norm(t: string) {
  return t.replace(/<BOT>/gi, "{{char}}").replace(/<USER>/gi, "{{user}}").replace(/\r\n/g, "\n");
}

export function parseBook(b: any): ParsedBook | null {
  if (!b || !Array.isArray(b.entries) || !b.entries.length) return null;
  return {
    name: s(b.name) || "Imported lorebook",
    description: s(b.description),
    scanDepth: Number(b.scan_depth) || 6,
    tokenBudget: Number(b.token_budget) || 1024,
    recursive: !!b.recursive_scanning,
    entries: b.entries.map((e: any, i: number) => {
      const ext = e.extensions ?? {};
      const pos = e.position === "before_char" ? "before_char" : ext.position === 4 || ext.position === "at_depth" ? "at_depth" : "after_char";
      const logicMap: Record<number, ParsedLoreEntry["selectiveLogic"]> = { 0: "and_any", 1: "not_all", 2: "not_any", 3: "and_all" };
      return {
        comment: s(e.comment || e.name),
        keys: arr(e.keys ?? e.key),
        secondaryKeys: arr(e.secondary_keys ?? e.keysecondary),
        selectiveLogic: logicMap[Number(ext.selectiveLogic ?? 0)] ?? "and_any",
        content: norm(s(e.content)),
        constant: !!e.constant,
        position: pos,
        depth: Number(ext.depth ?? 4) || 4,
        order: Number(e.insertion_order ?? e.priority ?? 100 - i) || 100,
        probability: ext.useProbability === false ? 100 : Number(ext.probability ?? 100),
        caseSensitive: !!e.case_sensitive,
        wholeWord: ext.match_whole_words !== false,
        enabled: e.enabled !== false,
      } satisfies ParsedLoreEntry;
    }),
  };
}

export function parseCardJson(json: any): ParsedCard {
  const spec = json?.spec === "chara_card_v3" ? "v3" : json?.spec === "chara_card_v2" ? "v2" : "v1";
  const d = spec === "v1" ? json : (json.data ?? {});
  if (!s(d.name) && !s(json.char_name)) throw new Error("This doesn't look like a character card (no name).");
  const character: ParsedCharacter = {
    name: s(d.name || json.char_name).trim(),
    description: norm(s(d.description ?? json.char_persona)),
    personality: norm(s(d.personality)),
    scenario: norm(s(d.scenario ?? json.world_scenario)),
    firstMessage: norm(s(d.first_mes ?? json.char_greeting)),
    alternateGreetings: arr(d.alternate_greetings).map(norm),
    exampleDialogue: norm(s(d.mes_example ?? json.example_dialogue)),
    systemPrompt: norm(s(d.system_prompt)),
    postHistoryInstructions: norm(s(d.post_history_instructions)),
    creatorNotes: s(d.creator_notes),
    creator: s(d.creator),
    characterVersion: s(d.character_version),
    tags: arr(d.tags),
    extensions: { ...(d.extensions ?? {}), ...(spec === "v3" ? { _v3: { nickname: d.nickname, source: d.source, group_only_greetings: d.group_only_greetings, assets: d.assets } } : {}) },
  };
  return { character, book: parseBook(d.character_book), spec };
}

export function parseCardFile(buf: Uint8Array, filename = ""): ParsedCard {
  if (isPng(buf)) {
    const text = readTextChunks(buf);
    const raw = text.ccv3 ?? text.chara;
    if (!raw) throw new Error(`${filename || "PNG"} has no embedded character data.`);
    return parseCardJson(JSON.parse(b64decodeUtf8(raw)));
  }
  const str = new TextDecoder().decode(buf);
  return parseCardJson(JSON.parse(str));
}

export interface ExportCharacter extends ParsedCharacter {
  createdAt?: Date;
  updatedAt?: Date;
}

export function toCardV3(c: ExportCharacter, book?: ParsedBook | null) {
  const ext = { ...c.extensions };
  const v3extra = (ext._v3 ?? {}) as Record<string, unknown>;
  delete ext._v3;
  const character_book = book
    ? {
        name: book.name,
        description: book.description,
        scan_depth: book.scanDepth,
        token_budget: book.tokenBudget,
        recursive_scanning: book.recursive,
        extensions: {},
        entries: book.entries.map((e, i) => ({
          keys: e.keys,
          secondary_keys: e.secondaryKeys,
          content: e.content,
          comment: e.comment,
          name: e.comment,
          enabled: e.enabled,
          insertion_order: e.order,
          case_sensitive: e.caseSensitive,
          constant: e.constant,
          selective: e.secondaryKeys.length > 0,
          position: e.position === "before_char" ? "before_char" : "after_char",
          id: i,
          use_regex: e.keys.some((k) => /^\/.+\/[a-z]*$/.test(k)),
          extensions: {
            depth: e.depth,
            probability: e.probability,
            useProbability: e.probability < 100,
            match_whole_words: e.wholeWord,
            selectiveLogic: { and_any: 0, not_all: 1, not_any: 2, and_all: 3 }[e.selectiveLogic],
            position: e.position === "at_depth" ? 4 : e.position === "before_char" ? 0 : 1,
          },
        })),
      }
    : undefined;
  const data = {
    name: c.name,
    description: c.description,
    personality: c.personality,
    scenario: c.scenario,
    first_mes: c.firstMessage,
    mes_example: c.exampleDialogue,
    creator_notes: c.creatorNotes,
    system_prompt: c.systemPrompt,
    post_history_instructions: c.postHistoryInstructions,
    alternate_greetings: c.alternateGreetings,
    tags: c.tags,
    creator: c.creator,
    character_version: c.characterVersion,
    extensions: ext,
    ...(character_book ? { character_book } : {}),
  };
  return {
    v3: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        ...data,
        group_only_greetings: (v3extra.group_only_greetings as string[]) ?? [],
        nickname: v3extra.nickname ?? undefined,
        source: v3extra.source ?? undefined,
        assets: v3extra.assets ?? [{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" }],
        creation_date: c.createdAt ? Math.floor(c.createdAt.getTime() / 1000) : undefined,
        modification_date: c.updatedAt ? Math.floor(c.updatedAt.getTime() / 1000) : undefined,
      },
    },
    v2: { spec: "chara_card_v2", spec_version: "2.0", data },
  };
}
