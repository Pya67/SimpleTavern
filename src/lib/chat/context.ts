import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  characterLorebooks,
  characters,
  chatLorebooks,
  chats,
  lorebookEntries,
  lorebooks,
  memoryChunks,
  personas,
  pinnedFacts,
  presets,
  promptTemplates,
  settings,
} from "@/lib/db/schema";
import { DEFAULT_COMPACTION, DEFAULT_MODEL, DEFAULT_PRESET_PARAMS, DEFAULT_TEMPLATE_BLOCKS, DEFAULT_PERSONA } from "@/lib/defaults";
import { getModel } from "@/lib/llm/models";
import { answerBudget } from "@/lib/llm/params";
import { buildPrompt, type HistoryMessage } from "@/lib/prompt/builder";
import { effectiveChunks } from "@/lib/memory/compaction";
import { countTokens } from "@/lib/tokens.server";
import type { MessageView } from "@/lib/chat/tree";
import { NEUTRAL_BASELINE, describeForPrompt, initialState, latestEmotion, normalizeState } from "@/lib/emotion/engine";

export async function getSettingsRow() {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  return s;
}

export async function loadChatContext(chatId: string, personaOverride?: string | null) {
  const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
  if (!chat) throw new Error("Chat not found");
  const [character] = await db.select().from(characters).where(eq(characters.id, chat.characterId));
  const s = await getSettingsRow();

  const presetId = chat.presetId ?? character.defaultPresetId ?? s?.defaultPresetId;
  const [preset] = presetId
    ? await db.select().from(presets).where(eq(presets.id, presetId))
    : await db.select().from(presets).orderBy(asc(presets.createdAt)).limit(1);

  const templateId = chat.templateId ?? s?.defaultTemplateId;
  const [template] = templateId
    ? await db.select().from(promptTemplates).where(eq(promptTemplates.id, templateId))
    : await db.select().from(promptTemplates).orderBy(asc(promptTemplates.createdAt)).limit(1);

  const allPersonas = await db.select().from(personas).orderBy(asc(personas.sort));
  const personaId = personaOverride ?? chat.personaId ?? character.defaultPersonaId ?? s?.defaultPersonaId ?? allPersonas[0]?.id;
  const persona = allPersonas.find((p) => p.id === personaId) ?? allPersonas[0] ?? { id: null, ...DEFAULT_PERSONA };

  const modelId = preset?.modelId ?? DEFAULT_MODEL;
  const model = await getModel(modelId);
  const params = { ...DEFAULT_PRESET_PARAMS, ...(preset?.params ?? {}) };
  // A per-model reasoning effort (Settings / composer) overrides the preset.
  const pref = s?.modelPrefs?.[modelId];
  if (pref?.reasoningEffort) {
    params.reasoning =
      pref.reasoningEffort === "none"
        ? { ...(params.reasoning ?? {}), enabled: false, effort: "none" }
        : { ...(params.reasoning ?? {}), enabled: true, effort: pref.reasoningEffort, maxTokens: undefined };
  }
  const contextSize = preset?.contextSize ?? model?.contextLength ?? 8192;

  const bookIds = [
    ...(await db.select().from(characterLorebooks).where(eq(characterLorebooks.characterId, character.id))).map((r) => r.lorebookId),
    ...(await db.select().from(chatLorebooks).where(eq(chatLorebooks.chatId, chat.id))).map((r) => r.lorebookId),
  ];
  const uniqueBooks = [...new Set(bookIds)];
  const books = uniqueBooks.length ? await db.select().from(lorebooks).where(inArray(lorebooks.id, uniqueBooks)) : [];
  const entries = uniqueBooks.length ? await db.select().from(lorebookEntries).where(inArray(lorebookEntries.lorebookId, uniqueBooks)) : [];

  const chunks = await db.select().from(memoryChunks).where(eq(memoryChunks.chatId, chat.id));
  const facts = await db.select().from(pinnedFacts).where(eq(pinnedFacts.chatId, chat.id)).orderBy(asc(pinnedFacts.sort));

  return {
    chat,
    character,
    preset,
    params,
    template,
    blocks: template?.blocks ?? DEFAULT_TEMPLATE_BLOCKS,
    persona,
    personas: allPersonas,
    modelId,
    model,
    contextSize,
    books,
    entries,
    chunks,
    facts,
    compaction: { ...DEFAULT_COMPACTION, ...(s?.compaction ?? {}) },
    settings: s,
  };
}

export type ChatContext = Awaited<ReturnType<typeof loadChatContext>>;

export function pathForMemory(path: MessageView[]) {
  return path.map((p) => ({
    id: p.id,
    updatedAt: new Date(p.updatedAt),
    hidden: p.hidden,
    tokens: countTokens(p.content) + 4,
  }));
}

/** Prompt text for the emotion state that applies after `history` (undefined when the engine is off). */
export function emotionForPrompt(ctx: ChatContext, history: Pick<MessageView, "role" | "emotion">[]) {
  if (!ctx.chat.emotionEnabled) return undefined;
  const baseline = ctx.chat.emotionBaseline ? { ...NEUTRAL_BASELINE, ...ctx.chat.emotionBaseline } : null;
  const raw = latestEmotion(history);
  const state = raw ? normalizeState(raw, baseline ?? NEUTRAL_BASELINE) : baseline ? initialState(baseline) : null;
  return state ? describeForPrompt(state, { hideDesire: !ctx.chat.emotionShowDesire }) : undefined;
}

export function buildForContext(
  ctx: ChatContext,
  history: MessageView[],
  mode: "reply" | "continue" | "impersonate",
  fullPathForMemory?: MessageView[],
) {
  const memPath = pathForMemory(fullPathForMemory ?? history);
  const { chunks, coveredIds } = effectiveChunks(ctx.chunks, memPath);
  // Only chunks that cover messages within the history being sent.
  const histIds = new Set(history.map((h) => h.id));
  const usable = chunks.filter((c) => c.messageIds.every((id) => histIds.has(id)));
  const usableCovered = new Set(usable.flatMap((c) => c.messageIds));

  const hist: HistoryMessage[] = history.map((h) => ({
    id: h.id,
    role: h.role,
    content: h.content,
    personaId: h.personaId,
    hidden: h.hidden || (h.status === "error" && !h.content),
  }));

  const result = buildPrompt({
    blocks: ctx.blocks,
    character: ctx.character,
    persona: { id: ctx.persona.id, name: ctx.persona.name, description: ctx.persona.description },
    personaNames: Object.fromEntries(ctx.personas.map((p) => [p.id, p.name])),
    history: hist,
    memory: usable.map((c) => ({ id: c.id, content: c.content })),
    coveredIds: usableCovered,
    facts: ctx.facts.filter((f) => !f.suggested).map((f) => f.content),
    lore: { books: ctx.books, entries: ctx.entries },
    authorsNote: ctx.chat.authorsNote,
    authorsNoteDepth: ctx.chat.authorsNoteDepth,
    // Continuing a reply: use the feelings from before it, not the reading of its first half.
    emotion: emotionForPrompt(ctx, mode === "continue" ? history.slice(0, -1) : history),
    contextSize: ctx.contextSize,
    maxTokens: answerBudget(ctx.params),
    targetWords: ctx.params.targetWords,
    mode,
    modelId: ctx.modelId,
    countTokens,
    lastMessageAt: ctx.chat.lastMessageAt,
  });
  return { ...result, effective: chunks, coveredIds };
}
