"use client";
import { create } from "zustand";
import { renameChunkAnimation, resetChunkAnimation } from "@/components/chat/markdown";
import { toast } from "sonner";
import { UNDO_DURATION, undoAction } from "@/lib/client/toast-actions";
import { rpc } from "@/lib/client/rpc";
import type { MessageV } from "@/lib/client/queries";
import type { GenError } from "@/lib/llm/errors";

type Mode = "send" | "regenerate" | "continue" | "impersonate";

interface Generating {
  mode: Mode;
  assistantId: string | null;
  abort: AbortController;
  startedAt: number;
}

interface ChatState {
  chatId: string | null;
  messages: MessageV[];
  total: number;
  loaded: boolean;
  loadingOlder: boolean;
  generating: Generating | null;
  editingId: string | null;
  /** Direction of the last swipe per depth, for slide animations. */
  swipeDir: Record<number, 1 | -1>;
  impersonation: { text: string; done: boolean } | null;
  highlightId: string | null;
  /** Request to scroll to a message (counter makes repeated jumps re-trigger). */
  jumpTo: { id: string; n: number } | null;
  /**
   * Depth of the reply being (or last) generated. While it's the last message, the list gives it
   * about a screen of room, so it grows into empty space instead of pushing the conversation around.
   */
  reserveDepth: number | null;
  /** Assistant messages whose emotion the engine is reading right now. */
  emotionPending: string[];
}

export const useChat = create<ChatState>(() => ({
  chatId: null,
  messages: [],
  total: 0,
  loaded: false,
  loadingOlder: false,
  generating: null,
  editingId: null,
  swipeDir: {},
  impersonation: null,
  highlightId: null,
  jumpTo: null,
  reserveDepth: null,
  emotionPending: [],
}));

/** Fast-changing stream buffer, kept separate so only the streaming message re-renders. */
export const useStream = create<{
  id: string | null;
  text: string;
  reasoning: string;
  done: boolean;
  startedAt: number;
  firstAt: number | null;
  /** True once the on-screen reveal has caught up with a finished stream. */
  revealed: boolean;
}>(() => ({
  id: null,
  revealed: true,
  text: "",
  reasoning: "",
  done: true,
  startedAt: 0,
  firstAt: null,
}));

const PAGE = 60;
let onChanged: (() => void) | null = null;
export function setOnChatChanged(fn: (() => void) | null) {
  onChanged = fn;
}

export async function loadChat(chatId: string, focusMessageId?: string | null, keepLoaded = false) {
  const prev = useChat.getState();
  if (prev.generating && prev.chatId !== chatId) prev.generating.abort.abort();
  useChat.setState({ chatId, loaded: prev.chatId === chatId && keepLoaded ? prev.loaded : prev.chatId === chatId ? prev.loaded : false, messages: prev.chatId === chatId ? prev.messages : [], editingId: null, impersonation: null, generating: prev.chatId === chatId ? prev.generating : null, reserveDepth: prev.chatId === chatId ? prev.reserveDepth : null });
  let last = PAGE;
  if (focusMessageId) {
    const loc = await rpc("chats.locate", { id: chatId, messageId: focusMessageId }).catch(() => null);
    if (loc && loc.depth >= 0) last = Math.max(PAGE, loc.total - loc.depth + 15);
  }
  const res = await rpc("chats.messages", { id: chatId, last });
  if (useChat.getState().chatId !== chatId) return;
  useChat.setState({ messages: res.messages, total: res.total, loaded: true, highlightId: focusMessageId ?? null });
}

/** Scroll to (and highlight) a message, loading older history first if needed. */
export async function jumpToMessage(id: string) {
  const s = useChat.getState();
  if (!s.chatId) return;
  if (!s.messages.some((m) => m.id === id)) await loadChat(s.chatId, id, true);
  useChat.setState((st) => ({ highlightId: id, jumpTo: { id, n: (st.jumpTo?.n ?? 0) + 1 } }));
  setTimeout(() => {
    if (useChat.getState().highlightId === id) useChat.setState({ highlightId: null });
  }, 2600);
}

export async function loadOlder() {
  const s = useChat.getState();
  if (!s.chatId || s.loadingOlder || !s.messages.length || s.messages[0].depth === 0) return;
  useChat.setState({ loadingOlder: true });
  try {
    const res = await rpc("chats.messages", { id: s.chatId, last: PAGE, beforeDepth: s.messages[0].depth });
    const cur = useChat.getState();
    if (cur.chatId !== s.chatId) return;
    const minDepth = cur.messages[0]?.depth ?? Infinity;
    useChat.setState({ messages: [...res.messages.filter((m) => m.depth < minDepth), ...cur.messages] });
  } finally {
    useChat.setState({ loadingOlder: false });
  }
}

export function applyTail(tail: { fromDepth: number; messages: MessageV[]; total?: number }) {
  const s = useChat.getState();
  const kept = s.messages.filter((m) => m.depth < tail.fromDepth && !m.id.startsWith("tmp-"));
  const merged = [...kept, ...tail.messages];
  const lastDepth = merged.length ? merged[merged.length - 1].depth + 1 : 0;
  useChat.setState({ messages: merged, total: tail.total ?? lastDepth });
}

function replaceMessage(m: MessageV) {
  useChat.setState((s) => ({ messages: s.messages.map((x) => (x.id === m.id ? m : x)) }));
}

function optimistic(partial: Partial<MessageV> & Pick<MessageV, "id" | "role" | "depth">): MessageV {
  const now = new Date().toISOString();
  return {
    chatId: useChat.getState().chatId!,
    parentId: null,
    personaId: null,
    characterId: null,
    content: "",
    reasoning: null,
    status: "complete",
    error: null,
    modelId: null,
    promptTokens: null,
    completionTokens: null,
    cost: null,
    genMs: null,
    ttftMs: null,
    finishReason: null,
    bookmarked: false,
    hidden: false,
    emotion: null,
    createdAt: now,
    updatedAt: now,
    siblingIds: [partial.id],
    ...partial,
  } as MessageV;
}

export interface GenerateOpts {
  mode: Mode;
  content?: string;
  personaId?: string | null;
  targetId?: string | null;
  role?: "user" | "system";
}

export async function generate(opts: GenerateOpts) {
  const s = useChat.getState();
  const chatId = s.chatId;
  if (!chatId) return;
  if (s.generating) {
    toast.warning("Still generating — stop it first", { duration: 1500 });
    return;
  }
  const abort = new AbortController();
  useChat.setState({ generating: { mode: opts.mode, assistantId: null, abort, startedAt: Date.now() } });

  // Optimistic UI.
  const lastDepth = s.messages.length ? s.messages[s.messages.length - 1].depth : -1;
  if (opts.mode === "send") {
    const add: MessageV[] = [];
    if (opts.content?.trim()) add.push(optimistic({ id: "tmp-user", role: opts.role ?? "user", content: opts.content, depth: lastDepth + 1, personaId: opts.personaId ?? null }));
    if (opts.role !== "system") add.push(optimistic({ id: "tmp-assistant", role: "assistant", status: "streaming", depth: lastDepth + 1 + add.length }));
    useChat.setState({ messages: [...s.messages, ...add], ...(opts.role !== "system" ? { reserveDepth: add[add.length - 1].depth } : {}) });
    resetChunkAnimation("tmp-assistant");
    useStream.setState({ id: "tmp-assistant", text: "", reasoning: "", done: false, revealed: false, startedAt: Date.now(), firstAt: null });
  } else if (opts.mode === "regenerate" && opts.targetId) {
    const target = s.messages.find((m) => m.id === opts.targetId);
    if (target) {
      useChat.setState((st) => ({
        reserveDepth: target.depth,
        swipeDir: { ...st.swipeDir, [target.depth]: 1 },
        messages: st.messages
          .filter((m) => m.depth <= target.depth)
          .map((m) => (m.id === target.id ? optimistic({ id: "tmp-assistant", role: "assistant", status: "streaming", depth: target.depth, siblingIds: [...target.siblingIds, "tmp-assistant"] }) : m)),
      }));
      resetChunkAnimation("tmp-assistant");
    useStream.setState({ id: "tmp-assistant", text: "", reasoning: "", done: false, revealed: false, startedAt: Date.now(), firstAt: null });
    }
  } else if (opts.mode === "continue") {
    const target = s.messages.find((m) => m.id === opts.targetId) ?? s.messages[s.messages.length - 1];
    if (target) {
      useStream.setState({ id: target.id, text: target.content, reasoning: target.reasoning ?? "", done: false, revealed: false, startedAt: Date.now(), firstAt: Date.now() });
      replaceMessage({ ...target, status: "streaming" });
      useChat.setState({ reserveDepth: target.depth });
    }
  } else if (opts.mode === "impersonate") {
    useChat.setState({ impersonation: { text: "", done: false } });
  }

  let gotStart = false;
  try {
    const res = await fetch(`/api/chats/${chatId}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
      signal: abort.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (useChat.getState().chatId !== chatId) continue;
        switch (ev.t) {
          case "start": {
            gotStart = true;
            applyTail({ fromDepth: ev.fromDepth, messages: ev.messages });
            const g = useChat.getState().generating;
            if (g) useChat.setState({ generating: { ...g, assistantId: ev.assistantId } });
            if (ev.assistantId) {
              const st = useStream.getState();
              // Keep the reveal-animation state when the optimistic id becomes the real one.
              if (st.id && st.id !== ev.assistantId) renameChunkAnimation(st.id, ev.assistantId);
              useStream.setState({ id: ev.assistantId, text: st.text, done: false });
            }
            break;
          }
          case "text":
            if (opts.mode === "impersonate") {
              useChat.setState((st) => ({ impersonation: { text: (st.impersonation?.text ?? "") + ev.d, done: false } }));
            } else {
              useStream.setState((st) => ({ text: st.text + ev.d, firstAt: st.firstAt ?? Date.now() }));
            }
            break;
          case "reasoning":
            useStream.setState((st) => ({ reasoning: st.reasoning + ev.d, firstAt: st.firstAt ?? Date.now() }));
            break;
          case "done":
            if (opts.mode === "impersonate") {
              useChat.setState({ impersonation: { text: ev.text ?? useChat.getState().impersonation?.text ?? "", done: true } });
            } else if (ev.message) {
              useStream.setState({ done: true });
              replaceMessage(ev.message);
              // A continued reply changed, so its reading is redone.
              if (ev.message.role === "assistant") void appraise(ev.message.id, opts.mode === "continue");
            }
            break;
          case "error": {
            const err = ev.error as GenError;
            if (ev.message) replaceMessage(ev.message);
            else if (!gotStart) rollbackOptimistic();
            if (opts.mode === "impersonate") useChat.setState({ impersonation: null });
            toast.error(err.message, {
              description: err.hint,
              action: ev.message ? { label: "Retry", onClick: () => generate({ mode: "regenerate", targetId: ev.message.id }) } : undefined,
            });
            break;
          }
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      // Server persists the partial reply; refresh the tail shortly.
      setTimeout(() => refreshTail(), 350);
      if (opts.mode === "impersonate") useChat.setState((st) => ({ impersonation: st.impersonation ? { ...st.impersonation, done: true } : null }));
    } else {
      if (!gotStart) rollbackOptimistic();
      toast.error("Couldn't reach the server", { description: (e as Error).message });
    }
  } finally {
    if (useChat.getState().generating?.abort === abort) useChat.setState({ generating: null });
    useStream.setState({ done: true });
    onChanged?.();
  }
}

/** Ask the emotion engine to read an assistant message (returns nothing when it's off for the chat). */
export async function appraise(id: string, force = false) {
  const chatId = useChat.getState().chatId;
  useChat.setState((s) => ({ emotionPending: [...s.emotionPending, id] }));
  try {
    const { emotion } = await rpc("emotion.appraise", { messageId: id, force });
    if (emotion && useChat.getState().chatId === chatId) setEmotion(id, emotion);
  } catch (e) {
    if (force) toast.error("Couldn't read the mood", { description: (e as Error).message });
  } finally {
    useChat.setState((s) => ({ emotionPending: s.emotionPending.filter((x) => x !== id) }));
  }
}

export function setEmotion(id: string, emotion: MessageV["emotion"]) {
  useChat.setState((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, emotion } : m)) }));
}

function rollbackOptimistic() {
  useChat.setState((s) => ({ messages: s.messages.filter((m) => !m.id.startsWith("tmp-")) }));
  void refreshTail();
}

export async function refreshTail() {
  const s = useChat.getState();
  if (!s.chatId) return;
  const from = Math.max(0, (s.messages[s.messages.length - 1]?.depth ?? 0) - 3);
  const res = await rpc("chats.messages", { id: s.chatId, fromDepth: s.messages.length ? Math.max(s.messages[0].depth, from) : 0 });
  applyTail({ fromDepth: s.messages.length ? Math.max(s.messages[0].depth, from) : 0, messages: res.messages, total: res.total });
}

export function stop() {
  useChat.getState().generating?.abort.abort();
}

export async function selectSibling(msg: MessageV, dir: 1 | -1) {
  if (useChat.getState().generating || msg.id.startsWith("tmp-")) return;
  const idx = msg.siblingIds.indexOf(msg.id);
  const nextId = msg.siblingIds[idx + dir];
  const s = useChat.getState();
  if (!nextId) {
    const isLast = s.messages[s.messages.length - 1]?.id === msg.id;
    if (dir === 1 && msg.role === "assistant" && isLast && msg.parentId) return generate({ mode: "regenerate", targetId: msg.id });
    return;
  }
  useChat.setState((st) => ({ swipeDir: { ...st.swipeDir, [msg.depth]: dir } }));
  const tail = await rpc("messages.select", { id: nextId });
  applyTail(tail);
  onChanged?.();
}

/** Jump directly to a specific sibling version. */
export async function selectVersion(msg: MessageV, id: string) {
  if (useChat.getState().generating || id === msg.id) return;
  const dir = msg.siblingIds.indexOf(id) > msg.siblingIds.indexOf(msg.id) ? 1 : -1;
  useChat.setState((st) => ({ swipeDir: { ...st.swipeDir, [msg.depth]: dir } }));
  applyTail(await rpc("messages.select", { id }));
  onChanged?.();
}

export async function editMessage(msg: MessageV, content: string) {
  const prev = msg.content;
  useChat.setState((s) => ({ editingId: null, messages: s.messages.map((m) => (m.id === msg.id ? { ...m, content } : m)) }));
  const tail = await rpc("messages.edit", { id: msg.id, content });
  applyTail(tail);
  toast.success("Message edited", {
    action: undoAction(async () => applyTail(await rpc("messages.edit", { id: msg.id, content: prev }))),
    duration: UNDO_DURATION,
  });
  onChanged?.();
}

export async function editAndBranch(msg: MessageV, content: string, personaId?: string | null) {
  useChat.setState({ editingId: null });
  const tail = await rpc("messages.editBranch", { id: msg.id, content });
  applyTail(tail);
  await generate({ mode: "send", personaId });
}

export async function deleteMessage(msg: MessageV) {
  const s = useChat.getState();
  const before = s.messages;
  useChat.setState({ messages: s.messages.filter((m) => m.depth < msg.depth) });
  try {
    const res = await rpc("messages.delete", { id: msg.id });
    applyTail(res);
    const descendants = before.filter((m) => m.depth > msg.depth).length;
    toast.success(descendants ? `Deleted message and ${descendants} after it` : "Message deleted", {
      action: undoAction(async () => {
        await rpc("messages.restore", { token: res.token });
        const chatId = useChat.getState().chatId;
        if (chatId) await loadChat(chatId);
        onChanged?.();
      }),
      duration: UNDO_DURATION,
    });
  } catch (e) {
    useChat.setState({ messages: before });
    toast.error((e as Error).message);
  }
  onChanged?.();
}

export async function patchMessage(msg: MessageV, patch: { bookmarked?: boolean; hidden?: boolean }) {
  useChat.setState((s) => ({ messages: s.messages.map((m) => (m.id === msg.id ? { ...m, ...patch } : m)) }));
  await rpc("messages.update", { id: msg.id, ...patch });
  onChanged?.();
}
