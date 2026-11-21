import "server-only";
import { z } from "zod";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  characterLorebooks,
  characters,
  chatLorebooks,
  chats,
  directories,
  lorebookEntries,
  lorebooks,
  memoryChunks,
  messages,
  personas,
  pinnedFacts,
  presets,
  promptSnapshots,
  promptTemplates,
  settings,
} from "@/lib/db/schema";
import { proc, RpcError } from "@/server/rpc";
import { characterDraftInput, draftCharacterField } from "@/server/character-writing";
import { DEFAULT_COMPACTION, DEFAULT_MODEL, DEFAULT_PRESET_PARAMS, DEFAULT_TEMPLATE_BLOCKS, DEFAULT_UI } from "@/lib/defaults";
import { encrypt } from "@/lib/crypto";
import { checkKey, listModels } from "@/lib/llm/models";
import { isMock } from "@/lib/llm/openrouter";
import { appendMessage, activate, deleteMessage, forkChat, getMessage, getPath, restoreDeleted } from "@/lib/chat/tree";
import { buildForContext, loadChatContext, pathForMemory } from "@/lib/chat/context";
import { effectiveChunks, isChunkValid } from "@/lib/memory/compaction";
import { compactionStatus, regenerateChunk } from "@/lib/memory/run";
import { enqueue } from "@/lib/jobs/boss";
import { appraiseMessage, resetEmotion } from "@/lib/emotion/run";
import { EMOTIONS, normalizeState } from "@/lib/emotion/engine";
import { countTokens } from "@/lib/tokens.server";
import type { CompactionSettings, PresetParams, PromptBlock, UiPrefs } from "@/lib/types";
import { REASONING_EFFORTS, type ReasoningEffort, type ModelPrefs } from "@/lib/types";

const id = z.string().uuid();
const keep = { updatedAt: sql`updated_at` } as const;

async function getSettings() {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  return s;
}

async function tailFrom(chatId: string, depth: number) {
  const { messages: tail, total } = await getPath(chatId, { fromDepth: Math.max(0, depth) });
  return { fromDepth: Math.max(0, depth), messages: tail, total };
}

async function depthOnPath(chatId: string, messageId: string) {
  const { messages: path } = await getPath(chatId);
  return path.findIndex((p) => p.id === messageId);
}

// ---------------- settings & models ----------------

const settingsProcs = {
  "settings.get": proc(z.object({}), async () => {
    const s = await getSettings();
    return {
      ui: { ...DEFAULT_UI, ...(s?.ui ?? {}) } as UiPrefs,
      compaction: { ...DEFAULT_COMPACTION, ...(s?.compaction ?? {}) } as CompactionSettings,
      defaultPresetId: s?.defaultPresetId ?? null,
      defaultPersonaId: s?.defaultPersonaId ?? null,
      defaultTemplateId: s?.defaultTemplateId ?? null,
      modelPrefs: (s?.modelPrefs ?? {}) as ModelPrefs,
      hasKey: !!s?.openrouterKeyEnc || !!process.env.OPENROUTER_API_KEY,
      keyFromEnv: !s?.openrouterKeyEnc && !!process.env.OPENROUTER_API_KEY,
      mock: isMock(),
    };
  }),
  /** Per-model reasoning effort (overrides the preset). null clears it. */
  "settings.setModelPref": proc(
    z.object({ modelId: z.string().min(1), reasoningEffort: z.enum(REASONING_EFFORTS as [ReasoningEffort, ...ReasoningEffort[]]).nullable() }),
    async ({ modelId, reasoningEffort }) => {
      const s = await getSettings();
      const prefs: ModelPrefs = { ...((s?.modelPrefs ?? {}) as ModelPrefs) };
      const next = { ...(prefs[modelId] ?? {}) };
      if (reasoningEffort) next.reasoningEffort = reasoningEffort;
      else delete next.reasoningEffort;
      if (Object.keys(next).length) prefs[modelId] = next;
      else delete prefs[modelId];
      await db.update(settings).set({ modelPrefs: prefs }).where(eq(settings.id, 1));
      return prefs;
    },
  ),
  "settings.update": proc(
    z.object({
      ui: z.record(z.string(), z.unknown()).optional(),
      compaction: z.record(z.string(), z.unknown()).optional(),
      defaultPresetId: id.nullable().optional(),
      defaultPersonaId: id.nullable().optional(),
      defaultTemplateId: id.nullable().optional(),
      lastChatId: id.nullable().optional(),
    }),
    async (input) => {
      const s = await getSettings();
      await db
        .update(settings)
        .set({
          ...(input.ui ? { ui: { ...DEFAULT_UI, ...(s?.ui ?? {}), ...input.ui } as UiPrefs } : {}),
          ...(input.compaction ? { compaction: { ...DEFAULT_COMPACTION, ...(s?.compaction ?? {}), ...input.compaction } as CompactionSettings } : {}),
          ...(input.defaultPresetId !== undefined ? { defaultPresetId: input.defaultPresetId } : {}),
          ...(input.defaultPersonaId !== undefined ? { defaultPersonaId: input.defaultPersonaId } : {}),
          ...(input.defaultTemplateId !== undefined ? { defaultTemplateId: input.defaultTemplateId } : {}),
          ...(input.lastChatId !== undefined ? { lastChatId: input.lastChatId } : {}),
        })
        .where(eq(settings.id, 1));
      return { ok: true };
    },
  ),
  "settings.setKey": proc(z.object({ key: z.string().min(8) }), async ({ key }) => {
    const check = await checkKey(key.trim());
    if (!check.ok) throw new RpcError(check.error);
    await db.update(settings).set({ openrouterKeyEnc: encrypt(key.trim()) }).where(eq(settings.id, 1));
    return check;
  }),
  "settings.clearKey": proc(z.object({}), async () => {
    await db.update(settings).set({ openrouterKeyEnc: null }).where(eq(settings.id, 1));
    return { ok: true };
  }),
  "settings.checkKey": proc(z.object({}), async () => checkKey()),
  "models.list": proc(z.object({ force: z.boolean().optional() }), async ({ force }) => listModels(force)),
};

// ---------------- personas ----------------

const personaInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(20000).default(""),
  pronouns: z.string().max(50).default(""),
  avatar: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
});

const personaProcs = {
  "personas.list": proc(z.object({}), async () => db.select().from(personas).orderBy(asc(personas.sort), asc(personas.createdAt))),
  "personas.create": proc(personaInput, async (input) => {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${personas.sort}), 0)` }).from(personas);
    const [p] = await db.insert(personas).values({ ...input, sort: Number(max) + 1 }).returning();
    return p;
  }),
  "personas.update": proc(personaInput.partial().extend({ id }), async ({ id: pid, ...rest }) => {
    const [p] = await db.update(personas).set(rest).where(eq(personas.id, pid)).returning();
    return p;
  }),
  "personas.delete": proc(z.object({ id }), async ({ id: pid }) => {
    const count = await db.$count(personas);
    if (count <= 1) throw new RpcError("You need at least one persona.");
    await db.delete(personas).where(eq(personas.id, pid));
    return { ok: true };
  }),
  "personas.reorder": proc(z.object({ ids: z.array(id) }), async ({ ids }) => {
    await Promise.all(ids.map((pid, i) => db.update(personas).set({ sort: i }).where(eq(personas.id, pid))));
    return { ok: true };
  }),
};

// ---------------- characters ----------------

const characterInput = z.object({
  name: z.string().min(1).max(200),
  avatar: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  tagline: z.string().max(300).default(""),
  description: z.string().default(""),
  personality: z.string().default(""),
  scenario: z.string().default(""),
  firstMessage: z.string().default(""),
  alternateGreetings: z.array(z.string()).default([]),
  exampleDialogue: z.string().default(""),
  systemPrompt: z.string().default(""),
  postHistoryInstructions: z.string().default(""),
  creatorNotes: z.string().default(""),
  creator: z.string().default(""),
  characterVersion: z.string().default(""),
  tags: z.array(z.string()).default([]),
  favorite: z.boolean().default(false),
  defaultPresetId: id.nullable().optional(),
  defaultPersonaId: id.nullable().optional(),
});

const characterProcs = {
  "characters.draftField": proc(characterDraftInput, draftCharacterField),
  "characters.list": proc(z.object({}), async () => {
    const rows = await db
      .select({
        id: characters.id,
        name: characters.name,
        avatar: characters.avatar,
        color: characters.color,
        tagline: characters.tagline,
        tags: characters.tags,
        favorite: characters.favorite,
        updatedAt: characters.updatedAt,
        chatCount: sql<number>`(select count(*)::int from chats c where c.character_id = "characters"."id")`,
        lastChatAt: sql<string | null>`(select max(c.last_message_at) from chats c where c.character_id = "characters"."id")`,
      })
      .from(characters)
      .orderBy(desc(characters.favorite), asc(characters.name));
    return rows;
  }),
  "characters.get": proc(z.object({ id }), async ({ id: cid }) => {
    const [c] = await db.select().from(characters).where(eq(characters.id, cid));
    if (!c) throw new RpcError("Character not found", 404);
    const books = await db.select({ id: characterLorebooks.lorebookId }).from(characterLorebooks).where(eq(characterLorebooks.characterId, cid));
    return { ...c, lorebookIds: books.map((b) => b.id) };
  }),
  "characters.create": proc(characterInput, async (input) => {
    const [c] = await db.insert(characters).values(input).returning();
    return c;
  }),
  "characters.update": proc(characterInput.partial().extend({ id, lorebookIds: z.array(id).optional() }), async ({ id: cid, lorebookIds, ...rest }) => {
    const [c] = await db.update(characters).set(rest).where(eq(characters.id, cid)).returning();
    if (lorebookIds) {
      await db.delete(characterLorebooks).where(eq(characterLorebooks.characterId, cid));
      if (lorebookIds.length) await db.insert(characterLorebooks).values(lorebookIds.map((l) => ({ characterId: cid, lorebookId: l })));
    }
    return c;
  }),
  "characters.delete": proc(z.object({ id }), async ({ id: cid }) => {
    await db.delete(characters).where(eq(characters.id, cid));
    return { ok: true };
  }),
  "characters.duplicate": proc(z.object({ id }), async ({ id: cid }) => {
    const [c] = await db.select().from(characters).where(eq(characters.id, cid));
    if (!c) throw new RpcError("Character not found", 404);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _i, createdAt, updatedAt, ...rest } = c;
    const [n] = await db.insert(characters).values({ ...rest, name: `${c.name} (copy)` }).returning();
    return n;
  }),
};

// ---------------- presets & templates ----------------

const presetInput = z.object({
  name: z.string().min(1).max(100),
  modelId: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  contextSize: z.number().int().positive().nullable().optional(),
});

const presetProcs = {
  "presets.list": proc(z.object({}), async () => db.select().from(presets).orderBy(asc(presets.createdAt))),
  "presets.create": proc(presetInput.partial().extend({ name: z.string().min(1) }), async (input) => {
    const [p] = await db
      .insert(presets)
      .values({ name: input.name, modelId: input.modelId ?? DEFAULT_MODEL, params: (input.params as PresetParams) ?? DEFAULT_PRESET_PARAMS, contextSize: input.contextSize ?? null })
      .returning();
    return p;
  }),
  "presets.update": proc(presetInput.partial().extend({ id }), async ({ id: pid, params, ...rest }) => {
    const [p] = await db
      .update(presets)
      .set({ ...rest, ...(params ? { params: params as PresetParams } : {}) })
      .where(eq(presets.id, pid))
      .returning();
    return p;
  }),
  "presets.duplicate": proc(z.object({ id }), async ({ id: pid }) => {
    const [p] = await db.select().from(presets).where(eq(presets.id, pid));
    const [n] = await db.insert(presets).values({ name: `${p.name} (copy)`, modelId: p.modelId, params: p.params, contextSize: p.contextSize }).returning();
    return n;
  }),
  "presets.delete": proc(z.object({ id }), async ({ id: pid }) => {
    if ((await db.$count(presets)) <= 1) throw new RpcError("You need at least one preset.");
    await db.delete(presets).where(eq(presets.id, pid));
    const s = await getSettings();
    if (s?.defaultPresetId === pid) {
      const [first] = await db.select().from(presets).limit(1);
      await db.update(settings).set({ defaultPresetId: first?.id ?? null }).where(eq(settings.id, 1));
    }
    return { ok: true };
  }),
  "templates.list": proc(z.object({}), async () => db.select().from(promptTemplates).orderBy(asc(promptTemplates.createdAt))),
  "templates.create": proc(z.object({ name: z.string().min(1), blocks: z.array(z.any()).optional() }), async (input) => {
    const [t] = await db.insert(promptTemplates).values({ name: input.name, blocks: (input.blocks as PromptBlock[]) ?? DEFAULT_TEMPLATE_BLOCKS }).returning();
    return t;
  }),
  "templates.update": proc(z.object({ id, name: z.string().optional(), blocks: z.array(z.any()).optional() }), async ({ id: tid, name, blocks }) => {
    const [t] = await db
      .update(promptTemplates)
      .set({ ...(name ? { name } : {}), ...(blocks ? { blocks: blocks as PromptBlock[] } : {}) })
      .where(eq(promptTemplates.id, tid))
      .returning();
    return t;
  }),
  "templates.delete": proc(z.object({ id }), async ({ id: tid }) => {
    if ((await db.$count(promptTemplates)) <= 1) throw new RpcError("You need at least one template.");
    await db.delete(promptTemplates).where(eq(promptTemplates.id, tid));
    return { ok: true };
  }),
};

// ---------------- lorebooks ----------------

const entryInput = z.object({
  comment: z.string().default(""),
  keys: z.array(z.string()).default([]),
  secondaryKeys: z.array(z.string()).default([]),
  selectiveLogic: z.enum(["and_any", "and_all", "not_any", "not_all"]).default("and_any"),
  content: z.string().default(""),
  constant: z.boolean().default(false),
  position: z.enum(["before_char", "after_char", "at_depth"]).default("after_char"),
  depth: z.number().int().min(0).default(4),
  order: z.number().int().default(100),
  probability: z.number().int().min(0).max(100).default(100),
  caseSensitive: z.boolean().default(false),
  wholeWord: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

const loreProcs = {
  "lorebooks.list": proc(z.object({}), async () =>
    db
      .select({
        id: lorebooks.id,
        name: lorebooks.name,
        description: lorebooks.description,
        updatedAt: lorebooks.updatedAt,
        entryCount: sql<number>`(select count(*)::int from lorebook_entries e where e.lorebook_id = "lorebooks"."id")`,
      })
      .from(lorebooks)
      .orderBy(asc(lorebooks.name)),
  ),
  "lorebooks.get": proc(z.object({ id }), async ({ id: lid }) => {
    const [b] = await db.select().from(lorebooks).where(eq(lorebooks.id, lid));
    if (!b) throw new RpcError("Lorebook not found", 404);
    const entries = await db.select().from(lorebookEntries).where(eq(lorebookEntries.lorebookId, lid)).orderBy(desc(lorebookEntries.order), asc(lorebookEntries.createdAt));
    return { ...b, entries };
  }),
  "lorebooks.create": proc(z.object({ name: z.string().min(1), description: z.string().default("") }), async (input) => {
    const [b] = await db.insert(lorebooks).values(input).returning();
    return b;
  }),
  "lorebooks.update": proc(
    z.object({ id, name: z.string().optional(), description: z.string().optional(), scanDepth: z.number().int().min(1).optional(), tokenBudget: z.number().int().min(0).optional(), recursive: z.boolean().optional() }),
    async ({ id: lid, ...rest }) => {
      const [b] = await db.update(lorebooks).set(rest).where(eq(lorebooks.id, lid)).returning();
      return b;
    },
  ),
  "lorebooks.delete": proc(z.object({ id }), async ({ id: lid }) => {
    await db.delete(lorebooks).where(eq(lorebooks.id, lid));
    return { ok: true };
  }),
  "lore.createEntry": proc(entryInput.partial().extend({ lorebookId: id }), async (input) => {
    const [e] = await db.insert(lorebookEntries).values({ ...entryInput.parse(input), lorebookId: input.lorebookId }).returning();
    return e;
  }),
  "lore.updateEntry": proc(entryInput.partial().extend({ id }), async ({ id: eid, ...rest }) => {
    const [e] = await db.update(lorebookEntries).set(rest).where(eq(lorebookEntries.id, eid)).returning();
    return e;
  }),
  "lore.deleteEntry": proc(z.object({ id }), async ({ id: eid }) => {
    await db.delete(lorebookEntries).where(eq(lorebookEntries.id, eid));
    return { ok: true };
  }),
};

// ---------------- chats ----------------

const chatProcs = {
  "chats.list": proc(z.object({ archived: z.boolean().optional(), characterId: id.optional() }), async ({ archived, characterId }) => {
    const rows = await db
      .select({
        id: chats.id,
        title: chats.title,
        pinned: chats.pinned,
        archived: chats.archived,
        directoryId: chats.directoryId,
        lastMessageAt: chats.lastMessageAt,
        characterId: chats.characterId,
        characterName: characters.name,
        characterAvatar: characters.avatar,
        characterColor: characters.color,
        characterTags: characters.tags,
        totalCost: chats.totalCost,
        // Last time the chat's content changed: a new message, or an edit to an existing one.
        editedAt: sql<Date>`greatest(${chats.lastMessageAt}, (select max(m.updated_at) from messages m where m.chat_id = ${chats.id}))`.mapWith(
          chats.lastMessageAt,
        ),
      })
      .from(chats)
      .innerJoin(characters, eq(characters.id, chats.characterId))
      .where(and(eq(chats.archived, archived ?? false), characterId ? eq(chats.characterId, characterId) : undefined))
      .orderBy(desc(chats.pinned), desc(chats.lastMessageAt))
      .limit(500);
    return rows;
  }),
  "chats.create": proc(z.object({ characterId: id, greetingIndex: z.number().int().min(0).optional(), personaId: id.optional() }), async (input) => {
    const [character] = await db.select().from(characters).where(eq(characters.id, input.characterId));
    if (!character) throw new RpcError("Character not found", 404);
    const s = await getSettings();
    const [chat] = await db
      .insert(chats)
      .values({
        characterId: character.id,
        personaId: input.personaId ?? character.defaultPersonaId ?? s?.defaultPersonaId ?? null,
        presetId: null,
      })
      .returning();
    const greetings = [character.firstMessage, ...character.alternateGreetings].filter((g) => g.trim());
    let activeId: string | null = null;
    const now = Date.now();
    for (let i = 0; i < greetings.length; i++) {
      const [m] = await db
        .insert(messages)
        .values({
          chatId: chat.id,
          parentId: null,
          role: "assistant",
          characterId: character.id,
          content: greetings[i],
          status: "complete",
          createdAt: new Date(now + i),
          updatedAt: new Date(now + i),
        })
        .returning();
      if (i === (input.greetingIndex ?? 0)) activeId = m.id;
    }
    if (activeId) await db.update(chats).set({ activeRootId: activeId }).where(eq(chats.id, chat.id));
    await db.update(settings).set({ lastChatId: chat.id }).where(eq(settings.id, 1));
    return { id: chat.id };
  }),
  "chats.get": proc(z.object({ id }), async ({ id: chatId }) => {
    const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
    if (!chat) throw new RpcError("Chat not found", 404);
    const [character] = await db.select().from(characters).where(eq(characters.id, chat.characterId));
    const lbs = await db.select({ id: chatLorebooks.lorebookId }).from(chatLorebooks).where(eq(chatLorebooks.chatId, chatId));
    const charLbs = await db.select({ id: characterLorebooks.lorebookId }).from(characterLorebooks).where(eq(characterLorebooks.characterId, chat.characterId));
    const s = await getSettings();
    const effectivePresetId = chat.presetId ?? character.defaultPresetId ?? s?.defaultPresetId ?? null;
    const effectivePersonaId = chat.personaId ?? character.defaultPersonaId ?? s?.defaultPersonaId ?? null;
    const effectiveTemplateId = chat.templateId ?? s?.defaultTemplateId ?? null;
    return {
      chat,
      character,
      lorebookIds: lbs.map((l) => l.id),
      /** Lorebooks linked to the character; always active in its chats. */
      characterLorebookIds: charLbs.map((l) => l.id),
      effectivePresetId,
      effectivePersonaId,
      effectiveTemplateId,
      compacting: compactionStatus.get(chatId)?.step ?? null,
    };
  }),
  "chats.messages": proc(
    z.object({ id, last: z.number().int().positive().max(500).optional(), beforeDepth: z.number().int().optional(), fromDepth: z.number().int().optional() }),
    async ({ id: chatId, ...opts }) => getPath(chatId, opts),
  ),
  "chats.update": proc(
    z.object({
      id,
      title: z.string().min(1).max(200).optional(),
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
      directoryId: id.nullable().optional(),
      presetId: id.nullable().optional(),
      templateId: id.nullable().optional(),
      personaId: id.nullable().optional(),
      authorsNote: z.string().optional(),
      authorsNoteDepth: z.number().int().min(0).max(100).optional(),
      lorebookIds: z.array(id).optional(),
      emotionEnabled: z.boolean().optional(),
    }),
    async ({ id: chatId, lorebookIds, ...rest }) => {
      if (Object.keys(rest).length) await db.update(chats).set(rest).where(eq(chats.id, chatId));
      if (lorebookIds) {
        await db.delete(chatLorebooks).where(eq(chatLorebooks.chatId, chatId));
        if (lorebookIds.length) await db.insert(chatLorebooks).values(lorebookIds.map((l) => ({ chatId, lorebookId: l })));
      }
      return { ok: true };
    },
  ),
  "chats.delete": proc(z.object({ id }), async ({ id: chatId }) => {
    await db.delete(chats).where(eq(chats.id, chatId));
    return { ok: true };
  }),
  "chats.fork": proc(z.object({ id, messageId: id }), async ({ id: chatId, messageId }) => forkChat(chatId, messageId)),
  "chats.locate": proc(z.object({ id, messageId: id }), async ({ id: chatId, messageId }) => {
    const { messages: path, total } = await getPath(chatId);
    return { depth: path.findIndex((p) => p.id === messageId), total };
  }),
  "chats.bookmarks": proc(z.object({ id }), async ({ id: chatId }) => {
    const { messages: path } = await getPath(chatId);
    return path
      .filter((m) => m.bookmarked)
      .map((m) => ({ id: m.id, depth: m.depth, role: m.role, personaId: m.personaId, createdAt: m.createdAt, snippet: m.content.slice(0, 320) }));
  }),
  "chats.tree": proc(z.object({ id, messageId: id }), async ({ id: chatId, messageId }) => {
    // Sibling versions of a message with a short preview of each, for the branch switcher.
    const m = await getMessage(messageId);
    if (!m) throw new RpcError("Message not found", 404);
    const sibs = await db
      .select({ id: messages.id, content: messages.content, role: messages.role, createdAt: messages.createdAt, activeChildId: messages.activeChildId })
      .from(messages)
      .where(and(eq(messages.chatId, chatId), m.parentId ? eq(messages.parentId, m.parentId) : sql`${messages.parentId} is null`))
      .orderBy(asc(messages.createdAt));
    const counts = await db.execute(sql`
      select s.id, (with recursive t as (select id from messages where parent_id = s.id union all select m.id from messages m join t on m.parent_id = t.id) select count(*)::int from t) as n
      from messages s where s.id in ${sibs.map((s) => s.id)}`);
    const byId = new Map((counts as unknown as { id: string; n: number }[]).map((c) => [c.id, c.n]));
    return sibs.map((s) => ({ id: s.id, preview: s.content.slice(0, 140), createdAt: s.createdAt, descendants: byId.get(s.id) ?? 0 }));
  }),
};

// ---------------- messages ----------------

const messageProcs = {
  "messages.edit": proc(z.object({ id, content: z.string() }), async ({ id: mid, content }) => {
    const m = await getMessage(mid);
    if (!m) throw new RpcError("Message not found", 404);
    const prev = m.content;
    await db.update(messages).set({ content, status: m.status === "error" ? "complete" : m.status, error: null }).where(eq(messages.id, mid));
    const depth = await depthOnPath(m.chatId, mid);
    return { ...(await tailFrom(m.chatId, depth)), previous: prev };
  }),
  "messages.editBranch": proc(z.object({ id, content: z.string().min(1) }), async ({ id: mid, content }) => {
    // Creates a new version (sibling) of a user message; the caller then generates a reply.
    const m = await getMessage(mid);
    if (!m) throw new RpcError("Message not found", 404);
    const depth = await depthOnPath(m.chatId, mid);
    await appendMessage(m.chatId, m.parentId, { role: m.role, content, personaId: m.personaId, characterId: m.characterId, status: "complete" });
    return tailFrom(m.chatId, depth);
  }),
  "messages.select": proc(z.object({ id }), async ({ id: mid }) => {
    const m = await getMessage(mid);
    if (!m) throw new RpcError("Message not found", 404);
    await activate(m.chatId, m.id, m.parentId);
    const depth = await depthOnPath(m.chatId, mid);
    return tailFrom(m.chatId, depth);
  }),
  "messages.delete": proc(z.object({ id }), async ({ id: mid }) => {
    const m = await getMessage(mid);
    if (!m) throw new RpcError("Message not found", 404);
    const depth = await depthOnPath(m.chatId, mid);
    const res = await deleteMessage(mid);
    return { token: res!.token, ...(await tailFrom(m.chatId, Math.max(0, depth))) };
  }),
  "messages.restore": proc(z.object({ token: z.string() }), async ({ token }) => {
    const r = await restoreDeleted(token);
    if (!r) throw new RpcError("Nothing to undo");
    return getPath(r.chatId, { last: 80 });
  }),
  "messages.update": proc(z.object({ id, bookmarked: z.boolean().optional(), hidden: z.boolean().optional() }), async ({ id: mid, ...rest }) => {
    await db.update(messages).set({ ...rest, ...keep }).where(eq(messages.id, mid));
    return { ok: true };
  }),
  "messages.inspect": proc(z.object({ id }), async ({ id: mid }) => {
    const [snap] = await db.select().from(promptSnapshots).where(eq(promptSnapshots.messageId, mid));
    return snap ?? null;
  }),
  "chats.previewPrompt": proc(z.object({ id, personaId: id.optional() }), async ({ id: chatId, personaId }) => {
    // What would be sent for the next reply right now.
    const ctx = await loadChatContext(chatId, personaId);
    const { messages: path } = await getPath(chatId);
    const built = buildForContext(ctx, path, "reply");
    return { model: ctx.modelId, messages: built.messages, breakdown: built.breakdown, params: ctx.params };
  }),
};

// ---------------- memory & facts ----------------

const memoryProcs = {
  "memory.list": proc(z.object({ chatId: id }), async ({ chatId }) => {
    const ctx = await loadChatContext(chatId);
    const { messages: path } = await getPath(chatId);
    const memPath = pathForMemory(path);
    const index = new Map(memPath.map((p) => [p.id, p]));
    const pos = new Map(path.map((p, i) => [p.id, i]));
    const { chunks: effective, coveredIds } = effectiveChunks(ctx.chunks, memPath);
    const effIds = new Set(effective.map((c) => c.id));
    const built = buildForContext(ctx, path, "reply");
    const chunks = ctx.chunks
      .map((c) => {
        const positions = c.messageIds.map((m) => pos.get(m)).filter((x): x is number => x !== undefined);
        return {
          id: c.id,
          level: c.level,
          content: c.content,
          tokenCount: c.tokenCount,
          userEdited: c.userEdited,
          createdAt: c.createdAt,
          messageCount: c.messageIds.length,
          fromDepth: positions.length ? Math.min(...positions) : null,
          toDepth: positions.length ? Math.max(...positions) : null,
          state: effIds.has(c.id) ? ("active" as const) : c.mergedIntoId && effIds.has(c.mergedIntoId) ? ("merged" as const) : isChunkValid(c, index) ? ("merged" as const) : ("stale" as const),
        };
      })
      .sort((a, b) => (a.fromDepth ?? 1e9) - (b.fromDepth ?? 1e9) || b.level - a.level);
    const lastCovered = path.reduce((acc, p, i) => (coveredIds.has(p.id) ? i : acc), -1);
    return {
      chunks,
      facts: ctx.facts,
      coveredCount: coveredIds.size,
      lastCoveredDepth: lastCovered,
      pathLength: path.length,
      uncoveredTokens: built.uncoveredHistoryTokens,
      historyBudget: built.historyBudget,
      threshold: Math.round(built.historyBudget * ctx.compaction.thresholdPct),
      compacting: compactionStatus.get(chatId)?.step ?? null,
      enabled: ctx.compaction.enabled,
    };
  }),
  "memory.compactNow": proc(z.object({ chatId: id }), async ({ chatId }) => {
    await enqueue("compaction", { chatId, force: true }, `${chatId}-force`);
    return { ok: true };
  }),
  "memory.update": proc(z.object({ id, content: z.string().min(1) }), async ({ id: cid, content }) => {
    await db.update(memoryChunks).set({ content, tokenCount: countTokens(content), userEdited: true }).where(eq(memoryChunks.id, cid));
    return { ok: true };
  }),
  "memory.delete": proc(z.object({ id }), async ({ id: cid }) => {
    const [c] = await db.select().from(memoryChunks).where(eq(memoryChunks.id, cid));
    if (c?.sourceChunkIds.length) await db.update(memoryChunks).set({ mergedIntoId: null }).where(inArray(memoryChunks.id, c.sourceChunkIds));
    await db.delete(memoryChunks).where(eq(memoryChunks.id, cid));
    return { ok: true };
  }),
  "memory.regenerate": proc(z.object({ id }), async ({ id: cid }) => {
    await regenerateChunk(cid);
    return { ok: true };
  }),
  "facts.create": proc(z.object({ chatId: id, content: z.string().min(1), sourceMessageId: id.optional(), suggested: z.boolean().optional() }), async (input) => {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${pinnedFacts.sort}), 0)` }).from(pinnedFacts).where(eq(pinnedFacts.chatId, input.chatId));
    const [f] = await db.insert(pinnedFacts).values({ ...input, sort: Number(max) + 1 }).returning();
    return f;
  }),
  "facts.update": proc(z.object({ id, content: z.string().min(1).optional(), suggested: z.boolean().optional() }), async ({ id: fid, ...rest }) => {
    await db.update(pinnedFacts).set(rest).where(eq(pinnedFacts.id, fid));
    return { ok: true };
  }),
  "facts.delete": proc(z.object({ id }), async ({ id: fid }) => {
    await db.delete(pinnedFacts).where(eq(pinnedFacts.id, fid));
    return { ok: true };
  }),
};

// ---------------- directories ----------------

const dirName = z.string().trim().min(1).max(80);

const directoryProcs = {
  "directories.list": proc(z.object({}), async () =>
    db.select({ id: directories.id, name: directories.name, sortOrder: directories.sortOrder }).from(directories).orderBy(asc(directories.sortOrder), asc(directories.createdAt), asc(directories.id)),
  ),
  "directories.create": proc(z.object({ name: dirName }), ({ name }) => {
    return db.transaction(async (tx) => {
      // Serialize changes to the directory list while assigning positions.
      await tx.execute(sql`lock table ${directories} in share row exclusive mode`);
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${directories.sortOrder}), -1)::int + 1` }).from(directories);
      const [d] = await tx.insert(directories).values({ name, sortOrder: next }).returning({ id: directories.id, name: directories.name, sortOrder: directories.sortOrder });
      return d;
    });
  }),
  "directories.reorder": proc(z.object({ ids: z.array(id).min(2) }), ({ ids }) => {
    return db.transaction(async (tx) => {
      await tx.execute(sql`lock table ${directories} in share row exclusive mode`);
      const current = await tx.select({ id: directories.id }).from(directories);
      const requested = new Set(ids);
      if (requested.size !== ids.length || current.length !== ids.length || current.some((dir) => !requested.has(dir.id))) {
        throw new RpcError("The directory list changed. Try reordering again.", 409);
      }
      await tx.execute(sql`
        update ${directories}
        set sort_order = (ordered.position - 1)::int
        from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) with ordinality as ordered(id, position)
        where ${directories.id} = ordered.id::uuid
          and ${directories.sortOrder} <> (ordered.position - 1)::int
      `);
      return { ok: true };
    });
  }),
  "directories.update": proc(z.object({ id, name: dirName }), async ({ id: dirId, name }) => {
    await db.update(directories).set({ name }).where(eq(directories.id, dirId));
    return { ok: true };
  }),
  "directories.delete": proc(z.object({ id }), async ({ id: dirId }) => {
    // Chats inside are kept: the foreign key sets their directory to null.
    await db.delete(directories).where(eq(directories.id, dirId));
    return { ok: true };
  }),
};

// ---------------- search ----------------

const searchProcs = {
  "search.all": proc(z.object({ q: z.string().min(1).max(200) }), async ({ q }) => {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const chatHits = await db
      .select({ id: chats.id, title: chats.title, characterName: characters.name, characterAvatar: characters.avatar, characterColor: characters.color })
      .from(chats)
      .innerJoin(characters, eq(characters.id, chats.characterId))
      .where(or(ilike(chats.title, like), ilike(characters.name, like)))
      .orderBy(desc(chats.lastMessageAt))
      .limit(8);
    const charHits = await db
      .select({ id: characters.id, name: characters.name, avatar: characters.avatar, color: characters.color, tagline: characters.tagline })
      .from(characters)
      .where(or(ilike(characters.name, like), ilike(characters.tagline, like)))
      .limit(6);
    const msgHits = (await db.execute(sql`
      select m.id, m.chat_id, c.title, ch.name as character_name,
        ts_headline('simple', m.content, websearch_to_tsquery('simple', ${q}), 'MaxWords=18, MinWords=6, StartSel=<<, StopSel=>>') as snippet
      from messages m join chats c on c.id = m.chat_id join characters ch on ch.id = c.character_id
      where m.search @@ websearch_to_tsquery('simple', ${q})
      order by m.created_at desc limit 12`)) as unknown as { id: string; chat_id: string; title: string; character_name: string; snippet: string }[];
    return {
      chats: chatHits,
      characters: charHits,
      messages: msgHits.map((m) => ({ id: m.id, chatId: m.chat_id, title: m.title, characterName: m.character_name, snippet: m.snippet })),
    };
  }),
  "chats.searchIn": proc(z.object({ id, q: z.string().min(1) }), async ({ id: chatId, q }) => {
    const { messages: path } = await getPath(chatId);
    const needle = q.toLowerCase();
    return path
      .filter((m) => m.content.toLowerCase().includes(needle))
      .map((m) => {
        const i = m.content.toLowerCase().indexOf(needle);
        return { id: m.id, depth: m.depth, role: m.role, snippet: m.content.slice(Math.max(0, i - 50), i + needle.length + 70) };
      })
      .slice(-100);
  }),
};

// ---------------- emotion engine ----------------

const emotionVector = z.object(Object.fromEntries(EMOTIONS.map((e) => [e, z.number().min(0).max(100)])) as Record<(typeof EMOTIONS)[number], z.ZodNumber>);

const emotionProcs = {
  /** Read (or re-read with `force`) how {{char}} feels after an assistant message. Null when the engine is off. */
  "emotion.appraise": proc(z.object({ messageId: id, force: z.boolean().optional() }), async ({ messageId, force }) => ({
    emotion: await appraiseMessage(messageId, { force }),
  })),
  /** Hand-edit the state stored on a message; later replies build on it. */
  "emotion.set": proc(
    z.object({
      messageId: id,
      state: z.object({ v: emotionVector, affection: z.number().min(-100).max(100), label: z.string().max(40), kaomoji: z.string().max(40), note: z.string().max(240) }),
    }),
    async ({ messageId, state }) => {
      const m = await getMessage(messageId);
      if (!m || m.role !== "assistant") throw new RpcError("Only character replies carry an emotion state", 400);
      const clean = normalizeState({ ...state, manual: true })!;
      await db.update(messages).set({ emotion: clean, ...keep }).where(eq(messages.id, messageId));
      return { emotion: clean };
    },
  ),
  /** Re-estimate the character's temperament and restart feelings from it. */
  "emotion.reset": proc(z.object({ chatId: id }), async ({ chatId }) => resetEmotion(chatId)),
};

export const procedures = {
  ...settingsProcs,
  ...personaProcs,
  ...characterProcs,
  ...presetProcs,
  ...loreProcs,
  ...chatProcs,
  ...directoryProcs,
  ...messageProcs,
  ...memoryProcs,
  ...emotionProcs,
  ...searchProcs,
};

export type Procedures = typeof procedures;
