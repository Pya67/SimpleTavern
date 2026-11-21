"use client";
import { useEffect, useRef, useState } from "react";
import { download } from "@/lib/client/download";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { cn } from "cn";
import { Copy, Download, FileJson, MessageSquarePlus, MoreHorizontal, Pencil, Plus, Search, Star, Trash2, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/app/page-header";
import { EntityAvatar } from "@/components/common/avatar";
import { EmptyState } from "@/components/common/empty-state";
import { confirmDialog } from "@/components/common/confirm";
import { qk, useCharacters, type CharacterListItem } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import { relativeTime } from "@/lib/format";

export async function importCards(files: File[]) {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const res = await fetch("/api/characters/import", { method: "POST", body: fd });
  const j = (await res.json()) as { results: ({ ok: true; id: string; name: string; entries: number } | { ok: false; file: string; error: string })[] };
  return j.results ?? [];
}

export function CharactersView() {
  const { data, isLoading } = useCharacters();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    if (params.get("import")) setTimeout(() => fileRef.current?.click(), 300);
  }, [params]);

  const doImport = async (files: File[]) => {
    if (!files.length) return;
    const t = toast.loading(`Importing ${files.length} card${files.length > 1 ? "s" : ""}…`);
    const results = await importCards(files);
    toast.dismiss(t);
    const ok = results.filter((r) => r.ok) as { id: string; name: string; entries: number }[];
    const bad = results.filter((r) => !r.ok) as { file: string; error: string }[];
    if (ok.length)
      toast.success(ok.length === 1 ? `Imported ${ok[0].name}` : `Imported ${ok.length} characters`, {
        description: ok.some((o) => o.entries) ? "Embedded lorebooks were imported and linked." : undefined,
        action: ok.length === 1 ? { label: "Open", onClick: () => router.push(`/characters/${ok[0].id}`) } : undefined,
      });
    bad.forEach((b) => toast.error(`${b.file}: ${b.error}`));
    qc.invalidateQueries({ queryKey: qk.characters });
    qc.invalidateQueries({ queryKey: qk.lorebooks });
  };

  const allTags = [...new Set((data ?? []).flatMap((c) => c.tags))].sort();
  const list = (data ?? []).filter(
    (c) => (!q || `${c.name} ${c.tagline} ${c.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())) && (!tag || c.tags.includes(tag)),
  );

  return (
    <div
      className="borderless-controls relative h-full overflow-y-auto"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void doImport([...e.dataTransfer.files]);
      }}
    >
      <PageHeader
        title="Characters"
        description={data ? `${data.length} character${data.length === 1 ? "" : "s"}` : undefined}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload /> <span className="hidden sm:inline">Import</span>
            </Button>
            <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90" render={<Link href="/characters/new" />}>
              <Plus /> <span className="hidden sm:inline">Create</span>
            </Button>
          </>
        }
      />
      <input ref={fileRef} type="file" multiple accept=".png,.json,image/png,application/json" hidden onChange={(e) => (doImport([...(e.target.files ?? [])]), (e.target.value = ""))} />

      <div className="mx-auto max-w-6xl px-4 py-5 md:px-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search characters…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" />
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allTags.slice(0, 14).map((t) => (
                <button
                  key={t}
                  onClick={() => setTag(tag === t ? null : t)}
                  className={cn("rounded-full px-2.5 py-0.5 text-xs transition-colors", tag === t ? "bg-brand/15 font-medium text-foreground" : "surface-well text-muted-foreground hover:text-foreground")}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="surface-well h-36 animate-pulse rounded-2xl" />
            ))}
          </div>
        )}
        {!isLoading && !data?.length && (
          <EmptyState
            icon={Users}
            title="No characters yet"
            description="Create your first character, or drop Character Card V2/V3 files (PNG or JSON) anywhere on this page."
            action={
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <Upload /> Import cards
                </Button>
                <Button render={<Link href="/characters/new" />}>
                  <Plus /> Create character
                </Button>
              </div>
            }
          />
        )}
        <motion.div layout className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence initial={false}>
            {list.map((c, i) => (
              <CharacterCard key={c.id} c={c} i={i} />
            ))}
          </AnimatePresence>
        </motion.div>
      </div>

      <AnimatePresence>
        {dragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="surface-grain flex flex-col items-center gap-3 rounded-3xl px-12 py-10 shadow-2xl">
              <Upload className="size-8 text-brand" />
              <div className="text-lg font-semibold">Drop character cards to import</div>
              <div className="text-sm text-muted-foreground">PNG or JSON · V1, V2 and V3 supported</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CharacterCard({ c, i }: { c: CharacterListItem; i: number }) {
  const qc = useQueryClient();
  const router = useRouter();
  const startChat = async () => {
    const r = await rpc("chats.create", { characterId: c.id });
    qc.invalidateQueries({ queryKey: qk.chats });
    router.push(`/chats/${r.id}`);
  };
  const toggleFav = async () => {
    qc.setQueryData<CharacterListItem[]>(qk.characters, (old) => old?.map((x) => (x.id === c.id ? { ...x, favorite: !x.favorite } : x)));
    await rpc("characters.update", { id: c.id, favorite: !c.favorite });
    qc.invalidateQueries({ queryKey: qk.characters });
  };
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.025 } }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="surface-grain group relative flex flex-col rounded-2xl p-4 transition-shadow hover:shadow-lg"
    >
      <div className="flex items-start gap-3">
        <Link href={`/characters/${c.id}`}>
          <EntityAvatar name={c.name} src={c.avatar} color={c.color} size={56} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={`/characters/${c.id}`} className="truncate font-semibold hover:underline">
              {c.name}
            </Link>
            <button onClick={toggleFav} aria-label="Favorite" className="text-muted-foreground transition-colors hover:text-brand">
              <Star className={cn("size-3.5", c.favorite ? "fill-brand text-brand" : "opacity-0 group-hover:opacity-100")} />
            </button>
          </div>
          <p className="line-clamp-2 text-sm text-muted-foreground">{c.tagline || "No tagline"}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 aria-expanded:opacity-100 max-md:opacity-100" aria-label="Character menu" />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => router.push(`/characters/${c.id}`)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                const n = await rpc("characters.duplicate", { id: c.id });
                qc.invalidateQueries({ queryKey: qk.characters });
                toast.success(`Created ${n.name}`);
              }}
            >
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => download(`/api/characters/${c.id}/export?format=png`)}>
              <Download /> Export card (PNG)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => download(`/api/characters/${c.id}/export?format=json`)}>
              <FileJson /> Export card (JSON)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: `Delete ${c.name}?`,
                  description: `This also deletes ${c.chatCount} chat${c.chatCount === 1 ? "" : "s"} with ${c.name}. This cannot be undone.`,
                  confirmLabel: "Delete",
                  destructive: true,
                });
                if (!ok) return;
                await rpc("characters.delete", { id: c.id });
                qc.invalidateQueries({ queryKey: qk.characters });
                qc.invalidateQueries({ queryKey: qk.chats });
              }}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {c.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {c.tags.slice(0, 5).map((t) => (
            <span key={t} className="surface-well rounded-full px-2 py-0.5 text-[11px] text-muted-foreground">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted-foreground">
        <span>{c.chatCount ? `${c.chatCount} chat${c.chatCount === 1 ? "" : "s"} · ${relativeTime(c.lastChatAt)}` : "No chats yet"}</span>
        <Button size="sm" variant="secondary" onClick={startChat} className="gap-1.5">
          <MessageSquarePlus /> Chat
        </Button>
      </div>
    </motion.div>
  );
}
