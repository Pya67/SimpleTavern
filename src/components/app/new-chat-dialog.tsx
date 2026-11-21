"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Loader2, Plus, Search, Star } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EntityAvatar } from "@/components/common/avatar";
import { qk, useCharacters } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import { useUi } from "@/stores/ui";

export function NewChatDialog() {
  const open = useUi((s) => s.newChatOpen);
  const set = useUi((s) => s.set);
  const { data: characters } = useCharacters();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const qc = useQueryClient();

  const list = (characters ?? []).filter((c) => !q || `${c.name} ${c.tagline} ${c.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase()));

  const start = async (characterId: string) => {
    setBusy(characterId);
    try {
      const r = await rpc("chats.create", { characterId });
      qc.invalidateQueries({ queryKey: qk.chats });
      set({ newChatOpen: false });
      router.push(`/chats/${r.id}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => set({ newChatOpen: o })}>
      <DialogContent className="gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start a new chat</DialogTitle>
          <DialogDescription>Pick who you want to talk to.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search characters…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 pl-8"
            onKeyDown={(e) => {
              if (e.key === "Enter" && list[0]) void start(list[0].id);
            }}
          />
        </div>
        <div className="-mx-1 grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto p-1 sm:grid-cols-2">
          {list.map((c, i) => (
            <motion.button
              key={c.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.025, 0.25) }}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => start(c.id)}
              disabled={!!busy}
              className="flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-brand/40 hover:bg-accent"
            >
              <EntityAvatar name={c.name} src={c.avatar} color={c.color} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-medium">
                  <span className="truncate">{c.name}</span>
                  {c.favorite && <Star className="size-3 shrink-0 fill-brand text-brand" />}
                </div>
                <div className="line-clamp-2 text-xs text-muted-foreground">{c.tagline || "No tagline"}</div>
              </div>
              {busy === c.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </motion.button>
          ))}
          <Link
            href="/characters/new"
            onClick={() => set({ newChatOpen: false })}
            className="flex items-center gap-3 rounded-xl border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
          >
            <span className="flex size-11 items-center justify-center rounded-full border border-dashed">
              <Plus className="size-4" />
            </span>
            Create a new character
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
