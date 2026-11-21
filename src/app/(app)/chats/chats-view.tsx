"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Archive, MessageSquarePlus, MessagesSquare, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { EntityAvatar } from "@/components/common/avatar";
import { EmptyState } from "@/components/common/empty-state";
import { byEdited, ChatListRow } from "@/components/app/chat-list-row";
import { qk, useRpcQuery, type ChatListItem } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import { relativeTime } from "@/lib/format";

type Group = { characterId: string; name: string; avatar: ChatListItem["characterAvatar"]; color: ChatListItem["characterColor"]; tags: string[]; chats: ChatListItem[] };

export function ChatsView() {
  const [archived, setArchived] = useState(false);
  const { data, isLoading } = useRpcQuery([...qk.chats, { archived }], "chats.list", { archived });
  const [q, setQ] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const router = useRouter();
  const qc = useQueryClient();

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const c of [...(data ?? [])].sort(byEdited)) {
      let g = map.get(c.characterId);
      if (!g) map.set(c.characterId, (g = { characterId: c.characterId, name: c.characterName, avatar: c.characterAvatar, color: c.characterColor, tags: c.characterTags, chats: [] }));
      g.chats.push(c);
    }
    // Insertion order follows the most recently edited chat, so groups are already sorted.
    return [...map.values()];
  }, [data]);

  const allTags = useMemo(() => [...new Set(groups.flatMap((g) => g.tags))].sort((a, b) => a.localeCompare(b)), [groups]);
  const needle = q.trim().toLowerCase();
  const visible = groups
    .filter((g) => tags.every((t) => g.tags.includes(t)))
    .map((g) => (needle && !g.name.toLowerCase().includes(needle) ? { ...g, chats: g.chats.filter((c) => c.title.toLowerCase().includes(needle)) } : g))
    .filter((g) => g.chats.length);

  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const startChat = async (characterId: string) => {
    const r = await rpc("chats.create", { characterId });
    qc.invalidateQueries({ queryKey: qk.chats });
    router.push(`/chats/${r.id}`);
  };
  const total = data?.length ?? 0;

  return (
    <div className="borderless-controls h-full overflow-y-auto">
      <PageHeader
        title={archived ? "Archived chats" : "Chats"}
        description={data ? `${total} chat${total === 1 ? "" : "s"} with ${groups.length} character${groups.length === 1 ? "" : "s"}` : undefined}
        actions={
          <Button variant={archived ? "secondary" : "outline"} size="sm" onClick={() => setArchived((a) => !a)} aria-pressed={archived}>
            <Archive /> <span className="hidden sm:inline">{archived ? "Showing archived" : "Archived"}</span>
          </Button>
        }
      />
      <div className="mx-auto max-w-4xl px-4 py-5 md:px-6">
        <div className="mb-5 flex flex-col gap-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search chats or characters…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" />
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  aria-pressed={tags.includes(t)}
                  className={cn("rounded-full px-2.5 py-0.5 text-xs transition-colors", tags.includes(t) ? "bg-brand/15 font-medium text-foreground" : "surface-well text-muted-foreground hover:text-foreground")}
                >
                  {t}
                </button>
              ))}
              {tags.length > 0 && (
                <button onClick={() => setTags([])} className="flex items-center gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <X className="size-3" /> Clear
                </button>
              )}
            </div>
          )}
        </div>

        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="surface-well h-32 animate-pulse rounded-2xl" />
            ))}
          </div>
        )}
        {!isLoading && !total && (
          <EmptyState
            icon={MessagesSquare}
            title={archived ? "No archived chats" : "No chats yet"}
            description={archived ? "Chats you archive from the sidebar show up here." : "Pick a character to start your first conversation."}
            action={!archived ? <Button render={<Link href="/characters" />}>Browse characters</Button> : undefined}
          />
        )}
        {!isLoading && total > 0 && !visible.length && <p className="py-10 text-center text-sm text-muted-foreground">No chats match these filters.</p>}

        <div className="space-y-5">
          {visible.map((g) => (
            <section key={g.characterId} className="surface-grain overflow-hidden rounded-2xl p-1.5">
              <header className="flex items-center gap-3 px-2.5 pb-2 pt-1.5">
                <Link href={`/characters/${g.characterId}`}>
                  <EntityAvatar name={g.name} src={g.avatar} color={g.color} size={40} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/characters/${g.characterId}`} className="truncate font-semibold hover:underline">
                    {g.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {g.chats.length} chat{g.chats.length === 1 ? "" : "s"} · edited {relativeTime(g.chats[0].editedAt)}
                  </div>
                  {g.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {g.tags.slice(0, 6).map((t) => (
                        <button key={t} onClick={() => toggleTag(t)} className={cn("rounded-full px-2 py-0.5 text-[11px] transition-colors", tags.includes(t) ? "bg-brand/15 text-foreground" : "bg-muted text-muted-foreground hover:bg-accent")}>
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="secondary" onClick={() => startChat(g.characterId)} className="shrink-0 gap-1.5">
                  <MessageSquarePlus /> <span className="hidden sm:inline">New chat</span>
                </Button>
              </header>
              <div className="space-y-0.5">
                {g.chats.map((c) => (
                  <ChatListRow key={c.id} chat={c} showCharacter={false} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
