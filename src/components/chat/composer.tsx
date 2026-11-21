"use client";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "cn";
import { toast } from "sonner";
import { ArrowUp, Bold, Brain, Italic, Check, FastForward, Megaphone, Plus, Settings2, Square, StickyNote, Wand2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useModelEffort } from "@/components/common/model-effort";
import { EFFORT_OPTIONS } from "@/components/common/param-controls";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EntityAvatar } from "@/components/common/avatar";
import { ModelPicker } from "@/components/common/model-picker";
import { generate, selectSibling, stop, useChat } from "@/components/chat/chat-store";
import { useDrafts } from "@/stores/ui";
import { MarkdownTextarea } from "@/components/common/markdown-textarea";
import type { PersonaT } from "@/lib/client/queries";
import type { ReasoningEffort } from "@/lib/types";

export interface SlashCommand {
  name: string;
  hint: string;
  arg?: string;
}

export const SLASH: SlashCommand[] = [
  { name: "regen", hint: "Regenerate the last reply" },
  { name: "continue", hint: "Continue the last reply" },
  { name: "impersonate", hint: "Write your next message for you" },
  { name: "as", hint: "Switch persona", arg: "name" },
  { name: "sys", hint: "Narrator message (no reply)", arg: "text" },
  { name: "note", hint: "Set the author's note", arg: "text" },
  { name: "pin", hint: "Pin a fact to memory", arg: "text" },
  { name: "compact", hint: "Compact memory now" },
  { name: "model", hint: "Switch model" },
  { name: "preset", hint: "Switch preset" },
  { name: "inspect", hint: "Preview the next prompt" },
];

const menuSurface = "grain rounded-xl p-1.5 shadow-xl ring-transparent";

export interface ComposerHandle {
  focus: () => void;
  setText: (t: string) => void;
}

interface Props {
  chatId: string;
  personas: PersonaT[];
  personaId: string | null;
  onPersona: (id: string) => void;
  onSlash: (cmd: string, arg: string) => boolean | void;
  enterToSend: boolean;
  characterName: string;
  modelId?: string | null;
  onModel?: (id: string) => void;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ chatId, personas, personaId, onPersona, onSlash, enterToSend, characterName, modelId, onModel }, ref) {
  const draft = useDrafts((s) => s.drafts[chatId] ?? "");
  const setDraft = useDrafts((s) => s.setDraft);
  const [text, setTextState] = useState(draft);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const generating = useChat((s) => s.generating);
  const impersonation = useChat((s) => s.impersonation);
  const [slashIdx, setSlashIdx] = useState(0);
  const activeSlashRef = useRef<HTMLButtonElement>(null);
  const [personaOpen, setPersonaOpen] = useState(false);
  const persona = personas.find((p) => p.id === personaId) ?? personas[0];

  const setText = (t: string) => {
    setTextState(t);
    setDraft(chatId, t);
  };

  useEffect(() => {
    setTextState(useDrafts.getState().drafts[chatId] ?? "");
  }, [chatId]);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setText: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(t.length, t.length);
        }
      });
    },
  }));

  // Impersonation streams into the composer.
  useEffect(() => {
    if (!impersonation) return;
    setTextState(impersonation.text);
    if (impersonation.done) {
      setDraft(chatId, impersonation.text);
      useChat.setState({ impersonation: null });
      requestAnimationFrame(() => taRef.current?.focus());
    }
  }, [impersonation, chatId, setDraft]);

  /** Wrap the selection in a marker (or insert the pair with the cursor in the middle). */
  const wrapSelection = (mark: string) => {
    const el = taRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    pendingSel.current = [a + mark.length, b + mark.length];
    setText(`${value.slice(0, a)}${mark}${value.slice(a, b)}${mark}${value.slice(b)}`);
  };
  const insertBold = () => wrapSelection("**");
  const insertItalic = () => wrapSelection("*");
  // Restore the caret after React has committed the new value (otherwise it jumps to the end).
  const pendingSel = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const sel = pendingSel.current;
    const el = taRef.current;
    if (!sel || !el) return;
    pendingSel.current = null;
    el.focus();
    el.setSelectionRange(sel[0], sel[1]);
  }, [text]);

  const slashQuery = text.startsWith("/") && !text.includes("\n") ? text.slice(1).split(" ")[0].toLowerCase() : null;
  const slashMatches = useMemo(() => (slashQuery !== null && !text.includes(" ") ? SLASH.filter((c) => c.name.startsWith(slashQuery)) : []), [slashQuery, text]);
  useEffect(() => setSlashIdx(0), [slashQuery]);
  useEffect(() => {
    if (slashMatches.length) activeSlashRef.current?.scrollIntoView({ block: "nearest" });
  }, [slashIdx, slashMatches.length]);

  const submit = () => {
    const t = text.trim();
    if (generating) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.warning("You're offline", { description: "Your message will send automatically when you reconnect." });
      const onOnline = () => {
        window.removeEventListener("online", onOnline);
        setTimeout(() => {
          const current = useDrafts.getState().drafts[chatId] ?? "";
          setText("");
          void generate({ mode: "send", content: current.trim() || t, personaId: persona?.id });
        }, 400);
      };
      window.addEventListener("online", onOnline);
      return;
    }
    if (t.startsWith("/")) {
      const [cmd, ...rest] = t.slice(1).split(" ");
      const handled = onSlash(cmd.toLowerCase(), rest.join(" ").trim());
      if (handled !== false) {
        setText("");
        return;
      }
    }
    setText("");
    void generate({ mode: "send", content: t, personaId: persona?.id });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMatches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        const c = slashMatches[slashIdx];
        if (c && `/${c.name}` !== text.trim()) {
          e.preventDefault();
          setText(`/${c.name}${c.arg ? " " : ""}`);
          if (!c.arg && e.key === "Enter") {
            const handled = onSlash(c.name, "");
            if (handled !== false) setText("");
          }
          return;
        }
      }
      if (e.key === "Escape") {
        setText("");
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === "KeyB" || e.code === "KeyI")) {
      e.preventDefault();
      if (e.code === "KeyB") insertBold();
      else insertItalic();
      return;
    }
    // Empty composer: ← / → swipe between versions of the latest reply.
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !text && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const msgs = useChat.getState().messages;
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        e.preventDefault();
        void selectSibling(last, e.key === "ArrowRight" ? 1 : -1);
      }
      return;
    }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      const send = enterToSend ? !e.shiftKey : e.ctrlKey || e.metaKey;
      if (send) {
        e.preventDefault();
        submit();
      }
    }
    if (e.key === "ArrowUp" && !text) {
      const msgs = useChat.getState().messages;
      const lastUser = [...msgs].reverse().find((m) => m.role === "user");
      if (lastUser) {
        e.preventDefault();
        useChat.setState({ editingId: lastUser.id });
      }
    }
    if (e.key === "Escape" && generating) stop();
  };

  return (
    <div className="relative mx-auto w-full max-w-(--chat-width) px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] standalone:pb-3 md:w-[calc(100%-4rem)] md:px-6 md:has-[textarea:focus]:w-full md:has-[textarea:focus]:max-w-[calc(var(--chat-width)+4rem)] motion-safe:md:transition-[width,max-width] motion-safe:md:duration-300 motion-safe:md:ease-out">
      <AnimatePresence>
        {slashMatches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className={cn(menuSurface, "absolute bottom-full left-3 right-3 z-30 mb-2 max-h-[min(42dvh,24rem)] overflow-y-auto scroll-py-1.5 bg-popover text-popover-foreground md:left-6 md:right-6")}
          >
            {slashMatches.map((c, i) => (
              <button
                key={c.name}
                ref={i === slashIdx ? activeSlashRef : undefined}
                type="button"
                aria-current={i === slashIdx || undefined}
                onMouseMove={() => setSlashIdx(i)}
                onClick={() => {
                  setText(`/${c.name}${c.arg ? " " : ""}`);
                  taRef.current?.focus();
                  if (!c.arg) {
                    const handled = onSlash(c.name, "");
                    if (handled !== false) setText("");
                  }
                }}
                className={cn(
                  "flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                  i === slashIdx && "bg-brand/12",
                )}
              >
                <span className="flex shrink-0 items-baseline gap-1.5">
                  <code className="font-mono text-xs font-medium">/{c.name}</code>
                  {c.arg && <span className="text-[11px] text-muted-foreground">&lt;{c.arg}&gt;</span>}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{c.hint}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="surface-grain flex flex-col gap-1.5 rounded-2xl p-1.5 shadow-sm">
        <MarkdownTextarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={impersonation ? "Writing as you…" : `Message ${characterName}…  (/ for commands)`}
          boxClassName={cn("group rounded-xl transition-colors hover:bg-foreground/5", impersonation && "ring-2 ring-brand/30")}
          className="field-sizing-content max-h-[40dvh] min-h-11 px-3 py-2 text-[length:var(--chat-font-size,15px)] leading-relaxed md:group-has-[textarea:focus]:max-h-[48dvh] md:group-has-[textarea:focus]:min-h-24 md:group-has-[textarea:focus]:py-3.5 motion-safe:md:transition-[min-height,max-height,padding] motion-safe:md:duration-300 motion-safe:md:ease-out"
          aria-label="Message"
        />

        <div className="flex items-center gap-1 px-0.5 pb-0.5 max-[360px]:gap-0.5">
          <Popover open={personaOpen} onOpenChange={setPersonaOpen}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={
                      <Button variant="ghost" size="icon" className="max-md:size-9" aria-label="Switch persona" />
                    }
                  />
                }
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={persona?.id} initial={{ scale: 0.6, opacity: 0, rotate: -20 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.6, opacity: 0 }}>
                    {persona && <EntityAvatar name={persona.name} src={persona.avatar} color={persona.color} size={26} />}
                  </motion.span>
                </AnimatePresence>
              </TooltipTrigger>
              <TooltipContent>Speaking as {persona?.name} · Alt+P to cycle</TooltipContent>
            </Tooltip>
            <PopoverContent align="start" side="top" sideOffset={8} className={cn(menuSurface, "w-64 gap-0.5")}>
              <div className="px-2 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">Speak as…</div>
              {personas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onPersona(p.id);
                    setPersonaOpen(false);
                    taRef.current?.focus();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                >
                  <EntityAvatar name={p.name} src={p.avatar} color={p.color} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{p.description}</div>
                  </div>
                  {p.id === persona?.id && <Check className="size-4 text-brand" />}
                </button>
              ))}
              <Link href="/personas" className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                <Settings2 className="size-3.5" /> Manage personas
              </Link>
            </PopoverContent>
          </Popover>

          {/* Formatting buttons are for touch; desktop uses Ctrl+B / Ctrl+I. */}
          <Button
            variant="ghost"
            size="icon"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              keyTick();
              insertBold();
            }}
            aria-label="Bold"
            className="size-9 text-muted-foreground max-[360px]:size-8 md:hidden"
          >
            <Bold className="size-4" strokeWidth={2.75} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              keyTick();
              insertItalic();
            }}
            aria-label="Italic"
            className="size-9 text-muted-foreground max-[360px]:size-8 md:hidden"
          >
            <Italic className="size-4" strokeWidth={2.5} />
          </Button>

          {/* On mobile the model + effort pair sits on the right, next to the + menu. */}
          {modelId && onModel && <ModelPicker value={modelId} onChange={onModel} variant="chip" className="max-md:ml-auto" />}
          {modelId && <EffortMenu modelId={modelId} />}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" className={cn("text-muted-foreground max-md:size-9", modelId && onModel ? "md:ml-auto" : "ml-auto")} aria-label="More actions" />}
            >
              <Plus className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent appearance="grain" side="top" sideOffset={8} align="end" className="w-56">
              <DropdownMenuItem onClick={() => generate({ mode: "impersonate", personaId: persona?.id })}>
                <Wand2 /> Impersonate (write for me)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSlash("continue", "")}>
                <FastForward /> Continue last reply
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (text.trim()) {
                    void generate({ mode: "send", content: text.trim(), role: "system" });
                    setText("");
                  } else setText("/sys ");
                }}
              >
                <Megaphone /> Send as narrator
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSlash("note", "")}>
                <StickyNote /> Author&apos;s note…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <motion.button
            whileTap={{ scale: 0.92 }}
            // Always clickable: while generating (incl. impersonation with an empty box) it's the Stop button.
            onClick={() => (generating ? stop() : submit())}
            aria-label={generating ? "Stop" : "Send"}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40",
              generating ? "bg-foreground text-background" : "bg-brand text-brand-foreground hover:bg-brand/90",
            )}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {generating ? (
                <motion.span key="stop" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }}>
                  <Square className="size-3.5 fill-current" />
                </motion.span>
              ) : (
                <motion.span key="send" initial={{ scale: 0, y: 6 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0 }}>
                  <ArrowUp className="size-4" strokeWidth={2.5} />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </div>
      <div className="mt-1.5 hidden justify-center text-[11px] text-muted-foreground/60 md:flex">
        {text.trim() ? (enterToSend ? "Enter to send · Shift+Enter for newline" : "Ctrl+Enter to send") : "Empty send = let them keep talking · ↑ edits your last message"}
      </div>
    </div>
  );
});

/** A short haptic tick, like a key press on a phone keyboard (Android; iOS browsers don't support vibration). */
function keyTick() {
  try {
    navigator.vibrate?.(10);
  } catch {}
}

/** Quick per-model reasoning effort switch (only for models that can think). */
function EffortMenu({ modelId }: { modelId: string }) {
  const { effort, setEffort, supported } = useModelEffort(modelId);
  if (!supported) return null;
  const current = EFFORT_OPTIONS.find((o) => o.v === (effort ?? "default"));
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <button
                  aria-label="Reasoning effort"
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs outline-none transition-colors hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring/60 max-md:h-9",
                    effort && effort !== "none" ? "text-foreground" : "text-muted-foreground",
                  )}
                />
              }
            />
          }
        >
          <Brain className={cn("size-3.5", effort && effort !== "none" && "text-brand")} />
          {effort && <span className="hidden font-medium sm:inline">{current?.label}</span>}
        </TooltipTrigger>
        <TooltipContent>Reasoning effort{effort ? `: ${current?.label}` : " (preset)"}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent appearance="grain" side="top" sideOffset={8} align="start" className="w-auto min-w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2.5">Reasoning effort</DropdownMenuLabel>
          {EFFORT_OPTIONS.filter((o) => o.v !== "default").map((o) => (
            <DropdownMenuItem key={o.v} onClick={() => void setEffort(o.v as ReasoningEffort)} className="in-data-[appearance=grain]:gap-4 whitespace-nowrap">
              <span className="flex-1">{o.label === "Med" ? "Medium" : o.label === "Min" ? "Minimal" : o.label}</span>
              <span className="text-[11px] text-muted-foreground">{o.hint}</span>
              <Check className={cn("size-3.5 text-brand", effort !== o.v && "invisible")} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
