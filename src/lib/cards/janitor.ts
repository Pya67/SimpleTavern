import "server-only";
import type { ParsedBook, ParsedCharacter, ParsedLoreEntry } from "@/lib/cards/card";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Import from JanitorAI. JanitorAI doesn't let other servers fetch characters (Cloudflare turns them
 * away), so the "Send to SimpleTavern" userscript (public/simple-tavern-janitor.user.js) reads the
 * character in the user's own browser and hands us the JSON their site uses. That JSON has the
 * listing plus — only when the creator allows it ("showdefinition") — the definition fields.
 */
const AVATARS = "https://ella.janitorai.com/bot-avatars/";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FIELD = 200_000;

export interface JanitorImport {
  character: ParsedCharacter;
  tagline: string;
  avatarUrl: string | null;
  /** The creator hid the definition: only name, picture, tags and bio could be imported. */
  definitionHidden: boolean;
  /** Lorebooks attached to the character on JanitorAI, as fetched by the userscript. */
  lorebooks: JanitorLorebookImport[];
  /** Attached lorebooks that couldn't be imported (private entries, couldn't be read). */
  skippedLorebooks: { title: string; reason: string }[];
}

export interface JanitorLorebookImport {
  book: ParsedBook;
  /** Canonical JanitorAI URL; stored as the lorebook's source so re-imports reuse it. */
  source: string;
}

/** Validates JanitorAI character JSON (as sent by the userscript) and maps it onto our fields. */
export function parseJanitorData(j: any): JanitorImport {
  if (!j || typeof j !== "object" || typeof j.id !== "string" || !UUID.test(j.id) || !str(j.name)) throw new Error("That isn't JanitorAI character data.");
  if (j.is_deleted || j.is_force_remove) throw new Error("This character was removed from JanitorAI.");
  const out = toImport(j, j.id.toLowerCase());
  // The userscript attaches each lorebook it could read as `lorebooks`, and the ones it couldn't as `lorebook_errors`.
  for (const raw of Array.isArray(j.lorebooks) ? j.lorebooks.slice(0, MAX_BOOKS) : []) {
    try {
      out.lorebooks.push(parseJanitorLorebook(raw));
    } catch (e) {
      out.skippedLorebooks.push({ title: str(raw?.title) || "A lorebook", reason: (e as Error).message });
    }
  }
  for (const e of Array.isArray(j.lorebook_errors) ? j.lorebook_errors.slice(0, MAX_BOOKS) : []) {
    out.skippedLorebooks.push({ title: str(e?.title) || "A lorebook", reason: str(e?.reason) || "It couldn't be read." });
  }
  return out;
}

const MAX_BOOKS = 20;
const MAX_ENTRIES = 2000;

/**
 * Validates a JanitorAI lorebook ("script" of type lorebook, from /hampter/script/<id>) and maps it
 * onto our lorebook fields. Its entries are a JSON string in `script`, close to SillyTavern's format.
 */
export function parseJanitorLorebook(j: any): JanitorLorebookImport {
  if (!j || typeof j !== "object" || typeof j.id !== "string" || !UUID.test(j.id)) throw new Error("That isn't JanitorAI lorebook data.");
  if (j.type && j.type !== "lorebook") throw new Error("That JanitorAI script is code, not a lorebook. Only lorebooks can be imported.");
  let raw: unknown = j.script;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error("The lorebook's entries couldn't be read.");
    }
  }
  if (!Array.isArray(raw)) {
    throw new Error(j.is_code_public === false ? "The creator keeps this lorebook's entries private." : "This lorebook has no entries JanitorAI would share.");
  }
  const entries = raw.slice(0, MAX_ENTRIES).map(toLoreEntry).filter((e): e is ParsedLoreEntry => !!e);
  let depth = Number(j.depth);
  if (!depth && typeof j.settings === "string") {
    try {
      depth = Number(JSON.parse(j.settings)?.depth);
    } catch {}
  }
  const id = j.id.toLowerCase();
  const source = `https://janitorai.com/scripts/${id}`;
  return {
    source,
    book: {
      name: str(j.title).slice(0, 200) || "JanitorAI lorebook",
      description: [htmlToText(str(j.description)), `Imported from JanitorAI: ${source}`].filter(Boolean).join("\n\n"),
      scanDepth: depth > 0 && depth <= 100 ? Math.round(depth) : 6,
      tokenBudget: 1024,
      recursive: false,
      entries,
    },
  };
}

const LOGIC: Record<number, ParsedLoreEntry["selectiveLogic"]> = { 0: "and_any", 1: "not_all", 2: "not_any", 3: "and_all" };

function toLoreEntry(e: any, i: number): ParsedLoreEntry | null {
  if (!e || typeof e !== "object") return null;
  const content = str(e.content);
  if (!content) return null;
  const keys = (v: unknown, rawList: unknown) => {
    const list = Array.isArray(v) && v.length ? v.map(str) : str(rawList).split(",").map((k) => k.trim());
    return [...new Set(list.filter(Boolean))].slice(0, 200);
  };
  const mode = str(e.activationMode).toLowerCase();
  const placement = str(e.placement).toLowerCase();
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : fallback);
  return {
    comment: (str(e.name) || str(e.comment)).slice(0, 200),
    keys: keys(e.key ?? e.keys, e.keysRaw ?? e.keywordsRaw),
    secondaryKeys: keys(e.keysecondary ?? e.secondary_keys, e.keysecondaryRaw),
    selectiveLogic: LOGIC[num(e.selectiveLogic, 0)] ?? "and_any",
    content,
    constant: e.constant === true || mode === "constant" || mode === "always",
    position: placement.includes("depth") ? "at_depth" : str(e.placementPosition).toLowerCase() === "before" ? "before_char" : "after_char",
    depth: Math.max(0, Math.round(num(e.depth, 4))),
    order: Math.round(num(e.insertion_order ?? e.priority, 100 - i)),
    probability: Math.min(100, Math.max(0, Math.round(num(e.probability, 100)))),
    caseSensitive: e.case_sensitive === true,
    wholeWord: e.matchWholeWords !== false,
    enabled: e.enabled !== false && mode !== "disabled",
  };
}

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, MAX_FIELD) : "");

function toImport(j: any, id: string): JanitorImport {
  // Greetings: "first_message" plus a "first_messages" list, which can contain empty (null) slots.
  const greetings: string[] = [];
  for (const g of [j.first_message, ...(Array.isArray(j.first_messages) ? j.first_messages : [])].map(str)) if (g && !greetings.includes(g)) greetings.push(g);
  const [firstMessage = "", ...alternateGreetings] = greetings;
  const personality = str(j.personality);
  const definitionHidden = j.showdefinition === false || !personality;

  const title = str(j.name);
  // "chat_name" is what the character is called in chat; "name" is the listing title.
  const name = str(j.chat_name) || title;
  const bio = htmlToText(str(j.description));

  const seen = new Set<string>();
  const tags = [...(Array.isArray(j.tags) ? j.tags.map((t: any) => str(t?.name)) : []), ...(Array.isArray(j.custom_tags) ? j.custom_tags.map(str) : [])]
    // Their category tags lead with an emoji ("👩‍🦰 Female").
    .map((t: string) => t.replace(/^[^\p{L}\p{N}]+/u, "").trim())
    .filter((t: string) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));

  const link = `https://janitorai.com/characters/${id}`;
  return {
    character: {
      name,
      // JanitorAI keeps the whole definition in "personality"; it's what other apps call the description.
      description: personality,
      personality: "",
      scenario: str(j.scenario),
      firstMessage,
      alternateGreetings,
      exampleDialogue: str(j.example_dialogs),
      systemPrompt: "",
      postHistoryInstructions: "",
      creatorNotes: [bio, `Imported from JanitorAI: ${link}`].filter(Boolean).join("\n\n"),
      creator: str(j.creator_name),
      characterVersion: "",
      tags,
      extensions: { janitorai: { id, url: link, title, definitionHidden } },
    },
    tagline: (title && title !== name ? title : bio.split("\n").find((l) => l.trim()) ?? "").slice(0, 140),
    avatarUrl: str(j.avatar) && !/[/?#]/.test(str(j.avatar)) ? AVATARS + encodeURIComponent(str(j.avatar)) : null,
    definitionHidden,
    lorebooks: [],
    skippedLorebooks: [],
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Creator bios are rich-text HTML; keep the words and paragraph breaks, drop the styling. */
function htmlToText(html: string) {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
