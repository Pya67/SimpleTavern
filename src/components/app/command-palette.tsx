"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { isDarkTheme } from "@/lib/themes";
import { BookOpen, Keyboard, MessageSquareText, Moon, Plus, Settings, SlidersHorizontal, UserRound, Users } from "lucide-react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { EntityAvatar } from "@/components/common/avatar";
import { useCharacters, useChats } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import { relativeTime } from "@/lib/format";
import { useUi } from "@/stores/ui";
import { useCommands } from "@/stores/commands";

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function Highlight({ text }: { text: string }) {
  // "a<<b>>c" -> ["a", "b", "c"]; odd indexes are highlighted.
  const parts = text.split(/<<|>>/);
  return (
    <span>
      {parts.map((p, i) => {
        const on = i % 2 === 1;
        return on ? (
          <mark key={i} className="rounded-sm bg-brand/25 px-0.5 text-foreground">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </span>
  );
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const set = useUi((s) => s.set);
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 200);
  const { data: chats } = useChats();
  const { data: characters } = useCharacters();
  const contextCommands = useCommands((s) => s.commands);

  const search = useQuery({
    queryKey: ["search", dq],
    queryFn: () => rpc("search.all", { q: dq }),
    enabled: open && dq.length >= 3,
    staleTime: 10_000,
  });

  const close = () => {
    set({ paletteOpen: false });
    setTimeout(() => setQ(""), 200);
  };
  const go = (href: string) => {
    close();
    router.push(href);
  };

  const ctx = useMemo(() => Object.values(contextCommands).flat(), [contextCommands]);
  const ctxGroups = useMemo(() => {
    const m = new Map<string, typeof ctx>();
    for (const c of ctx) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()];
  }, [ctx]);

  return (
    <CommandDialog open={open} onOpenChange={(o) => (o ? set({ paletteOpen: true }) : close())} className="sm:max-w-xl" title="Command palette">
      <Command loop>
        <CommandInput placeholder="Search chats, characters, messages, or run a command…" value={q} onValueChange={setQ} />
        <CommandList className="max-h-[min(60vh,480px)]">
          <CommandEmpty>{search.isFetching ? "Searching…" : "No results."}</CommandEmpty>

          {ctxGroups.map(([group, cmds]) => (
            <CommandGroup key={group} heading={group}>
              {cmds.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.group} ${c.label}`}
                  keywords={c.keywords}
                  onSelect={() => {
                    close();
                    setTimeout(c.run, 10);
                  }}
                >
                  {c.icon && <c.icon />}
                  {c.label}
                  {c.shortcut && <CommandShortcut>{c.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          {!!chats?.length && (
            <CommandGroup heading="Chats">
              {chats.slice(0, q ? 50 : 6).map((c) => (
                <CommandItem key={c.id} value={`chat ${c.title} ${c.characterName} ${c.id}`} onSelect={() => go(`/chats/${c.id}`)}>
                  <EntityAvatar name={c.characterName} src={c.characterAvatar} color={c.characterColor} size={20} />
                  <span className="truncate">{c.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relativeTime(c.lastMessageAt)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!!search.data?.messages.length && (
            <CommandGroup heading="Messages">
              {search.data.messages.map((m) => (
                <CommandItem key={m.id} value={`msg ${m.id} ${dq}`} keywords={[dq, q]} onSelect={() => go(`/chats/${m.chatId}?m=${m.id}`)}>
                  <MessageSquareText />
                  <div className="min-w-0">
                    <div className="truncate text-xs text-muted-foreground">
                      {m.characterName} · {m.title}
                    </div>
                    <div className="line-clamp-2 text-[13px]">
                      <Highlight text={m.snippet} />
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!!characters?.length && (
            <CommandGroup heading="Start a chat with…">
              {characters.slice(0, q ? 30 : 4).map((c) => (
                <CommandItem
                  key={c.id}
                  value={`new chat ${c.name} ${c.tagline}`}
                  onSelect={async () => {
                    close();
                    const r = await rpc("chats.create", { characterId: c.id });
                    router.push(`/chats/${r.id}`);
                  }}
                >
                  <EntityAvatar name={c.name} src={c.avatar} color={c.color} size={20} />
                  {c.name}
                  <span className="ml-auto truncate text-xs text-muted-foreground">{c.tagline}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandGroup heading="Navigate">
            <CommandItem value="new chat" onSelect={() => (close(), set({ newChatOpen: true }))}>
              <Plus /> New chat… <CommandShortcut>Alt N</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/characters")}>
              <Users /> Characters
            </CommandItem>
            <CommandItem onSelect={() => go("/characters/new")}>
              <Plus /> Create character
            </CommandItem>
            <CommandItem onSelect={() => go("/personas")}>
              <UserRound /> Personas
            </CommandItem>
            <CommandItem onSelect={() => go("/presets")}>
              <SlidersHorizontal /> Presets & prompt templates
            </CommandItem>
            <CommandItem onSelect={() => go("/lorebooks")}>
              <BookOpen /> Lorebooks
            </CommandItem>
            <CommandItem onSelect={() => go("/settings")}>
              <Settings /> Settings
            </CommandItem>
            <CommandItem value="toggle theme dark light" onSelect={() => (close(), setTheme(isDarkTheme(resolvedTheme) ? "light" : "dark"))}>
              <Moon /> Toggle theme
            </CommandItem>
            <CommandItem value="keyboard shortcuts help" onSelect={() => (close(), set({ helpOpen: true, helpTab: "shortcuts" }))}>
              <Keyboard /> Keyboard shortcuts <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
