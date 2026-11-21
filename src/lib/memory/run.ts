import "server-only";
import { generateText } from "ai";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, memoryChunks, messages, pinnedFacts } from "@/lib/db/schema";
import { getPathFull } from "@/lib/chat/tree";
import { buildForContext, loadChatContext, pathForMemory } from "@/lib/chat/context";
import { effectiveChunks, isChunkValid, planCompaction, planMerge } from "@/lib/memory/compaction";
import { getProvider } from "@/lib/llm/openrouter";
import { applyMacros } from "@/lib/prompt/macros";
import { countTokens } from "@/lib/tokens.server";
import { splitFacts } from "@/lib/memory/facts";

const g = globalThis as unknown as { __compacting?: Map<string, { since: number; step: string }> };
export const compactionStatus = (g.__compacting ??= new Map());

async function summarize(modelId: string, system: string, user: string) {
  const provider = await getProvider();
  const res = await generateText({
    model: provider.chat(modelId),
    instructions: system,
    messages: [{ role: "user", content: user }],
    temperature: 0.3,
    maxOutputTokens: 700,
    maxRetries: 2,
  });
  return res.text.trim();
}

export async function runCompaction(chatId: string, opts: { force?: boolean } = {}) {
  if (compactionStatus.has(chatId)) return { ran: 0 };
  compactionStatus.set(chatId, { since: Date.now(), step: "planning" });
  let ran = 0;
  try {
    // Loop until history is back under the threshold (bounded so a huge import cannot run away).
    for (let iter = 0; iter < 40; iter++) {
      const ctx = await loadChatContext(chatId);
      if (!ctx.compaction.enabled && !opts.force) break;
      const path = await getPathFull(chatId);
      const built = buildForContext(ctx, path, "reply");
      const memPath = pathForMemory(path);
      const { chunks: effective, coveredIds } = effectiveChunks(ctx.chunks, memPath);
      if (iter === 0) {
        // Drop chunks invalidated by edits (all their messages are still on this path, but changed).
        // Chunks invalid only because of branching are kept: they come back when switching branches.
        const onPath = new Set(memPath.map((p) => p.id));
        const effIds = new Set(effective.map((c) => c.id));
        const editedStale = ctx.chunks.filter(
          (c) => !effIds.has(c.id) && !c.mergedIntoId && c.messageIds.every((id) => onPath.has(id)) && !isChunkValid(c, new Map(memPath.map((p) => [p.id, p]))),
        );
        if (editedStale.length) {
          await db.delete(memoryChunks).where(inArray(memoryChunks.id, editedStale.map((c) => c.id)));
          ctx.chunks = ctx.chunks.filter((c) => !editedStale.some((s) => s.id === c.id));
        }
      }
      const macro = { char: ctx.character.name, user: ctx.persona.name };
      const model = ctx.compaction.modelId || ctx.modelId;

      // 1) Merge if a level is over its limit.
      const toMerge = planMerge(effective, ctx.compaction.mergeAfter);
      if (toMerge) {
        compactionStatus.set(chatId, { since: Date.now(), step: "merging memories" });
        const text = await summarize(
          model,
          applyMacros(ctx.compaction.mergePrompt, macro),
          toMerge.map((c, i) => `Recap ${i + 1}:\n${c.content}`).join("\n\n"),
        );
        const order = new Map(memPath.map((p, i) => [p.id, i]));
        const ids = [...new Set(toMerge.flatMap((c) => c.messageIds))].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
        const [merged] = await db
          .insert(memoryChunks)
          .values({
            chatId,
            level: Math.max(...toMerge.map((c) => c.level)) + 1,
            messageIds: ids,
            sourceChunkIds: toMerge.map((c) => c.id),
            content: text,
            tokenCount: countTokens(text),
            modelId: model,
          })
          .returning();
        await db.update(memoryChunks).set({ mergedIntoId: merged.id }).where(inArray(memoryChunks.id, toMerge.map((c) => c.id)));
        ran++;
        continue;
      }

      // 2) Summarize the next batch of old messages.
      const batch = planCompaction({
        path: memPath,
        coveredIds,
        historyBudget: built.historyBudget,
        thresholdPct: ctx.compaction.thresholdPct,
        keepRecent: ctx.compaction.keepRecent,
        chunkTokens: ctx.compaction.chunkTokens,
        force: opts.force && iter === 0,
      });
      if (!batch) break;
      compactionStatus.set(chatId, { since: Date.now(), step: `summarizing ${batch.length} messages` });
      const byId = new Map(path.map((p) => [p.id, p]));
      const personaNames = new Map(ctx.personas.map((p) => [p.id, p.name]));
      const transcript = batch
        .map((id) => {
          const m = byId.get(id)!;
          const who =
            m.role === "assistant" ? ctx.character.name : m.role === "system" ? "Narrator" : (m.personaId && personaNames.get(m.personaId)) || ctx.persona.name;
          return `${who}: ${m.content}`;
        })
        .join("\n\n");
      const raw = await summarize(model, applyMacros(ctx.compaction.prompt, macro), transcript);
      const { text, facts } = splitFacts(raw);
      const existing = new Set(ctx.facts.map((f) => f.content.toLowerCase()));
      for (const f of facts) {
        if (!existing.has(f.toLowerCase())) await db.insert(pinnedFacts).values({ chatId, content: f, suggested: true, sourceMessageId: batch[batch.length - 1] });
      }
      await db.insert(memoryChunks).values({
        chatId,
        level: 0,
        messageIds: batch,
        content: text,
        tokenCount: countTokens(text),
        modelId: model,
      });
      ran++;
    }
  } finally {
    compactionStatus.delete(chatId);
  }
  return { ran };
}

export async function regenerateChunk(chunkId: string) {
  const [chunk] = await db.select().from(memoryChunks).where(eq(memoryChunks.id, chunkId));
  if (!chunk) throw new Error("Memory not found");
  const ctx = await loadChatContext(chunk.chatId);
  const macro = { char: ctx.character.name, user: ctx.persona.name };
  const model = ctx.compaction.modelId || ctx.modelId;
  let text: string;
  if (chunk.sourceChunkIds.length) {
    const sources = await db.select().from(memoryChunks).where(inArray(memoryChunks.id, chunk.sourceChunkIds));
    text = await summarize(model, applyMacros(ctx.compaction.mergePrompt, macro), sources.map((c, i) => `Recap ${i + 1}:\n${c.content}`).join("\n\n"));
  } else {
    const rows = await db.select().from(messages).where(inArray(messages.id, chunk.messageIds));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const transcript = chunk.messageIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((m) => `${m!.role === "assistant" ? ctx.character.name : ctx.persona.name}: ${m!.content}`)
      .join("\n\n");
    text = splitFacts(await summarize(model, applyMacros(ctx.compaction.prompt, macro), transcript)).text;
  }
  await db.update(memoryChunks).set({ content: text, tokenCount: countTokens(text), userEdited: false, createdAt: new Date() }).where(eq(memoryChunks.id, chunkId));
}

export async function runTitle(chatId: string) {
  const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
  if (!chat || chat.title !== "New chat") return;
  const path = await getPathFull(chatId);
  const users = path.filter((p) => p.role === "user");
  if (users.length < 1) return;
  const ctx = await loadChatContext(chatId);
  const sample = path.slice(0, 6).map((m) => `${m.role === "assistant" ? ctx.character.name : ctx.persona.name}: ${m.content.slice(0, 500)}`).join("\n");
  try {
    const title = await summarize(
      ctx.compaction.modelId || ctx.modelId,
      "Write a short title (max 6 words) for this roleplay conversation. Reply with the title only, no quotes.",
      sample,
    );
    const clean = title.replace(/^["'\s]+|["'\s.]+$/g, "").slice(0, 80);
    if (clean) await db.update(chats).set({ title: clean }).where(eq(chats.id, chatId));
  } catch (e) {
    console.error("[title]", e);
  }
}
