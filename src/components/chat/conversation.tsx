"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, Layers, Loader2 } from "lucide-react";
import { EntityAvatar } from "@/components/common/avatar";
import { EditMessageDialog, MessageItem, type MessageCtx } from "@/components/chat/message-item";
import { loadOlder, useChat } from "@/components/chat/chat-store";
import { useUi } from "@/stores/ui";

export function Conversation({ ctx, lastCoveredDepth, tagline }: { ctx: MessageCtx; lastCoveredDepth: number; tagline?: string }) {
  const messages = useChat((s) => s.messages);
  const loaded = useChat((s) => s.loaded);
  const loadingOlder = useChat((s) => s.loadingOlder);
  const highlightId = useChat((s) => s.highlightId);
  const chatId = useChat((s) => s.chatId);
  const generating = useChat((s) => !!s.generating);
  const parentRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  const [unread, setUnread] = useState(0);
  const lastCount = useRef(messages.length);
  const setUi = useUi((s) => s.set);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (messages[i]?.content.length ?? 200) / 2.2 + 90,
    getItemKey: (i) => messages[i]?.depth ?? i,
    overscan: 6,
    anchorTo: "end",
    followOnAppend: "smooth",
    paddingStart: 8,
    paddingEnd: 24,
  });

  // Jump to the bottom (or the highlighted message) when a chat loads.
  const didInit = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!loaded || !chatId || didInit.current === chatId || !messages.length) return;
    didInit.current = chatId;
    const hi = highlightId ? messages.findIndex((m) => m.id === highlightId) : -1;
    requestAnimationFrame(() => {
      if (hi >= 0) virtualizer.scrollToIndex(hi, { align: "center" });
      else virtualizer.scrollToEnd();
    });
    if (hi >= 0) setTimeout(() => useChat.setState({ highlightId: null }), 2600);
  }, [loaded, chatId, messages, highlightId, virtualizer]);

  // Explicit jumps (bookmarks, search results).
  const jumpTo = useChat((s) => s.jumpTo);
  useEffect(() => {
    if (!jumpTo) return;
    const idx = useChat.getState().messages.findIndex((m) => m.id === jumpTo.id);
    if (idx >= 0) requestAnimationFrame(() => virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" }));
  }, [jumpTo, virtualizer]);

  // Unread counter for the jump pill.
  useEffect(() => {
    if (messages.length > lastCount.current && !atEnd) setUnread((u) => u + (messages.length - lastCount.current));
    lastCount.current = messages.length;
  }, [messages.length, atEnd]);

  const onScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const end = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtEnd(end);
    if (end) setUnread(0);
    if (el.scrollTop < 600) void loadOlder();
  }, []);

  // Track the visible height so the newest reply can be given about a screen of room.
  const reserveDepth = useChat((s) => s.reserveDepth);
  const [viewportH, setViewportH] = useState(0);
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  const items = virtualizer.getVirtualItems();
  const first = messages[0];
  /**
   * Room for the reply being generated: enough to fill the screen below the message before it
   * (so that message sits near the top). The reply grows into this space, so streaming, the
   * thinking box and its collapse don't move the rest of the conversation at all.
   */
  const reserveFor = (index: number) => {
    const m = messages[index];
    if (!m || m.depth !== reserveDepth || index !== messages.length - 1 || m.role !== "assistant" || !viewportH) return undefined;
    const prev = index > 0 ? (virtualizer.measurementsCache[index - 1]?.size ?? 0) : 0;
    const room = viewportH - prev - 24 /* paddingEnd */ - 8;
    return Math.max(0, Math.min(room, viewportH - 120));
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={parentRef} onScroll={onScroll} className="h-full overflow-y-auto overflow-x-hidden overscroll-contain [overflow-anchor:none]" style={{ contain: "strict" }}>
        {!loaded ? (
          <ConversationSkeleton />
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {items.map((vi) => {
              const m = messages[vi.index];
              if (!m) return null;
              return (
                <div key={vi.key} data-index={vi.index} ref={virtualizer.measureElement} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${vi.start}px)` }}>
                  {vi.index === 0 && first?.depth === 0 && <ChatIntro ctx={ctx} tagline={tagline} />}
                  {vi.index === 0 && first && first.depth > 0 && (
                    <div className="flex h-12 items-center justify-center text-xs text-muted-foreground">{loadingOlder ? <Loader2 className="size-4 animate-spin" /> : "Scroll up for earlier messages"}</div>
                  )}
                  <motion.div
                    // New messages fly in from their own side (user from the right, character from the left).
                    initial={m.id.startsWith("tmp-") ? { opacity: 0, y: 36, x: m.role === "user" && ctx.layout !== "book" ? 40 : -40, scale: 0.97 } : false}
                    animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.9, opacity: { duration: 0.18 } }}
                    style={{ minHeight: reserveFor(vi.index) }}
                  >
                    <MessageItem msg={m} isLast={vi.index === messages.length - 1} ctx={ctx} />
                  </motion.div>
                  {m.depth === lastCoveredDepth && vi.index !== messages.length - 1 && (
                    <button
                      onClick={() => setUi(window.matchMedia("(max-width: 767px)").matches ? { mobilePanelOpen: true, panelTab: "memory" } : { panelOpen: true, panelTab: "memory" })}
                      className="group mx-auto my-3 flex w-full max-w-(--chat-width) items-center gap-3 px-6 text-[11px] text-muted-foreground"
                    >
                      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-border" />
                      <span className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 transition-colors group-hover:border-brand/40 group-hover:text-foreground">
                        <Layers className="size-3" /> Messages above are summarized in memory · View
                      </span>
                      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-border" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <EditMessageDialog ctx={ctx} />
      {/* Screen readers: announce generation state without reading every token. */}
      <div className="sr-only" aria-live="polite" role="status">
        {generating ? `${ctx.character.name} is replying…` : ""}
      </div>
      <AnimatePresence>
        {loaded && !atEnd && (
          <motion.button
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            onClick={() => {
              virtualizer.scrollToEnd({ behavior: "smooth" });
              setUnread(0);
            }}
            className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-popover/90 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur transition-colors hover:bg-accent"
          >
            <ArrowDown className="size-3.5" />
            {unread > 0 ? `${unread} new message${unread > 1 ? "s" : ""}` : "Jump to latest"}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChatIntro({ ctx, tagline }: { ctx: MessageCtx; tagline?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-2 px-6 pb-6 pt-10 text-center">
      <EntityAvatar name={ctx.character.name} src={ctx.character.avatar} color={ctx.character.color} size={72} />
      <div className="text-lg font-semibold">{ctx.character.name}</div>
      {tagline && <div className="max-w-md text-sm text-muted-foreground">{tagline}</div>}
    </motion.div>
  );
}

export function ConversationSkeleton() {
  return (
    <div className="mx-auto max-w-(--chat-width) space-y-6 px-6 py-10">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`flex gap-3 ${i % 2 ? "flex-row-reverse" : ""}`} style={{ opacity: 1 - i * 0.18 }}>
          <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className={`space-y-2 ${i % 2 ? "w-1/2" : "w-3/4"}`}>
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="h-16 animate-pulse rounded-2xl bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
