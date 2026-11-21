"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, BookOpen, FlaskConical, KeyRound, Loader2, MessageSquarePlus, Plus, SlidersHorizontal, Star, Upload, UserRound, Users, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { PageHeader } from "@/components/app/page-header";
import { Logo } from "@/components/app/logo";
import { EntityAvatar } from "@/components/common/avatar";
import { EmptyState } from "@/components/common/empty-state";
import { byEdited, ChatListRow } from "@/components/app/chat-list-row";
import { qk, useCharacters, useChats, useLorebooks, usePersonas, usePresets, useSettings, type CharacterListItem } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import { useUi } from "@/stores/ui";

const RECENT_CHATS = 5;
const QUICK_CHARACTERS = 8;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const time = (d: string | Date | null | undefined) => (d ? new Date(d).getTime() : 0);

/** Favorites first, then whoever you talked to most recently. */
const byRelevance = (a: CharacterListItem, b: CharacterListItem) => Number(b.favorite) - Number(a.favorite) || time(b.lastChatAt) - time(a.lastChatAt);

export function HomeView() {
  const { data: chats, isLoading: chatsLoading } = useChats();
  const { data: characters, isLoading: charactersLoading } = useCharacters();
  const set = useUi((s) => s.set);

  const recent = chats ? [...chats].sort(byEdited).slice(0, RECENT_CHATS) : [];
  const quick = characters ? [...characters].sort(byRelevance).slice(0, QUICK_CHARACTERS) : [];
  const empty = !charactersLoading && !characters?.length;

  return (
    <div className="borderless-controls h-full overflow-y-auto">
      <PageHeader
        title={<Logo markClassName="size-6" />}
        actions={
          <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => set({ newChatOpen: true })} disabled={empty}>
            <MessageSquarePlus /> <span className="hidden sm:inline">New chat</span>
          </Button>
        }
      />

      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 pb-16 pt-4 md:px-6">
        <SetupNotice />

        {empty ? (
          <EmptyState
            icon={Users}
            title="No characters yet"
            description="Create a character or import a card (PNG, JSON or from JanitorAI) to start chatting."
            action={
              <div className="flex gap-2">
                <Button variant="outline" render={<Link href="/characters?import=1" />}>
                  <Upload /> Import
                </Button>
                <Button render={<Link href="/characters/new" />}>
                  <Plus /> Create character
                </Button>
              </div>
            }
          />
        ) : (
          <>
            {(chatsLoading || recent.length > 0) && (
              <Section title="Recent chats" href="/chats" linkLabel="All chats">
                <div className="surface-grain overflow-hidden rounded-2xl">
                  {chatsLoading
                    ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 animate-pulse" />)
                    : recent.map((c) => <ChatListRow key={c.id} chat={c} className="hover:bg-foreground/5" />)}
                </div>
              </Section>
            )}

            <Section title="Start a chat" href="/characters" linkLabel="All characters">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {charactersLoading
                  ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="surface-well h-16 animate-pulse rounded-xl" />)
                  : quick.map((c) => <CharacterTile key={c.id} c={c} />)}
              </div>
            </Section>
          </>
        )}

        <Section title="Library">
          <Library />
        </Section>

        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <button className="flex items-center gap-1.5 hover:text-foreground" onClick={() => set({ paletteOpen: true })}>
            <Kbd>Ctrl K</Kbd> Search everything
          </button>
          <button className="flex items-center gap-1.5 hover:text-foreground" onClick={() => set({ helpOpen: true })}>
            <Kbd>?</Kbd> Keyboard shortcuts
          </button>
        </p>
      </div>
    </div>
  );
}

function Section({ title, href, linkLabel, children }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {href && (
          <Link href={href} className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
            {linkLabel} <ArrowRight className="size-3" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Only shows when something needs attention before chatting works. */
function SetupNotice() {
  const { data: settings } = useSettings();
  // Shares the Settings page's cache, so a saved key is checked at most once a minute.
  const key = useQuery({ queryKey: ["credits"], queryFn: () => rpc("settings.checkKey", {}), enabled: !!settings?.hasKey && !settings.mock, staleTime: 60_000 });
  if (!settings) return null;
  if (settings.mock)
    return (
      <div className="surface-grain flex items-center gap-3 rounded-2xl px-4 py-3 text-sm">
        <FlaskConical className="size-4 shrink-0 text-brand" />
        <p className="flex-1 text-muted-foreground">
          <span className="font-medium text-foreground">Mock mode.</span> Replies are simulated locally. Set <code className="surface-well rounded px-1 font-mono text-xs">OPENROUTER_MOCK=false</code> to use real models.
        </p>
      </div>
    );
  const rejected = settings.hasKey && key.data && !key.data.ok && key.data.error === "Invalid API key";
  if (settings.hasKey && !rejected) return null;
  return (
    <div className="surface-grain flex items-center gap-3 rounded-2xl px-4 py-3 text-sm">
      <KeyRound className="size-4 shrink-0 text-brand" />
      <p className="flex-1 text-muted-foreground">
        {rejected ? (
          <>
            <span className="font-medium text-foreground">OpenRouter rejected your key.</span> Replace it to generate replies.
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">No OpenRouter key.</span> Add one to generate replies.
          </>
        )}
      </p>
      <Button size="sm" variant="secondary" render={<Link href="/settings" />}>
        Settings
      </Button>
    </div>
  );
}

function CharacterTile({ c }: { c: CharacterListItem }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const start = async () => {
    setBusy(true);
    try {
      const r = await rpc("chats.create", { characterId: c.id });
      qc.invalidateQueries({ queryKey: qk.chats });
      router.push(`/chats/${r.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the chat");
      setBusy(false);
    }
  };
  return (
    <button
      onClick={start}
      disabled={busy}
      title={`New chat with ${c.name}`}
      className="surface-grain group flex min-w-0 items-center gap-2.5 rounded-xl p-2.5 text-left transition-shadow hover:shadow-md disabled:opacity-70"
    >
      <EntityAvatar name={c.name} src={c.avatar} color={c.color} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-sm font-medium">{c.name}</span>
          {c.favorite && <Star className="size-3 shrink-0 fill-brand text-brand" aria-label="Favorite" />}
        </div>
        <div className="truncate text-xs text-muted-foreground">{c.chatCount ? plural(c.chatCount, "chat") : "No chats yet"}</div>
      </div>
      {busy ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <MessageSquarePlus className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
    </button>
  );
}

/** Every area of the app, with what's in it and what's active. */
function Library() {
  const { data: characters } = useCharacters();
  const { data: personas } = usePersonas();
  const { data: lorebooks } = useLorebooks();
  const { data: presets } = usePresets();
  const { data: settings } = useSettings();

  const persona = personas?.find((p) => p.id === settings?.defaultPersonaId) ?? personas?.[0];
  const preset = presets?.find((p) => p.id === settings?.defaultPresetId) ?? presets?.[0];
  const entries = lorebooks?.reduce((n, b) => n + b.entryCount, 0) ?? 0;
  const favorites = characters?.filter((c) => c.favorite).length ?? 0;

  const items: { href: string; label: string; icon: LucideIcon; count?: number; detail?: string }[] = [
    { href: "/characters", label: "Characters", icon: Users, count: characters?.length, detail: favorites ? plural(favorites, "favorite") : "Create, import, export" },
    { href: "/personas", label: "Personas", icon: UserRound, count: personas?.length, detail: persona ? `Default: ${persona.name}` : undefined },
    { href: "/lorebooks", label: "Lorebooks", icon: BookOpen, count: lorebooks?.length, detail: lorebooks ? `${entries} ${entries === 1 ? "entry" : "entries"}` : undefined },
    { href: "/presets", label: "Presets", icon: SlidersHorizontal, count: presets?.length, detail: preset ? `Default: ${preset.name}` : undefined },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((it) => (
        <Link key={it.href} href={it.href} className="surface-grain group flex flex-col gap-3 rounded-xl p-3.5 transition-shadow hover:shadow-md">
          <div className="flex items-center justify-between">
            <it.icon className="size-4 text-muted-foreground transition-colors group-hover:text-brand" />
            <span className={cn("text-lg font-semibold tabular-nums leading-none", it.count === undefined && "text-transparent")}>{it.count ?? 0}</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">{it.label}</div>
            <div className="truncate text-xs text-muted-foreground">{it.detail ?? " "}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
