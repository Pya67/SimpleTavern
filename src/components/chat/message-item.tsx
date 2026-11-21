"use client";
import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "cn";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  EyeOff,
  FastForward,
  GitBranch,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Pin,
  RefreshCw,
  ScanSearch,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { rpc, type ProcOutput } from "@/lib/client/rpc";
import { EntityAvatar } from "@/components/common/avatar";
import { CHUNK_ANIM_MS, Markdown } from "@/components/chat/markdown";
import { MarkdownTextarea } from "@/components/common/markdown-textarea";
import {
  deleteMessage,
  editAndBranch,
  editMessage,
  generate,
  patchMessage,
  selectSibling,
  selectVersion,
  useChat,
  useStream,
} from "@/components/chat/chat-store";
import { useSmoothText } from "@/hooks/use-smooth-text";
import { formatCost, formatNum } from "@/lib/format";
import type { MessageV, PersonaT } from "@/lib/client/queries";
import type { GenError } from "@/lib/llm/errors";

export interface MessageCtx {
  character: { id: string; name: string; avatar: string | null; color: string | null };
  personas: Record<string, PersonaT>;
  currentPersonaId: string | null;
  layout: "bubbles" | "book";
  /** Avatar size in px for Bubbles; Book uses three quarters. */
  avatarSize: number;
  showStats: boolean;
  smoothing: boolean;
  onInspect: (id: string) => void;
  onFork: (id: string) => void;
  onPinFact: (m: MessageV) => void;
}

function IconBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={onClick}
            aria-label={label}
            className={cn(
              "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5",
              active && "text-brand",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export const MessageItem = memo(function MessageItem({ msg, isLast, ctx }: { msg: MessageV; isLast: boolean; ctx: MessageCtx }) {
  const editing = useChat((s) => s.editingId === msg.id);
  const generating = useChat((s) => !!s.generating);
  const highlighted = useChat((s) => s.highlightId === msg.id);
  // Keep the streaming view until its reveal animation has caught up, even after the stream ends.
  const streamingThis = useStream((s) => s.id === msg.id && (!s.done || !s.revealed));
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";
  const persona = msg.personaId ? ctx.personas[msg.personaId] : null;
  const name = isUser ? (persona?.name ?? "You") : isSystem ? "Narrator" : ctx.character.name;
  const book = ctx.layout === "book";
  const avatarPx = book ? Math.round(ctx.avatarSize * 0.75) : ctx.avatarSize;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (isSystem) {
    return (
      <div className="group/msg relative mx-auto flex max-w-[680px] items-center gap-3 px-4 py-2">
        <div className="h-px flex-1 bg-border" />
        <div className="max-w-[80%] text-center text-sm italic text-muted-foreground">
          <Markdown text={msg.content} />
        </div>
        <div className="h-px flex-1 bg-border" />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 opacity-0 transition-opacity group-hover/msg:opacity-100">
          <IconBtn label="Edit" onClick={() => useChat.setState({ editingId: msg.id })}>
            <Pencil />
          </IconBtn>
          <IconBtn label="Delete" onClick={() => deleteMessage(msg)}>
            <Trash2 />
          </IconBtn>
        </div>
      </div>
    );
  }

  const avatar = isUser ? (
    <EntityAvatar name={persona?.name ?? "You"} src={persona?.avatar} color={persona?.color} size={avatarPx} />
  ) : (
    <EntityAvatar name={ctx.character.name} src={ctx.character.avatar} color={ctx.character.color} size={avatarPx} />
  );

  const toolbar = !editing && msg.status !== "streaming" && (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-lg opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100 max-md:opacity-100",
        isUser && !book && "flex-row-reverse",
      )}
    >
      <IconBtn label={copied ? "Copied" : "Copy"} onClick={copy}>
        {copied ? <Check /> : <Copy />}
      </IconBtn>
      <IconBtn label="Edit" onClick={() => useChat.setState({ editingId: msg.id })}>
        <Pencil />
      </IconBtn>
      {!isUser && msg.parentId && (
        <IconBtn label="Regenerate" onClick={() => generate({ mode: "regenerate", targetId: msg.id })}>
          <RefreshCw />
        </IconBtn>
      )}
      {!isUser && isLast && (
        <IconBtn label="Continue" onClick={() => generate({ mode: "continue", targetId: msg.id })}>
          <FastForward />
        </IconBtn>
      )}
      <IconBtn label={msg.bookmarked ? "Remove bookmark" : "Bookmark"} active={msg.bookmarked} onClick={() => patchMessage(msg, { bookmarked: !msg.bookmarked })}>
        {msg.bookmarked ? <BookmarkCheck /> : <Bookmark />}
      </IconBtn>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<button aria-label="More" className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5" />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent appearance="grain" align={isUser ? "end" : "start"} sideOffset={8} className="w-52">
          <DropdownMenuItem onClick={() => ctx.onPinFact(msg)}>
            <Pin /> Pin as fact…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => ctx.onFork(msg.id)}>
            <GitBranch /> Fork chat from here
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => patchMessage(msg, { hidden: !msg.hidden })}>
            <EyeOff /> {msg.hidden ? "Include in context" : "Hide from context"}
          </DropdownMenuItem>
          {!isUser && (
            <DropdownMenuItem onClick={() => ctx.onInspect(msg.id)}>
              <ScanSearch /> Inspect prompt
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => deleteMessage(msg)}>
            <Trash2 /> Delete{isLast ? "" : " (and after)"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const body = msg.status === "streaming" || streamingThis ? (
    <StreamingBody msg={msg} ctx={ctx} />
  ) : (
    <>
      {msg.reasoning && <ReasoningBlock text={msg.reasoning} live={false} />}
      {msg.content ? (
        <Markdown text={msg.content} animate={ctx.smoothing} animateKey={msg.id} />
      ) : msg.status !== "error" && !(msg.finishReason === "length" && msg.reasoning) ? (
        <span className="text-sm italic text-muted-foreground">(empty)</span>
      ) : null}
      {msg.status === "error" && <ErrorBox msg={msg} />}
      {msg.status === "stopped" && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Square className="size-3" /> Stopped{msg.finishReason === "interrupted" ? " (interrupted)" : ""}
          {isLast && (
            <button className="font-medium text-brand hover:underline" onClick={() => generate({ mode: "continue", targetId: msg.id })}>
              Continue
            </button>
          )}
        </div>
      )}
      {msg.finishReason === "length" && !msg.content && msg.reasoning ? (
        <div className="mt-1 flex items-start gap-2.5 rounded-lg bg-muted/60 p-3 text-sm">
          <Brain className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Ran out of tokens while thinking</div>
            <div className="mt-0.5 text-muted-foreground">The model used its whole budget on reasoning. Raise Max response tokens or lower the reasoning effort, then retry.</div>
          </div>
          {msg.parentId && (
            <Button size="sm" variant="outline" onClick={() => generate({ mode: "regenerate", targetId: msg.id })}>
              <RefreshCw /> Retry
            </Button>
          )}
        </div>
      ) : msg.finishReason === "length" && isLast && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          Reply hit the token limit.
          <button className="font-medium text-brand hover:underline" onClick={() => generate({ mode: "continue", targetId: msg.id })}>
            Continue
          </button>
        </div>
      )}
    </>
  );

  const showSwipes = msg.siblingIds.length > 1 || (!isUser && isLast && !!msg.parentId && msg.status !== "streaming");

  return (
    <div
      className={cn(
        "group/msg relative px-3 py-2.5 md:px-6",
        msg.hidden && "opacity-50",
        "transition-colors duration-700",
        highlighted && "rounded-xl bg-brand/6",
      )}
      data-message-id={msg.id}
    >
      <div className={cn("mx-auto flex w-full max-w-(--chat-width) gap-3", isUser && !book && "flex-row-reverse")}>
        <div className="shrink-0">{avatar}</div>
        <div className={cn("flex min-w-0 flex-1 flex-col", isUser && !book && "items-end")}>
          {/* Name sits level with the top of the avatar; stats live in the row under the message. */}
          <div className={cn("mb-1 flex min-h-6 items-center gap-2", isUser && !book && "flex-row-reverse")}>
            <span className={cn("font-semibold leading-tight text-foreground", book ? "text-sm" : "text-[15px]")}>{name}</span>
            {msg.hidden && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <EyeOff className="size-3" /> hidden
              </span>
            )}
            {msg.bookmarked && <BookmarkCheck className="size-3.5 text-brand" />}
          </div>
          <div
            className={cn(
              "relative min-w-0",
              !book && isUser ? "max-w-[min(85%,640px)]" : "w-full",
              // Your messages sit in a soft, theme-tinted bubble tucked under the avatar.
              !book && isUser && "grain bubble-user rounded-2xl rounded-tr-md bg-bubble-user px-4 py-2.5",
              isUser && "user-msg",
            )}
          >
            <SwipeSlide msg={msg} isLast={isLast}>{body}</SwipeSlide>
          </div>
          <div className={cn("mt-1 flex min-h-7 items-center gap-1", isUser && !book && "flex-row-reverse")}>
            {showSwipes && <SwipeControls msg={msg} isLast={isLast} disabled={generating} />}
            {toolbar}
            {ctx.showStats && !isUser && msg.status === "complete" && !editing && <Stats msg={msg} />}
            {/* Live speed/time sits in this fixed-height row, so it never changes the message's height. */}
            {!isUser && streamingThis && <StreamStats id={msg.id} />}
          </div>
        </div>
      </div>
    </div>
  );
});

function SwipeSlide({ msg, isLast, children }: { msg: MessageV; isLast: boolean; children: React.ReactNode }) {
  const dir = useChat((s) => s.swipeDir[msg.depth] ?? 0);
  // Key by version slot, not id: the optimistic "tmp-" id is swapped for the real one mid-stream,
  // and that must not replay the enter animation.
  const slot = `${msg.depth}:${Math.max(0, msg.siblingIds.indexOf(msg.id))}`;
  const canSwipe = msg.siblingIds.length > 1 || (msg.role === "assistant" && isLast && !!msg.parentId);
  return (
    <AnimatePresence mode="popLayout" initial={false} custom={dir}>
      <motion.div
        // Touch swipe between versions (horizontal pan; mouse drags are ignored so text stays selectable).
        onPanEnd={(e, info) => {
          if (!canSwipe || (e as PointerEvent).pointerType !== "touch") return;
          if (Math.abs(info.offset.x) < 60 || Math.abs(info.offset.y) > 40) return;
          void selectSibling(msg, info.offset.x < 0 ? 1 : -1);
        }}
        style={{ touchAction: canSwipe ? "pan-y" : undefined }}
        key={slot}
        custom={dir}
        variants={{
          enter: (d: number) => ({ opacity: 0, x: d * 48 }),
          center: { opacity: 1, x: 0 },
          exit: (d: number) => ({ opacity: 0, x: d * -48 }),
        }}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ type: "spring", stiffness: 500, damping: 40 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function SwipeControls({ msg, isLast, disabled }: { msg: MessageV; isLast: boolean; disabled: boolean }) {
  const idx = msg.siblingIds.indexOf(msg.id);
  const count = msg.siblingIds.length;
  const atEnd = idx === count - 1;
  const canGenerate = msg.role === "assistant" && isLast && !!msg.parentId;
  return (
    <div className="flex items-center rounded-lg text-xs text-muted-foreground">
      <button
        disabled={disabled || idx <= 0}
        onClick={() => selectSibling(msg, -1)}
        className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
        aria-label="Previous version"
      >
        <ChevronLeft className="size-4" />
      </button>
      <VersionPicker msg={msg} disabled={disabled || count < 2}>
        {Math.max(1, idx + 1)}/{Math.max(1, count)}
      </VersionPicker>
      <button
        disabled={disabled || (atEnd && !canGenerate)}
        onClick={() => selectSibling(msg, 1)}
        className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
        aria-label={atEnd ? "Generate another" : "Next version"}
      >
        {atEnd && canGenerate ? <RefreshCw className="size-3.5" /> : <ChevronRight className="size-4" />}
      </button>
      {msg.role === "user" && count > 1 && <GitBranch className="ml-0.5 size-3 opacity-60" />}
    </div>
  );
}

function VersionPicker({ msg, disabled, children }: { msg: MessageV; disabled: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const chatId = useChat((s) => s.chatId);
  const [versions, setVersions] = useState<ProcOutput<"chats.tree"> | null>(null);
  useEffect(() => {
    if (!open || !chatId) return;
    let alive = true;
    void rpc("chats.tree", { id: chatId, messageId: msg.id }).then((v) => alive && setVersions(v));
    return () => {
      alive = false;
    };
  }, [open, chatId, msg.id]);
  if (disabled) return <span className="min-w-9 text-center tabular-nums">{children}</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button className="min-w-9 rounded-md px-1 py-0.5 text-center tabular-nums transition-colors hover:bg-accent hover:text-foreground" aria-label="Show all versions" />}>
        {children}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 p-1.5">
        <div className="px-2 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">{msg.role === "user" ? "Branches from here" : "Versions"}</div>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {(versions ?? msg.siblingIds.map((id) => ({ id, preview: "", descendants: 0, createdAt: "" }))).map((v, i) => (
            <button
              key={v.id}
              onClick={() => {
                setOpen(false);
                void selectVersion(msg, v.id);
              }}
              className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent", v.id === msg.id && "bg-brand/10")}
            >
              <span className="mt-px w-5 shrink-0 tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="line-clamp-2 flex-1 text-foreground/90">{v.preview || "…"}</span>
              {v.descendants > 0 && (
                <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground" title={`${v.descendants} messages after this`}>
                  <GitBranch className="size-3" />
                  {v.descendants}
                </span>
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StreamingBody({ msg, ctx }: { msg: MessageV; ctx: MessageCtx }) {
  const text = useStream((s) => (s.id === msg.id ? s.text : msg.content));
  const reasoning = useStream((s) => (s.id === msg.id ? s.reasoning : (msg.reasoning ?? "")));
  const done = useStream((s) => s.id !== msg.id || s.done);
  // For "continue", the existing text is already on screen: start from it instead of retyping it.
  const [settled] = useState(() => (done ? "" : text));
  const shown = useSmoothText(text, !done, ctx.smoothing, settled);
  const caughtUp = done && shown === text;
  useEffect(() => {
    if (!caughtUp) return;
    // Let the last chunks finish animating before handing over to the final view.
    const t = setTimeout(() => useStream.getState().id === msg.id && useStream.setState({ revealed: true }), CHUNK_ANIM_MS + 100);
    return () => clearTimeout(t);
  }, [caughtUp, msg.id]);
  const waiting = !text && !reasoning;
  return (
    <SmoothHeight enabled={ctx.smoothing}>
      {reasoning && <ReasoningBlock text={reasoning} live={!text && !done} />}
      {/* Plain conditional (no exit animation): an AnimatePresence swap here could leave the
          dots stuck on screen while reasoning tokens re-render the message rapidly. */}
      {waiting && !done ? (
        <TypingDots color={ctx.character.color} />
      ) : (
        <Markdown text={shown} streaming={!done || shown.length < text.length} animate={ctx.smoothing} animateKey={msg.id} settled={settled} />
      )}
    </SmoothHeight>
  );
}

/**
 * Glides the box's height toward its content's height instead of snapping a whole line at a time.
 * The chat list follows this element's size every frame, so the conversation scrolls continuously
 * while a reply streams rather than jumping up one line per wrap.
 */
function SmoothHeight({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const outer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = inner.current;
    const box = outer.current;
    if (!el || !box || !enabled) return;
    let current = el.offsetHeight;
    let target = current;
    let raf = 0;
    let last = 0;
    box.style.height = `${current}px`;
    const step = (t: number) => {
      const dt = last ? Math.min(64, t - last) : 16;
      last = t;
      // Critically-damped-ish approach: covers ~63% of the remaining gap every ~110ms.
      const k = 1 - Math.exp(-dt / 110);
      current += (target - current) * k;
      if (Math.abs(target - current) < 0.5) current = target;
      box.style.height = `${current}px`;
      if (current !== target) raf = requestAnimationFrame(step);
      else {
        raf = 0;
        last = 0;
      }
    };
    const ro = new ResizeObserver(() => {
      target = el.offsetHeight;
      // Shrinking (e.g. the thinking box collapsing) shouldn't hide content: follow immediately.
      if (target < current) {
        current = target;
        box.style.height = `${current}px`;
      }
      if (!raf && current !== target) raf = requestAnimationFrame(step);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      box.style.height = "";
    };
  }, [enabled]);
  return (
    <div ref={outer} className={enabled ? "overflow-hidden" : undefined}>
      <div ref={inner} className="flow-root">
        {children}
      </div>
    </div>
  );
}

/** Shown until the first token; after a few seconds it says how long we've been waiting. */
function TypingDots({ color }: { color?: string | null }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex h-6 items-center gap-1 px-0.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="typing-dot size-1.5 rounded-full" style={{ background: color ?? "var(--brand)" }} />
      ))}
      {secs >= 4 && <span className="ml-2 text-[11px] tabular-nums text-muted-foreground/70">Waiting for the model · {secs}s</span>}
    </motion.div>
  );
}

function StreamStats({ id }: { id: string }) {
  const text = useStream((s) => (s.id === id && !s.done ? s.text : ""));
  const firstAt = useStream((s) => (s.id === id ? s.firstAt : null));
  if (!text) return null;
  return <LiveStats text={text} firstAt={firstAt} />;
}

function LiveStats({ text, firstAt }: { text: string; firstAt: number | null }) {
  const [now, setNow] = useState(() => performance.timeOrigin + performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!firstAt) return null;
  const secs = Math.max(0, (now - firstAt) / 1000);
  const toks = text.length / 3.7;
  return (
    <div className="ml-1 text-[11px] tabular-nums text-muted-foreground/70">
      {secs > 0.3 ? `${Math.round(toks / secs)} tok/s · ` : ""}
      {secs.toFixed(1)}s
    </div>
  );
}

function Stats({ msg }: { msg: MessageV }) {
  const tps = msg.completionTokens && msg.genMs && msg.ttftMs != null ? msg.completionTokens / Math.max(0.1, (msg.genMs - msg.ttftMs) / 1000) : null;
  return (
    <span className="ml-1 flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-foreground/70 opacity-0 transition-opacity group-hover/msg:opacity-100">
      {msg.modelId && <span className="max-w-40 truncate">{msg.modelId.split("/").pop()}</span>}
      {msg.completionTokens != null && <span>· {formatNum(msg.completionTokens)} tok</span>}
      {tps != null && <span>· {Math.round(tps)} tok/s</span>}
      {msg.cost != null && msg.cost > 0 && <span>· {formatCost(msg.cost)}</span>}
    </span>
  );
}

function ReasoningBlock({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(live);
  const [elapsed, setElapsed] = useState(0);
  const [wasLive, setWasLive] = useState(live);
  // Auto-expand while thinking, auto-collapse when the answer starts.
  if (wasLive !== live) {
    setWasLive(live);
    setOpen(live);
  }
  useEffect(() => {
    if (!live) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(t);
  }, [live]);
  // While thinking, keep the window pinned to the newest lines (unless the user scrolled up to read).
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (live && open && el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text, live, open]);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const size = words >= 1000 ? `${(words / 1000).toFixed(1)}k words` : `${words} words`;
  return (
    <div className="mb-2">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <Brain className="size-3" />
        {live ? <span className="shimmer-text font-medium">Thinking… {elapsed.toFixed(1)}s</span> : <span>Thought process</span>}
        {words > 0 && <span className="tabular-nums text-muted-foreground/60">· {size}</span>}
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              }}
              className={cn(
                "mt-2 overflow-y-auto overscroll-contain rounded-lg border bg-muted/30 px-3 py-2",
                // Live: a short ticker that fades out at the top, so it doesn't shove the reply down.
                live ? "max-h-40 [mask-image:linear-gradient(to_bottom,transparent,black_2.5rem)]" : "max-h-[min(24rem,50vh)]",
              )}
            >
              <Markdown text={text} variant="plain" animate={false} streaming={live} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ErrorBox({ msg }: { msg: MessageV }) {
  let err: GenError | null = null;
  try {
    err = msg.error ? JSON.parse(msg.error) : null;
  } catch {}
  return (
    <div className="mt-1 flex items-start gap-2.5 rounded-lg bg-destructive/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-destructive">{err?.message ?? "Generation failed"}</div>
        {err?.hint && <div className="mt-0.5 text-muted-foreground">{err.hint}</div>}
      </div>
      {msg.parentId && (
        <Button size="sm" variant="outline" onClick={() => generate({ mode: "regenerate", targetId: msg.id })}>
          <RefreshCw /> Retry
        </Button>
      )}
    </div>
  );
}

/**
 * One editor per chat, opened by setting `editingId` in the chat store.
 */
export function EditMessageDialog({ ctx }: { ctx: MessageCtx }) {
  const editingId = useChat((s) => s.editingId);
  const msg = useChat((s) => (s.editingId ? s.messages.find((m) => m.id === s.editingId) : undefined));
  const close = () => useChat.setState({ editingId: null });
  return (
    <Dialog open={!!editingId && !!msg} onOpenChange={(o) => !o && close()}>
      <DialogContent className="grain borderless-controls flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 shadow-2xl ring-transparent sm:max-w-2xl">
        {msg && <EditMessageBody key={msg.id} msg={msg} ctx={ctx} onClose={close} />}
      </DialogContent>
    </Dialog>
  );
}

function EditMessageBody({ msg, ctx, onClose }: { msg: MessageV; ctx: MessageCtx; onClose: () => void }) {
  const [text, setText] = useState(msg.content);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // After the dialog's focus handling: put the caret at the end of the text.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";
  const EditorIcon = isSystem ? Megaphone : Pencil;
  const persona = msg.personaId ? ctx.personas[msg.personaId] : null;
  const name = isUser ? (persona?.name ?? "You") : isSystem ? "Narrator" : ctx.character.name;
  const changed = text !== msg.content;
  const save = () => {
    if (!changed) return onClose();
    void editMessage(msg, text);
  };
  const branch = () => {
    if (!text.trim()) return;
    void editAndBranch(msg, text, msg.personaId);
  };

  return (
    <>
      <DialogHeader className="shrink-0 gap-1 px-5 pt-4 pr-12 pb-2">
        <DialogTitle className="flex items-center gap-2 text-sm">
          <EditorIcon className="size-4 shrink-0 text-brand" aria-hidden />
          {isSystem ? "Edit narrator line" : "Edit message"}
        </DialogTitle>
        <DialogDescription className="sr-only">Update the text of this chat message.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto px-5 pt-2 pb-4">
        <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
          <div className="shrink-0">
            {isSystem ? (
              <span className="surface-well flex size-10 items-center justify-center rounded-full text-muted-foreground">
                <Megaphone className="size-4" />
              </span>
            ) : isUser ? (
              <EntityAvatar name={name} src={persona?.avatar} color={persona?.color} size={40} />
            ) : (
              <EntityAvatar name={name} src={ctx.character.avatar} color={ctx.character.color} size={40} />
            )}
          </div>
          <div className={cn("flex min-w-0 flex-1 flex-col", isUser && "items-end")}>
            <div className="mb-1.5 flex min-h-6 items-center text-[15px] font-semibold leading-tight">{name}</div>
            <MarkdownTextarea
              ref={ref}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  if (isUser && e.shiftKey) branch();
                  else save();
                }
              }}
              aria-label={`Edit ${name}'s message`}
              boxClassName="surface-well w-full rounded-xl transition-shadow focus-within:ring-2 focus-within:ring-ring/60"
              className={cn(
                "field-sizing-content max-h-[min(55dvh,28rem)] min-h-24 px-3 py-2.5 text-[length:var(--chat-font-size,15px)] leading-relaxed",
                isSystem && "text-center italic text-muted-foreground",
              )}
            />
          </div>
        </div>
      </div>
      <DialogFooter className="m-0 shrink-0 flex-row flex-wrap items-center justify-end gap-1.5 bg-transparent px-5 py-3">
        <span className="mr-auto hidden text-[11px] text-muted-foreground sm:inline">Esc to cancel · Ctrl+Enter to save</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {isUser && (
          <Tooltip>
            <TooltipTrigger render={<Button size="sm" variant="ghost" onClick={branch} disabled={!text.trim()} />}>
              <GitBranch /> Save as branch & reply
            </TooltipTrigger>
            <TooltipContent>Keeps the original as another version (Ctrl+Shift+Enter)</TooltipContent>
          </Tooltip>
        )}
        <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={save} disabled={!text.trim()}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

export function copyToast(text: string) {
  void navigator.clipboard.writeText(text);
  toast.success("Copied");
}
