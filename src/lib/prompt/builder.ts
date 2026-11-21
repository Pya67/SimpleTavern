import { applyMacros, type MacroContext } from "@/lib/prompt/macros";
import { scanLore, type FiredLore, type LoreBookInput, type LoreEntryInput } from "@/lib/prompt/lore";
import type { PromptBlock, PromptBreakdown, TokenBreakdownItem } from "@/lib/types";

export type ChatRole = "system" | "user" | "assistant";
export interface OutMessage {
  role: ChatRole;
  content: string;
}

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  personaId: string | null;
  hidden?: boolean;
}

export interface BuildInput {
  blocks: PromptBlock[];
  character: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    exampleDialogue: string;
    systemPrompt: string;
    postHistoryInstructions: string;
  };
  persona: { id?: string | null; name: string; description: string };
  personaNames: Record<string, string>;
  history: HistoryMessage[];
  memory: { id: string; content: string }[];
  coveredIds: Set<string>;
  facts: string[];
  lore?: { books: LoreBookInput[]; entries: LoreEntryInput[] };
  authorsNote?: string;
  authorsNoteDepth?: number;
  contextSize: number;
  maxTokens: number;
  /** Ask for replies of about this many words. */
  targetWords?: number;
  mode: "reply" | "continue" | "impersonate";
  modelId?: string;
  countTokens: (s: string) => number;
  now?: Date;
  lastMessageAt?: Date | null;
  random?: () => number;
}

export interface BuildResult {
  messages: OutMessage[];
  breakdown: PromptBreakdown;
  firedLore: FiredLore[];
  /** Tokens of history not covered by memory (used to trigger compaction). */
  uncoveredHistoryTokens: number;
  historyBudget: number;
}

const IMPERSONATE_INSTRUCTION =
  "[Write {{user}}'s next message, in {{user}}'s voice and from {{user}}'s perspective, matching their established style. Output only {{user}}'s message — do not write for {{char}}.]";

export function buildPrompt(input: BuildInput): BuildResult {
  const ct = input.countTokens;
  const macro: MacroContext = {
    char: input.character.name,
    user: input.persona.name,
    persona: input.persona.description,
    model: input.modelId,
    now: input.now,
    lastMessageAt: input.lastMessageAt,
    random: input.random,
  };
  const m = (s: string) => applyMacros(s ?? "", macro).trim();

  const contextSize = Math.max(1024, input.contextSize);
  const margin = Math.ceil(contextSize * 0.05) + 64;
  const budget = Math.max(256, contextSize - input.maxTokens - margin);

  const visible = input.history.filter((h) => !h.hidden && h.content.trim());

  // Lore scans the recent visible history (plus macros resolved).
  const firedLore = input.lore
    ? scanLore({
        books: input.lore.books,
        entries: input.lore.entries,
        history: visible.map((h) => h.content),
        countTokens: ct,
        random: input.random,
      })
    : [];

  const loreText = (pos: FiredLore["entry"]["position"]) =>
    firedLore
      .filter((f) => f.entry.position === pos)
      .map((f) => m(f.entry.content))
      .join("\n\n");

  const wrap = (block: PromptBlock, content: string) => {
    if (!content.trim()) return "";
    const tpl = block.content?.includes("{{content}}") ? block.content : "{{content}}";
    return m(tpl.replace("{{content}}", content));
  };

  // Multiple personas in history => label user turns with names so the model can follow switches.
  const personaIds = new Set(visible.filter((h) => h.role === "user").map((h) => h.personaId ?? "_"));
  const labelUsers = personaIds.size > 1;

  type Part = { role: ChatRole; content: string; kind: string; label: string } | { kind: "history"; label: string };
  const parts: Part[] = [];
  for (const block of input.blocks) {
    if (!block.enabled) continue;
    const label = block.label ?? block.kind;
    let content = "";
    switch (block.kind) {
      case "main":
        content = m(input.character.systemPrompt?.trim() ? input.character.systemPrompt : (block.content ?? ""));
        break;
      case "char_description":
        content = wrap(block, input.character.description);
        break;
      case "char_personality":
        content = wrap(block, input.character.personality);
        break;
      case "scenario":
        content = wrap(block, input.character.scenario);
        break;
      case "persona":
        content = wrap(block, input.persona.description);
        break;
      case "examples":
        content = wrap(block, input.character.exampleDialogue);
        break;
      case "lore_before":
        content = loreText("before_char");
        break;
      case "lore_after":
        content = loreText("after_char");
        break;
      case "memory":
        content = wrap(block, input.memory.map((c) => c.content.trim()).filter(Boolean).join("\n\n"));
        break;
      case "facts":
        content = wrap(block, input.facts.filter((f) => f.trim()).map((f) => `- ${f.trim()}`).join("\n"));
        break;
      case "post_history":
        content = m(input.character.postHistoryInstructions?.trim() ? input.character.postHistoryInstructions : (block.content ?? ""));
        break;
      case "custom":
        content = m(block.content ?? "");
        break;
      case "history":
        parts.push({ kind: "history", label });
        continue;
    }
    if (content) parts.push({ role: block.role, content, kind: block.kind, label });
  }

  // Fixed (non-history) cost.
  const items: TokenBreakdownItem[] = [];
  let fixed = 0;
  for (const p of parts) {
    if (p.kind === "history") continue;
    const t = ct((p as { content: string }).content) + 4;
    fixed += t;
    items.push({ label: p.label, kind: p.kind, tokens: t });
  }

  const authorsNote = input.authorsNote?.trim() ? m(input.authorsNote) : "";
  const depthLore = firedLore.filter((f) => f.entry.position === "at_depth");
  let injectedCost = authorsNote ? ct(authorsNote) + 8 : 0;
  for (const f of depthLore) injectedCost += ct(f.entry.content) + 4;
  const impersonate = input.mode === "impersonate" ? m(IMPERSONATE_INSTRUCTION) : "";
  if (impersonate) injectedCost += ct(impersonate) + 4;
  const lengthNote = input.targetWords && input.targetWords > 0 && input.mode === "reply" ? `[Length: write about ${Math.round(input.targetWords)} words in this reply.]` : "";
  if (lengthNote) injectedCost += ct(lengthNote) + 4;

  const historyBudget = Math.max(0, budget - fixed - injectedCost);

  // History newest-first until the budget is exhausted. Compacted messages are represented by memory.
  const uncovered = visible.filter((h) => !input.coveredIds.has(h.id));
  const formatted = uncovered.map((h) => {
    let content = m(h.content);
    if (h.role === "user" && labelUsers) {
      const name = (h.personaId && input.personaNames[h.personaId]) || input.persona.name;
      content = `${name}: ${content}`;
    }
    return { role: h.role as ChatRole, content, tokens: ct(content) + 4 };
  });
  const uncoveredHistoryTokens = formatted.reduce((a, b) => a + b.tokens, 0);

  const kept: typeof formatted = [];
  let used = 0;
  for (let i = formatted.length - 1; i >= 0; i--) {
    const f = formatted[i];
    // Always keep the newest message even if it alone exceeds the budget.
    if (used + f.tokens > historyBudget && kept.length > 0) break;
    kept.unshift(f);
    used += f.tokens;
  }
  const dropped = formatted.length - kept.length;

  // Depth injections (0 = after last message).
  const historyOut: OutMessage[] = kept.map(({ role, content }) => ({ role, content }));
  const inject = (depth: number, msg: OutMessage) => {
    const idx = Math.max(0, historyOut.length - Math.max(0, depth));
    historyOut.splice(idx, 0, msg);
  };
  for (const f of depthLore) inject(f.entry.depth, { role: "system", content: m(f.entry.content) });
  if (authorsNote) inject(input.authorsNoteDepth ?? 4, { role: "system", content: `[Author's note: ${authorsNote}]` });
  if (lengthNote) inject(0, { role: "system", content: lengthNote });

  items.push({ label: `Chat history (${kept.length} msgs)`, kind: "history", tokens: used });
  if (authorsNote) items.push({ label: "Author's note", kind: "authors_note", tokens: ct(authorsNote) + 8 });
  if (lengthNote) items.push({ label: "Target length", kind: "length", tokens: ct(lengthNote) + 4 });
  if (depthLore.length) items.push({ label: "Lore (at depth)", kind: "lore_depth", tokens: depthLore.reduce((a, f) => a + ct(f.entry.content) + 4, 0) });

  // Assemble, merging adjacent system parts.
  const out: OutMessage[] = [];
  const push = (msg: OutMessage) => {
    const last = out[out.length - 1];
    if (last && last.role === "system" && msg.role === "system" && !historyStarted) {
      last.content += "\n\n" + msg.content;
    } else out.push({ ...msg });
  };
  let historyStarted = false;
  for (const p of parts) {
    if (p.kind === "history") {
      historyStarted = true;
      for (const h of historyOut) out.push(h);
      historyStarted = true;
      continue;
    }
    const pp = p as { role: ChatRole; content: string };
    if (historyStarted) out.push({ role: pp.role, content: pp.content });
    else push({ role: pp.role, content: pp.content });
  }
  if (impersonate) out.push({ role: "system", content: impersonate });

  if (input.mode === "continue") {
    // Ensure the last message is the assistant message being continued (prefill).
    // Post-history instructions would otherwise sit after it.
    const lastAssistant = [...out].reverse().find((o) => o.role === "assistant");
    if (lastAssistant && out[out.length - 1] !== lastAssistant) {
      const idx = out.lastIndexOf(lastAssistant);
      out.splice(idx, 1);
      out.push(lastAssistant);
    }
  }

  const total = fixed + used + injectedCost;
  return {
    messages: out,
    firedLore,
    uncoveredHistoryTokens,
    historyBudget,
    breakdown: {
      items,
      total,
      budget,
      contextSize,
      historyIncluded: kept.length,
      historyDropped: dropped,
      compactedCovered: visible.length - uncovered.length,
      loreFired: firedLore.map((f) => ({ id: f.entry.id, comment: f.entry.comment, keys: f.entry.keys, reason: f.reason })),
    },
  };
}
