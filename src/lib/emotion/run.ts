import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, messages } from "@/lib/db/schema";
import { getPathFull, type MessageView } from "@/lib/chat/tree";
import { loadChatContext, type ChatContext } from "@/lib/chat/context";
import { baseUrl, getApiKey, isMock, orFetch } from "@/lib/llm/openrouter";
import { applyMacros } from "@/lib/prompt/macros";
import {
  NEUTRAL_BASELINE,
  describeState,
  initialState,
  latestEmotion,
  normalizeState,
  step,
  type EmotionBaseline,
  type EmotionState,
} from "@/lib/emotion/engine";
import { JEV_MODEL, appraisalQuestions, baselineQuestions, readAppraisal, readBaseline, type JevAnswers, type JevQuestion } from "@/lib/emotion/jev";

const g = globalThis as unknown as { __appraising?: Map<string, Promise<EmotionState | null>> };
const inflight = (g.__appraising ??= new Map());

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

/** OpenRouter Decisions API (…/api/alpha/decisions): Jev answers typed questions about a state. */
async function decide(state: unknown, questions: Record<string, JevQuestion>): Promise<JevAnswers> {
  const apiKey = isMock() ? "mock-key" : await getApiKey();
  if (!apiKey) {
    const e = new Error("No OpenRouter API key configured. Add one in Settings.");
    (e as Error & { code?: string }).code = "no_key";
    throw e;
  }
  const url = baseUrl().replace(/\/v1\/?$/, "") + "/alpha/decisions";
  const res = await orFetch()(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Generic attribution; never send personal details.
      "HTTP-Referer": "https://github.com/",
      "X-Title": "SimpleTavern",
    },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${clip(await res.text(), 300)}`);
  const body = (await res.json()) as { answers?: JevAnswers; data?: { answers?: JevAnswers } };
  return body.answers ?? body.data?.answers ?? {};
}

const namesOf = (ctx: ChatContext) => ({ char: ctx.character.name, user: ctx.persona.name });

/** Who {{char}} is, for Jev's state. */
function sheet(ctx: ChatContext, full: boolean) {
  const macro = namesOf(ctx);
  const m = (s: string, n: number) => (s.trim() ? clip(applyMacros(s, macro), n) : undefined);
  return {
    name: ctx.character.name,
    personality: m(ctx.character.personality, full ? 1500 : 900),
    description: m(ctx.character.description, full ? 2500 : 1200),
    scenario: m(ctx.character.scenario, full ? 1200 : 600),
  };
}

/**
 * The character's resting temperament and starting stance toward {{user}}; read once per chat from
 * the character sheet, scenario, greeting and persona.
 */
export async function ensureBaseline(ctx: ChatContext): Promise<EmotionBaseline> {
  if (ctx.chat.emotionBaseline) return { ...NEUTRAL_BASELINE, ...ctx.chat.emotionBaseline };
  const macro = namesOf(ctx);
  const path = await getPathFull(ctx.chat.id).catch(() => [] as MessageView[]);
  const greeting = path.find((p) => p.role === "assistant")?.content || ctx.character.firstMessage;
  const state = {
    character: sheet(ctx, true),
    user: { name: ctx.persona.name, description: ctx.persona.description?.trim() ? clip(applyMacros(ctx.persona.description, macro), 800) : undefined },
    greeting: greeting?.trim() ? clip(applyMacros(greeting, macro), 1500) : undefined,
  };
  let baseline: EmotionBaseline = NEUTRAL_BASELINE;
  try {
    baseline = readBaseline(await decide(state, baselineQuestions(macro))) ?? NEUTRAL_BASELINE;
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

  const macro = namesOf(ctx);
  const state = {
    character: sheet(ctx, false),
    feelings_before: applyMacros(describeState(prev), macro),
    latest_exchange: [...lead, path[idx]].map((m) => ({ speaker: who(m), text: clip(m.content, m.id === messageId ? 3000 : 1500) })),
  };

  let next: EmotionState;
  try {
    const appraisal = readAppraisal(await decide(state, appraisalQuestions(macro)), macro);
    // Nothing usable: let feelings settle a little instead of failing the turn.
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
