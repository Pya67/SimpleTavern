import type { LoreSelectiveLogic } from "@/lib/types";

export interface LoreEntryInput {
  id: string;
  lorebookId: string;
  comment: string;
  keys: string[];
  secondaryKeys: string[];
  selectiveLogic: LoreSelectiveLogic;
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

export interface LoreBookInput {
  id: string;
  scanDepth: number;
  tokenBudget: number;
  recursive: boolean;
}

export interface FiredLore {
  entry: LoreEntryInput;
  reason: string;
  matchedKeys: string[];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Supports plain keys and `/regex/flags` keys. */
export function keyMatches(text: string, key: string, caseSensitive: boolean, wholeWord: boolean) {
  const k = key.trim();
  if (!k) return false;
  const re = k.match(/^\/(.+)\/([gimsuy]*)$/);
  if (re) {
    try {
      return new RegExp(re[1], re[2]).test(text);
    } catch {
      return false;
    }
  }
  const flags = caseSensitive ? "u" : "iu";
  const body = escapeRe(k);
  const pattern = wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
  return new RegExp(pattern, flags).test(text);
}

function secondaryPass(entry: LoreEntryInput, text: string) {
  const sec = entry.secondaryKeys.filter((k) => k.trim());
  if (!sec.length) return { ok: true, matched: [] as string[] };
  const hits = sec.filter((k) => keyMatches(text, k, entry.caseSensitive, entry.wholeWord));
  switch (entry.selectiveLogic) {
    case "and_any":
      return { ok: hits.length > 0, matched: hits };
    case "and_all":
      return { ok: hits.length === sec.length, matched: hits };
    case "not_any":
      return { ok: hits.length === 0, matched: [] };
    case "not_all":
      return { ok: hits.length < sec.length, matched: hits };
  }
}

export function scanLore(opts: {
  books: LoreBookInput[];
  entries: LoreEntryInput[];
  /** Messages newest-last. */
  history: string[];
  countTokens: (s: string) => number;
  random?: () => number;
  maxRecursion?: number;
}): FiredLore[] {
  const rnd = opts.random ?? Math.random;
  const fired: FiredLore[] = [];
  const firedIds = new Set<string>();

  for (const book of opts.books) {
    const entries = opts.entries.filter((e) => e.lorebookId === book.id && e.enabled && e.content.trim());
    const scanText = opts.history.slice(-Math.max(1, book.scanDepth)).join("\n");
    const bookFired: FiredLore[] = [];

    const tryEntry = (e: LoreEntryInput, text: string, recursive: boolean) => {
      if (firedIds.has(e.id)) return;
      let reason = "";
      let matched: string[] = [];
      if (e.constant) {
        reason = "constant";
      } else {
        matched = e.keys.filter((k) => keyMatches(text, k, e.caseSensitive, e.wholeWord));
        if (!matched.length) return;
        const sec = secondaryPass(e, text);
        if (!sec.ok) return;
        matched = [...matched, ...sec.matched];
        reason = `${recursive ? "recursive match" : "matched"}: ${matched.join(", ")}`;
      }
      if (e.probability < 100 && rnd() * 100 >= e.probability) return;
      firedIds.add(e.id);
      bookFired.push({ entry: e, reason, matchedKeys: matched });
    };

    for (const e of entries) tryEntry(e, scanText, false);

    if (book.recursive) {
      const depth = opts.maxRecursion ?? 3;
      for (let i = 0; i < depth; i++) {
        const before = bookFired.length;
        const recText = bookFired.map((f) => f.entry.content).join("\n");
        for (const e of entries) if (!e.constant) tryEntry(e, recText, true);
        if (bookFired.length === before) break;
      }
    }

    // Budget: highest order first; constant entries are prioritized.
    bookFired.sort((a, b) => Number(b.entry.constant) - Number(a.entry.constant) || b.entry.order - a.entry.order);
    let used = 0;
    for (const f of bookFired) {
      const t = opts.countTokens(f.entry.content);
      if (used + t > book.tokenBudget) {
        firedIds.delete(f.entry.id);
        continue;
      }
      used += t;
      fired.push(f);
    }
  }
  return fired;
}
