"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, ChevronDown, Loader2, MessageSquarePlus, Pencil, Plus } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EntityAvatar } from "@/components/common/avatar";
import { Markdown } from "@/components/chat/markdown";
import { qk, useLorebooks, type ChatInfo, type PersonaT } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";

const MACRO = /\{\{\s*(char|user)\s*\}\}/gi;

/** Plain text with {{char}} / {{user}} swapped for the names, highlighted in the theme colour. */
function withNames(text: string, names: { char: string; user: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MACRO)) {
    out.push(text.slice(last, m.index));
    out.push(
      <span key={m.index} data-macro={`{{${m[1].toLowerCase()}}}`} className="font-medium text-brand">
        {m[1].toLowerCase() === "char" ? names.char : names.user}
      </span>,
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/** Same for markdown: the names become inline spans the markdown renderer allows. */
function withNamesMd(text: string, names: { char: string; user: string }) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.replace(
    MACRO,
    (_m, k: string) => `<span data-macro="{{${k.toLowerCase()}}}" class="font-medium text-brand">${esc(k.toLowerCase() === "char" ? names.char : names.user)}</span>`,
  );
}

/** One shared hover tooltip for every highlighted name: shows the macro it stands for. */
function useMacroTooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const handlers = {
    onMouseOver: (e: React.MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-macro]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      setTip({ text: el.dataset.macro ?? "", x: r.left + r.width / 2, y: r.top });
    },
    onMouseOut: (e: React.MouseEvent) => {
      const from = (e.target as HTMLElement).closest("[data-macro]");
      const to = (e.relatedTarget as HTMLElement | null)?.closest?.("[data-macro]");
      if (from && from !== to) setTip(null);
    },
  };
  const node =
    tip &&
    createPortal(
      <div
        style={{ left: tip.x, top: tip.y - 6 }}
        className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full animate-in fade-in-0 zoom-in-95 rounded-md bg-foreground px-2 py-1 font-mono text-xs text-background"
      >
        {tip.text}
      </div>,
      document.body,
    );
  return { handlers, node };
}

export function CharacterPanel({ info, userName }: { info: ChatInfo; userName: string }) {
  const c = info.character;
  const names = { char: c.name, user: userName };
  const macroTip = useMacroTooltip();
  return (
    <div className="space-y-5" {...macroTip.handlers}>
      {macroTip.node}
      <div className="flex flex-col items-center gap-3 text-center">
        <EntityAvatar name={c.name} src={c.avatar} color={c.color} size={88} />
        <div>
          <div className="text-lg font-semibold">{c.name}</div>
          {c.tagline && <div className="text-sm text-muted-foreground">{c.tagline}</div>}
        </div>
        {!!c.tags.length && (
          <div className="flex flex-wrap justify-center gap-1">
            {c.tags.map((t) => (
              <span key={t} className="surface-well rounded-full px-2 py-0.5 text-[11px] text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="outline" render={<Link href={`/characters/${c.id}`} />}>
            <Pencil /> Edit character
          </Button>
          <NewChatButton characterId={c.id} />
        </div>
      </div>
      {(c.description || c.personality || c.scenario || c.creatorNotes) && (
        <div className="surface-grain space-y-0.5 rounded-xl p-1">
          {c.description && (
            <InfoAccordion title="Description" text={c.description} names={names}>
              <div className="text-sm text-foreground/85">
                <Markdown text={withNamesMd(c.description, names)} />
              </div>
            </InfoAccordion>
          )}
          {c.personality && (
            <InfoAccordion title="Personality" text={c.personality} names={names}>
              <p className="whitespace-pre-wrap text-sm text-foreground/85">{withNames(c.personality, names)}</p>
            </InfoAccordion>
          )}
          {c.scenario && (
            <InfoAccordion title="Scenario" text={c.scenario} names={names}>
              <p className="whitespace-pre-wrap text-sm text-foreground/85">{withNames(c.scenario, names)}</p>
            </InfoAccordion>
          )}
          {c.creatorNotes && (
            <InfoAccordion title="Creator notes" text={c.creatorNotes} names={names}>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{withNames(c.creatorNotes, names)}</p>
            </InfoAccordion>
          )}
        </div>
      )}
    </div>
  );
}

/** One collapsible section of the character sheet: title + a one-line preview while closed. */
function InfoAccordion({ title, text, names, children }: { title: string; text: string; names: { char: string; user: string }; children: React.ReactNode }) {
  const words = text.trim().split(/\s+/).length;
  const preview = text.replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim();
  return (
    <Collapsible className="group/acc">
      <CollapsibleTrigger className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-foreground/5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{title}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{words} words</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground/80 group-data-[open]/acc:hidden">{withNames(preview, names)}</div>
        </div>
        <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[open]/acc:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
        <div className="px-2.5 pb-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Starts a fresh chat with this character (the current one stays in the sidebar). */
function NewChatButton({ characterId }: { characterId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await rpc("chats.create", { characterId });
          qc.invalidateQueries({ queryKey: qk.chats });
          router.push(`/chats/${r.id}`);
        } catch (e) {
          toast.error((e as Error).message);
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />} New chat
    </Button>
  );
}

export function PersonaPanel({ personas, currentId, onSelect }: { personas: PersonaT[]; currentId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="px-1 text-xs text-muted-foreground">Who you&apos;re speaking as. You can switch mid-scene.</p>
      <div className="space-y-1.5">
        {personas.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            aria-pressed={p.id === currentId}
            className={cn("surface-grain flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors hover:bg-accent", p.id === currentId && "bg-brand/12 hover:bg-brand/15")}
          >
            <EntityAvatar name={p.name} src={p.avatar} color={p.color} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {p.name}
                {p.pronouns && <span className="text-xs font-normal text-muted-foreground">{p.pronouns}</span>}
              </div>
              <div className="line-clamp-3 text-xs text-muted-foreground">{p.description}</div>
            </div>
            {p.id === currentId && <Check className="size-4 shrink-0 text-brand" />}
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" className="w-full text-muted-foreground" render={<Link href="/personas" />}>
        <Plus /> Manage personas
      </Button>
    </div>
  );
}

export function LorePanel({ info }: { info: ChatInfo }) {
  const { data: books } = useLorebooks();
  const qc = useQueryClient();
  const charBooks = new Set(info.characterLorebookIds ?? []);
  const toggle = async (id: string) => {
    const next = info.lorebookIds.includes(id) ? info.lorebookIds.filter((x) => x !== id) : [...info.lorebookIds, id];
    qc.setQueryData<ChatInfo>(qk.chat(info.chat.id), (old) => (old ? { ...old, lorebookIds: next } : old));
    await rpc("chats.update", { id: info.chat.id, lorebookIds: next });
    qc.invalidateQueries({ queryKey: qk.chat(info.chat.id) });
  };
  return (
    <div className="space-y-4">
      <p className="px-1 text-xs text-muted-foreground">
        Checked lorebooks add world info when their keywords come up. Books linked to {info.character.name} are always on; change those on the character.
      </p>
      {!books?.length && (
        <div className="surface-well rounded-xl p-4 text-center text-sm text-muted-foreground">
          No lorebooks yet.
          <Button size="sm" variant="outline" className="mt-2 w-full" render={<Link href="/lorebooks" />}>
            <BookOpen /> Create a lorebook
          </Button>
        </div>
      )}
      <div className="space-y-1.5">
        {books?.map((b) => {
          const fromChar = charBooks.has(b.id);
          const on = fromChar || info.lorebookIds.includes(b.id);
          return (
            <button
              key={b.id}
              disabled={fromChar}
              title={fromChar ? `Linked to ${info.character.name}. Change it on the character.` : undefined}
              onClick={() => toggle(b.id)}
              aria-pressed={on}
              className={cn(
                "surface-grain flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-accent disabled:cursor-default",
                on && "bg-brand/12 hover:bg-brand/15",
              )}
            >
              <BookOpen className={cn("size-4 shrink-0", on ? "text-brand" : "text-muted-foreground")} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{b.name}</div>
                <div className="text-xs text-muted-foreground">
                  {b.entryCount} {b.entryCount === 1 ? "entry" : "entries"}
                  {fromChar && <> · from {info.character.name}</>}
                </div>
              </div>
              <span className={cn("flex size-4 items-center justify-center rounded", on ? "bg-brand text-brand-foreground" : "bg-foreground/12", fromChar && "opacity-60")}>{on && <Check className="size-3" />}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
