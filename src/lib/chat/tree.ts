import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, memoryChunks, messages, pinnedFacts, chatLorebooks, type Message } from "@/lib/db/schema";
import { normalizeState, type EmotionState } from "@/lib/emotion/engine";

export interface MessageView {
  id: string;
  chatId: string;
  parentId: string | null;
  role: Message["role"];
  personaId: string | null;
  characterId: string | null;
  content: string;
  reasoning: string | null;
  status: Message["status"];
  error: string | null;
  modelId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cost: number | null;
  genMs: number | null;
  ttftMs: number | null;
  finishReason: string | null;
  bookmarked: boolean;
  hidden: boolean;
  emotion: EmotionState | null;
  createdAt: string;
  updatedAt: string;
  depth: number;
  siblingIds: string[];
}

interface Row {
  id: string;
  chat_id: string;
  parent_id: string | null;
  active_child_id: string | null;
  role: Message["role"];
  persona_id: string | null;
  character_id: string | null;
  content: string;
  reasoning: string | null;
  status: Message["status"];
  error: string | null;
  model_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost: number | null;
  gen_ms: number | null;
  ttft_ms: number | null;
  finish_reason: string | null;
  bookmarked: boolean;
  hidden: boolean;
  emotion: EmotionState | null;
  created_at: Date;
  updated_at: Date;
  depth: number;
  sibling_ids: string[] | null;
  total: string | number;
}

const COLS = sql.raw(
  `id, chat_id, parent_id, active_child_id, role, persona_id, character_id, content, reasoning, status, error, model_id, prompt_tokens, completion_tokens, cost, gen_ms, ttft_ms, finish_reason, bookmarked, hidden, emotion, created_at, updated_at`,
);

function toView(r: Row): MessageView {
  return {
    id: r.id,
    chatId: r.chat_id,
    parentId: r.parent_id,
    role: r.role,
    personaId: r.persona_id,
    characterId: r.character_id,
    content: r.content,
    reasoning: r.reasoning,
    status: r.status,
    error: r.error,
    modelId: r.model_id,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    cost: r.cost,
    genMs: r.gen_ms,
    ttftMs: r.ttft_ms,
    finishReason: r.finish_reason,
    bookmarked: r.bookmarked,
    hidden: r.hidden,
    // Normalized so older or partial readings (e.g. from before kaomoji faces) still render.
    emotion: normalizeState(r.emotion),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    depth: Number(r.depth),
    siblingIds: r.sibling_ids ?? [r.id],
  };
}

/**
 * Active path of a chat (root → leaf), optionally windowed.
 * - `fromDepth`: return messages with depth >= fromDepth
 * - `last`: return only the last N messages (before `beforeDepth` if given)
 */
export async function getPath(
  chatId: string,
  opts: { fromDepth?: number; last?: number; beforeDepth?: number } = {},
): Promise<{ messages: MessageView[]; total: number }> {
  const rows = (await db.execute(sql`
    WITH RECURSIVE path AS (
      SELECT ${COLS}, 0 AS depth FROM messages
        WHERE id = (SELECT active_root_id FROM chats WHERE id = ${chatId}) AND chat_id = ${chatId}
      UNION ALL
      SELECT m.id, m.chat_id, m.parent_id, m.active_child_id, m.role, m.persona_id, m.character_id, m.content,
             m.reasoning, m.status, m.error, m.model_id, m.prompt_tokens, m.completion_tokens, m.cost, m.gen_ms,
             m.ttft_ms, m.finish_reason, m.bookmarked, m.hidden, m.emotion, m.created_at, m.updated_at, p.depth + 1
        FROM messages m JOIN path p ON m.id = p.active_child_id AND m.parent_id = p.id
        WHERE p.depth < 200000
    ),
    counted AS (SELECT *, count(*) OVER () AS total FROM path)
    SELECT c.*,
      (SELECT array_agg(s.id ORDER BY s.created_at, s.id) FROM messages s
        WHERE s.chat_id = c.chat_id AND s.parent_id IS NOT DISTINCT FROM c.parent_id) AS sibling_ids
    FROM counted c
    WHERE (${opts.fromDepth ?? null}::int IS NULL OR c.depth >= ${opts.fromDepth ?? null}::int)
      AND (${opts.beforeDepth ?? null}::int IS NULL OR c.depth < ${opts.beforeDepth ?? null}::int)
      AND (${opts.last ?? null}::int IS NULL OR c.depth >= LEAST(c.total, COALESCE(${opts.beforeDepth ?? null}::int, c.total)) - ${opts.last ?? null}::int)
    ORDER BY c.depth
  `)) as unknown as Row[];
  const total = rows.length ? Number(rows[0].total) : await pathLength(chatId);
  return { messages: rows.map(toView), total };
}

async function pathLength(chatId: string) {
  const r = (await db.execute(sql`
    WITH RECURSIVE path AS (
      SELECT id, active_child_id, 0 AS depth FROM messages WHERE id = (SELECT active_root_id FROM chats WHERE id = ${chatId})
      UNION ALL SELECT m.id, m.active_child_id, p.depth + 1 FROM messages m JOIN path p ON m.id = p.active_child_id AND m.parent_id = p.id
    ) SELECT count(*)::int AS n FROM path`)) as unknown as { n: number }[];
  return r[0]?.n ?? 0;
}

/** Lightweight full path for prompt building / compaction. */
export async function getPathFull(chatId: string) {
  const { messages } = await getPath(chatId);
  return messages;
}

export async function getMessage(id: string) {
  const [m] = await db.select().from(messages).where(eq(messages.id, id));
  return m ?? null;
}

export async function getMessageView(id: string): Promise<MessageView | null> {
  const m = await getMessage(id);
  if (!m) return null;
  const { messages: path } = await getPath(m.chatId);
  return path.find((p) => p.id === id) ?? null;
}

/** Make `id` the active child of its parent (or active root). */
export async function activate(chatId: string, id: string, parentId: string | null) {
  if (parentId) await db.update(messages).set({ activeChildId: id, updatedAt: sql`updated_at` }).where(eq(messages.id, parentId));
  else await db.update(chats).set({ activeRootId: id }).where(eq(chats.id, chatId));
}

export async function appendMessage(
  chatId: string,
  parentId: string | null,
  data: Omit<typeof messages.$inferInsert, "chatId" | "parentId">,
) {
  const [m] = await db.insert(messages).values({ ...data, chatId, parentId }).returning();
  await activate(chatId, m.id, parentId);
  await db.update(chats).set({ lastMessageAt: new Date() }).where(eq(chats.id, chatId));
  return m;
}

/** Depth of a message on the active path, or -1 if not on it. */
export async function depthOf(chatId: string, id: string) {
  const { messages: path } = await getPath(chatId);
  return path.findIndex((p) => p.id === id);
}

// ---------- delete with undo ----------

type Snapshot = {
  chatId: string;
  rows: (typeof messages.$inferSelect)[];
  parentId: string | null;
  wasActive: boolean;
  at: number;
};
const g = globalThis as unknown as { __trash?: Map<string, Snapshot> };
const trash = (g.__trash ??= new Map());

export async function deleteMessage(id: string) {
  const target = await getMessage(id);
  if (!target) return null;
  const subtree = (await db.execute(sql`
    WITH RECURSIVE t AS (SELECT id FROM messages WHERE id = ${id}
      UNION ALL SELECT m.id FROM messages m JOIN t ON m.parent_id = t.id)
    SELECT id FROM t`)) as unknown as { id: string }[];
  const ids = subtree.map((r) => r.id);
  const rows = await db.select().from(messages).where(inArray(messages.id, ids));

  // Was it active?
  let wasActive = false;
  if (target.parentId) {
    const parent = await getMessage(target.parentId);
    wasActive = parent?.activeChildId === id;
  } else {
    const [c] = await db.select({ r: chats.activeRootId }).from(chats).where(eq(chats.id, target.chatId));
    wasActive = c?.r === id;
  }

  await db.delete(messages).where(eq(messages.id, id));

  if (wasActive) {
    // Pick the nearest remaining sibling (prefer the previous one).
    const siblings = await db
      .select({ id: messages.id, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.chatId, target.chatId), target.parentId ? eq(messages.parentId, target.parentId) : isNull(messages.parentId)))
      .orderBy(messages.createdAt);
    const before = siblings.filter((s) => s.createdAt <= target.createdAt);
    const next = before[before.length - 1] ?? siblings[0] ?? null;
    if (target.parentId) {
      await db.update(messages).set({ activeChildId: next?.id ?? null, updatedAt: sql`updated_at` }).where(eq(messages.id, target.parentId));
    } else {
      await db.update(chats).set({ activeRootId: next?.id ?? null }).where(eq(chats.id, target.chatId));
    }
  }

  const token = crypto.randomUUID();
  trash.set(token, { chatId: target.chatId, rows, parentId: target.parentId, wasActive, at: Date.now() });
  for (const [k, v] of trash) if (Date.now() - v.at > 10 * 60_000) trash.delete(k);
  return { token, chatId: target.chatId, parentId: target.parentId };
}

export async function restoreDeleted(token: string) {
  const snap = trash.get(token);
  if (!snap) return null;
  trash.delete(token);
  // Insert parents before children.
  const byParent = new Map<string | null, typeof snap.rows>();
  for (const r of snap.rows) {
    const arr = byParent.get(r.parentId) ?? [];
    arr.push(r);
    byParent.set(r.parentId, arr);
  }
  const rootRow = snap.rows.find((r: (typeof snap.rows)[number]) => r.parentId === snap.parentId)!;
  const ordered: typeof snap.rows = [];
  const queue = [rootRow];
  while (queue.length) {
    const r = queue.shift()!;
    ordered.push(r);
    queue.push(...(byParent.get(r.id) ?? []));
  }
  for (const r of ordered) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { search, ...rest } = r as typeof r & { search?: unknown };
    await db.insert(messages).values(rest);
  }
  if (snap.wasActive) await activate(snap.chatId, rootRow.id, snap.parentId);
  return { chatId: snap.chatId };
}

// ---------- fork ----------

export async function forkChat(chatId: string, uptoMessageId: string) {
  const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
  if (!chat) throw new Error("Chat not found");
  const path = await getPathFull(chatId);
  const idx = path.findIndex((p) => p.id === uptoMessageId);
  const slice = idx >= 0 ? path.slice(0, idx + 1) : path;
  const full = await db.select().from(messages).where(inArray(messages.id, slice.map((s) => s.id)));
  const byId = new Map(full.map((m) => [m.id, m]));

  const [newChat] = await db
    .insert(chats)
    .values({
      characterId: chat.characterId,
      title: `${chat.title} (fork)`,
      presetId: chat.presetId,
      templateId: chat.templateId,
      personaId: chat.personaId,
      authorsNote: chat.authorsNote,
      authorsNoteDepth: chat.authorsNoteDepth,
      emotionEnabled: chat.emotionEnabled,
      emotionBaseline: chat.emotionBaseline,
      forkedFromChatId: chat.id,
    })
    .returning();

  const idMap = new Map<string, string>();
  let prev: string | null = null;
  for (const s of slice) {
    const m = byId.get(s.id)!;
    const newId = crypto.randomUUID();
    idMap.set(m.id, newId);
    await db.insert(messages).values({
      id: newId,
      chatId: newChat.id,
      parentId: prev,
      role: m.role,
      personaId: m.personaId,
      characterId: m.characterId,
      content: m.content,
      reasoning: m.reasoning,
      status: m.status === "streaming" ? "stopped" : m.status,
      error: m.error,
      modelId: m.modelId,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      cost: m.cost,
      genMs: m.genMs,
      ttftMs: m.ttftMs,
      finishReason: m.finishReason,
      bookmarked: m.bookmarked,
      hidden: m.hidden,
      emotion: m.emotion,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    });
    if (prev) await db.update(messages).set({ activeChildId: newId, updatedAt: m.updatedAt }).where(eq(messages.id, prev));
    else await db.update(chats).set({ activeRootId: newId }).where(eq(chats.id, newChat.id));
    prev = newId;
  }

  // Inherit memory that is fully inside the copied range.
  const chunks = await db.select().from(memoryChunks).where(eq(memoryChunks.chatId, chatId));
  const chunkMap = new Map<string, string>();
  for (const c of chunks.sort((a, b) => a.level - b.level)) {
    if (!c.messageIds.every((id) => idMap.has(id))) continue;
    const nid = crypto.randomUUID();
    chunkMap.set(c.id, nid);
  }
  for (const c of chunks) {
    const nid = chunkMap.get(c.id);
    if (!nid) continue;
    await db.insert(memoryChunks).values({
      id: nid,
      chatId: newChat.id,
      level: c.level,
      messageIds: c.messageIds.map((id) => idMap.get(id)!),
      sourceChunkIds: c.sourceChunkIds.map((id) => chunkMap.get(id)).filter(Boolean) as string[],
      mergedIntoId: c.mergedIntoId ? (chunkMap.get(c.mergedIntoId) ?? null) : null,
      content: c.content,
      tokenCount: c.tokenCount,
      userEdited: c.userEdited,
      modelId: c.modelId,
      createdAt: c.createdAt,
    });
  }
  const facts = await db.select().from(pinnedFacts).where(eq(pinnedFacts.chatId, chatId));
  for (const f of facts) {
    await db.insert(pinnedFacts).values({ chatId: newChat.id, content: f.content, suggested: f.suggested, sort: f.sort, sourceMessageId: f.sourceMessageId ? (idMap.get(f.sourceMessageId) ?? null) : null });
  }
  const lbs = await db.select().from(chatLorebooks).where(eq(chatLorebooks.chatId, chatId));
  for (const l of lbs) await db.insert(chatLorebooks).values({ chatId: newChat.id, lorebookId: l.lorebookId });

  const last = slice[slice.length - 1];
  await db.update(chats).set({ lastMessageAt: new Date(), totalCost: 0 }).where(eq(chats.id, newChat.id));
  return { chatId: newChat.id, lastDepth: last?.depth ?? 0 };
}
