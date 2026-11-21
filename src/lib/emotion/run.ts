import "server-only";
import { generateText } from "ai";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, messages } from "@/lib/db/schema";
import { getPathFull, type MessageView } from "@/lib/chat/tree";
import { loadChatContext, type ChatContext } from "@/lib/chat/context";
import { getProvider } from "@/lib/llm/openrouter";
import { applyMacros } from "@/lib/prompt/macros";
import {
  APPRAISAL_PROMPT,
  BASELINE_PROMPT,
  NEUTRAL_BASELINE,
  describeState,
  initialState,
  latestEmotion,
  normalizeState,
  parseAppraisal,
  parseBaseline,
  step,
  type EmotionState,
  type EmotionVector,
} from "@/lib/emotion/engine";

const g = globalThis as unknown as { __appraising?: Map<string, Promise<EmotionState | null>> };
const inflight = (g.__appraising ??= new Map());

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

async function ask(modelId: string, system: string, user: string) {
  const provider = await getProvider();
  const res = await generateText({
    model: provider.chat(modelId),
    instructions: system,
    messages: [{ role: "user", content: user }],
    temperature: 0.2,
    maxOutputTokens: 400,
    maxRetries: 1,
  });
  return res.text;
}

const engineModel = (ctx: ChatContext) => ctx.compaction.modelId || ctx.modelId;

/** The character's resting temperament; estimated once per chat from the character sheet. */
export async function ensureBaseline(ctx: ChatContext): Promise<EmotionVector> {
  if (ctx.chat.emotionBaseline) return { ...NEUTRAL_BASELINE, ...ctx.chat.emotionBaseline };
  const macro = { char: ctx.character.name, user: ctx.persona.name };
  const sheet = [
    `Name: ${ctx.character.name}`,
    ctx.character.personality && `Personality: ${clip(ctx.character.personality, 1500)}`,
    ctx.character.description && `Description: ${clip(ctx.character.description, 2500)}`,
    ctx.character.scenario && `Scenario: ${clip(ctx.character.scenario, 800)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  let baseline = NEUTRAL_BASELINE;
  try {
    baseline = parseBaseline(await ask(engineModel(ctx), applyMacros(BASELINE_PROMPT, macro), applyMacros(sheet, macro))) ?? NEUTRAL_BASELINE;
  } catch (e) {
    console.error("[emotion] baseline failed", e);
  }
  await db.update(chats).set({ emotionBaseline: baseline }).where(eq(chats.id, ctx.chat.id));
  ctx.chat.emotionBaseline = baseline;
  return baseline;
}

/**
 * Appraise an assistant message and store the resulting state on it.
 * Returns the existing state unless `force`; null when the engine is off or the message can't be read.
 */
export function appraiseMessage(messageId: string, opts: { force?: boolean } = {}): Promise<EmotionState | null> {
  const running = inflight.get(messageId);
  if (running) return running;
  const p = doAppraise(messageId, opts).finally(() => inflight.delete(messageId));
  inflight.set(messageId, p);
  return p;
}

async function doAppraise(messageId: string, opts: { force?: boolean }) {
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!msg || msg.role !== "assistant" || !msg.content.trim() || msg.status === "streaming") return null;
  if (msg.emotion && !opts.force) return normalizeState(msg.emotion);
  const ctx = await loadChatContext(msg.chatId);
  if (!ctx.chat.emotionEnabled) return null;

  const baseline = await ensureBaseline(ctx);
  const path = await getPathFull(msg.chatId);
  const idx = path.findIndex((p) => p.id === messageId);
  if (idx < 0) return null;
  const prevRaw = latestEmotion(path, idx);
  const prev = (prevRaw && normalizeState(prevRaw, baseline)) || initialState(baseline);

  const personaNames = new Map(ctx.personas.map((p) => [p.id, p.name]));
  const who = (m: MessageView) =>
    m.role === "assistant" ? ctx.character.name : m.role === "system" ? "Narrator" : (m.personaId && personaNames.get(m.personaId)) || ctx.persona.name;
  // The reply plus what led to it (back to the previous character turn, max 3 messages).
  const lead: MessageView[] = [];
  for (let i = idx - 1; i >= 0 && lead.length < 3; i--) {
    if (path[i].hidden) continue;
    if (path[i].role === "assistant") {
      if (!lead.length) lead.unshift(path[i]);
      break;
    }
    lead.unshift(path[i]);
  }
  const exchange = [...lead, path[idx]].map((m) => `${who(m)}: ${clip(m.content, m.id === messageId ? 3000 : 1500)}`).join("\n\n");

  const macro = { char: ctx.character.name, user: ctx.persona.name };
  const input = [
    ctx.character.personality && `About ${ctx.character.name}: ${clip(applyMacros(ctx.character.personality, macro), 700)}`,
    `${ctx.character.name}'s feelings before this exchange — ${applyMacros(describeState(prev), macro)}`,
    `Latest exchange:\n${exchange}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let next: EmotionState;
  try {
    const appraisal = parseAppraisal(await ask(engineModel(ctx), applyMacros(APPRAISAL_PROMPT, macro), input));
    // Unparseable reply: let feelings settle a little instead of failing the turn.
    next = step(prev, appraisal ?? { impulse: {}, affection: 0, label: prev.label, kaomoji: prev.kaomoji, note: prev.note }, baseline);
  } catch (e) {
    console.error("[emotion] appraisal failed", e);
    return normalizeState(msg.emotion);
  }
  // Keep updatedAt: memory chunks use it to detect edited messages.
  await db.update(messages).set({ emotion: next, updatedAt: sql`updated_at` }).where(eq(messages.id, messageId));
  return next;
}

/** Re-estimate the baseline and start the latest reply from it (a "fresh start" for feelings). */
export async function resetEmotion(chatId: string) {
  await db.update(chats).set({ emotionBaseline: null }).where(eq(chats.id, chatId));
  const ctx = await loadChatContext(chatId);
  const baseline = await ensureBaseline(ctx);
  const path = await getPathFull(chatId);
  const last = [...path].reverse().find((m) => m.role === "assistant");
  const state = initialState(baseline);
  if (last) await db.update(messages).set({ emotion: state, updatedAt: sql`updated_at` }).where(eq(messages.id, last.id));
  return { baseline, messageId: last?.id ?? null, state };
}
