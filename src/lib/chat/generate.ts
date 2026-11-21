import "server-only";
import { streamText } from "ai";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, messages, promptSnapshots } from "@/lib/db/schema";
import { appendMessage, getMessage, getPath, type MessageView } from "@/lib/chat/tree";
import { buildForContext, loadChatContext } from "@/lib/chat/context";
import { getProvider } from "@/lib/llm/openrouter";
import { toCallSettings } from "@/lib/llm/params";
import { mapError, type GenError } from "@/lib/llm/errors";
import { enqueue } from "@/lib/jobs/boss";

export type GenerateMode = "send" | "regenerate" | "continue" | "impersonate";

export interface GenerateRequest {
  chatId: string;
  mode: GenerateMode;
  content?: string;
  personaId?: string | null;
  targetId?: string | null;
  role?: "user" | "system";
}

export type StreamEvent =
  | { t: "start"; fromDepth: number; messages: MessageView[]; assistantId: string | null }
  | { t: "text"; d: string }
  | { t: "reasoning"; d: string }
  | { t: "done"; message: MessageView | null; text?: string }
  | { t: "error"; error: GenError; message: MessageView | null };

export function generate(req: GenerateRequest, signal: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        await run(req, signal, emit);
      } catch (err) {
        emit({ t: "error", error: mapError(err), message: null });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {}
      }
    },
  });
}

async function run(req: GenerateRequest, signal: AbortSignal, emit: (e: StreamEvent) => void) {
  const ctx = await loadChatContext(req.chatId, req.personaId);
  const { messages: path } = await getPath(req.chatId);
  const leaf = path[path.length - 1] ?? null;

  let history: MessageView[];
  let assistantId: string | null = null;
  let baseContent = "";
  let fromDepth = path.length;
  const created: string[] = [];

  if (req.personaId && req.personaId !== ctx.chat.personaId) {
    await db.update(chats).set({ personaId: req.personaId }).where(eq(chats.id, req.chatId));
  }

  switch (req.mode) {
    case "send": {
      let parentId = leaf?.id ?? null;
      if (req.content?.trim()) {
        const role = req.role ?? "user";
        const um = await appendMessage(req.chatId, parentId, {
          role,
          content: req.content,
          personaId: role === "user" ? ctx.persona.id : null,
          status: "complete",
        });
        created.push(um.id);
        parentId = um.id;
        if (role === "system") {
          // Narrator message only; no reply.
          const { messages: tail } = await getPath(req.chatId, { fromDepth });
          emit({ t: "start", fromDepth, messages: tail, assistantId: null });
          emit({ t: "done", message: null });
          return;
        }
      }
      const am = await appendMessage(req.chatId, parentId, {
        role: "assistant",
        content: "",
        characterId: ctx.character.id,
        status: "streaming",
        modelId: ctx.modelId,
      });
      assistantId = am.id;
      break;
    }
    case "regenerate": {
      const target = req.targetId ? await getMessage(req.targetId) : null;
      if (!target || target.role !== "assistant") throw new Error("Can only regenerate assistant messages");
      const depth = path.findIndex((p) => p.id === target.id);
      fromDepth = depth >= 0 ? depth : path.length;
      if (!target.parentId) {
        throw new Error("The greeting can't be regenerated — swipe to pick an alternate greeting instead.");
      }
      const am = await appendMessage(req.chatId, target.parentId, {
        role: "assistant",
        content: "",
        characterId: ctx.character.id,
        status: "streaming",
        modelId: ctx.modelId,
      });
      assistantId = am.id;
      break;
    }
    case "continue": {
      const target = req.targetId ? await getMessage(req.targetId) : leaf ? await getMessage(leaf.id) : null;
      if (!target || target.role !== "assistant") throw new Error("Can only continue assistant messages");
      assistantId = target.id;
      baseContent = target.content;
      fromDepth = path.findIndex((p) => p.id === target.id);
      await db.update(messages).set({ status: "streaming", error: null, updatedAt: sql`updated_at` }).where(eq(messages.id, target.id));
      break;
    }
    case "impersonate":
      break;
  }

  // Fresh path after mutations.
  const { messages: newPath } = await getPath(req.chatId);
  const aIdx = assistantId ? newPath.findIndex((p) => p.id === assistantId) : -1;
  if (req.mode === "continue") history = newPath.slice(0, aIdx + 1);
  else if (assistantId) history = newPath.slice(0, aIdx);
  else history = newPath;

  if (req.mode !== "impersonate") {
    emit({ t: "start", fromDepth, messages: newPath.slice(fromDepth), assistantId });
  }

  const built = buildForContext(ctx, history, req.mode === "send" || req.mode === "regenerate" ? "reply" : req.mode, newPath);

  if (assistantId) {
    await db
      .insert(promptSnapshots)
      .values({ messageId: assistantId, chatId: req.chatId, payload: { model: ctx.modelId, messages: built.messages, params: ctx.params }, breakdown: built.breakdown })
      .onConflictDoUpdate({ target: promptSnapshots.messageId, set: { payload: { model: ctx.modelId, messages: built.messages, params: ctx.params }, breakdown: built.breakdown, createdAt: new Date() } });
  }

  const started = Date.now();
  let ttft: number | null = null;
  let text = "";
  let reasoning = "";
  let finishReason: string | null = null;
  let usage: { inputTokens?: number; outputTokens?: number } | null = null;
  let cost: number | null = null;
  let error: GenError | null = null;
  let aborted = false;

  try {
    const provider = await getProvider();
    const { settings, providerOptions } = toCallSettings(ctx.params, ctx.model);
    const result = streamText({
      model: provider.chat(ctx.modelId),
      messages: built.messages,
      // The prompt is assembled by us from trusted templates; positioned system messages
      // (author's note, depth lore, narrator lines) are intentional.
      allowSystemInMessages: true,
      ...settings,
      providerOptions,
      abortSignal: signal,
      maxRetries: 1,
    });

    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        if (ttft === null) ttft = Date.now() - started;
        text += part.text;
        emit({ t: "text", d: part.text });
      } else if (part.type === "reasoning-delta") {
        if (ttft === null) ttft = Date.now() - started;
        reasoning += part.text;
        emit({ t: "reasoning", d: part.text });
      } else if (part.type === "error") {
        throw (part as { error: unknown }).error;
      } else if (part.type === "abort") {
        aborted = true;
      } else if (part.type === "finish") {
        finishReason = part.finishReason;
        const u = (part as { totalUsage?: { inputTokens?: number; outputTokens?: number } }).totalUsage;
        if (u) usage = u;
      }
    }
    try {
      const meta = (await result.providerMetadata) as { openrouter?: { usage?: { cost?: number } } } | undefined;
      cost = meta?.openrouter?.usage?.cost ?? null;
    } catch {}
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === "AbortError") aborted = true;
    else error = mapError(err);
  }
  if (signal.aborted) aborted = true;

  const genMs = Date.now() - started;

  if (req.mode === "impersonate") {
    if (error) emit({ t: "error", error, message: null });
    else emit({ t: "done", message: null, text });
    return;
  }

  const finalContent = baseContent + text;
  const status = error ? "error" : aborted ? "stopped" : "complete";
  await db
    .update(messages)
    .set({
      content: req.mode === "continue" ? finalContent : text,
      reasoning: req.mode === "continue" ? undefined : reasoning || null,
      status,
      error: error ? JSON.stringify(error) : null,
      modelId: ctx.modelId,
      promptTokens: usage?.inputTokens ?? null,
      completionTokens: usage?.outputTokens ?? null,
      cost,
      genMs,
      ttftMs: ttft,
      finishReason: aborted ? "aborted" : finishReason,
      // Continuing changes content -> memory over this message must refresh.
      ...(req.mode === "continue" ? {} : { updatedAt: sql`updated_at` }),
    })
    .where(eq(messages.id, assistantId!));

  if (cost || usage) {
    await db
      .update(chats)
      .set({
        totalCost: sql`${chats.totalCost} + ${cost ?? 0}`,
        totalTokens: sql`${chats.totalTokens} + ${(usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)}`,
        lastMessageAt: new Date(),
      })
      .where(eq(chats.id, req.chatId));
  }

  const { messages: finalTail } = await getPath(req.chatId, { fromDepth: Math.max(0, aIdx) });
  const view = finalTail.find((m) => m.id === assistantId) ?? null;
  if (error) emit({ t: "error", error, message: view });
  else emit({ t: "done", message: view });

  if (!error) {
    await enqueue("compaction", { chatId: req.chatId }, req.chatId).catch(() => {});
    if (ctx.chat.title === "New chat") await enqueue("chat-title", { chatId: req.chatId }, req.chatId).catch(() => {});
  }
}
