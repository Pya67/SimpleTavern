"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "cn";
import { toast } from "sonner";
import { Check, Layers, Loader2, Pencil, Pin, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Group, Section } from "@/components/panels/generation-panel";
import { qk } from "@/lib/client/queries";
import { rpc, type ProcOutput } from "@/lib/client/rpc";
import { formatNum } from "@/lib/format";

type Mem = ProcOutput<"memory.list">;

export function useMemory(chatId: string) {
  return useQuery({
    queryKey: qk.memory(chatId),
    queryFn: () => rpc("memory.list", { chatId }),
    refetchInterval: (q) => (q.state.data?.compacting ? 1500 : false),
  });
}

export function MemoryPanel({ chatId }: { chatId: string }) {
  const { data } = useMemory(chatId);
  const qc = useQueryClient();
  const [newFact, setNewFact] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: qk.memory(chatId) });

  if (!data) return <div className="surface-well h-40 animate-pulse rounded-xl" />;
  const pct = Math.min(100, Math.round((data.uncoveredTokens / Math.max(1, data.threshold)) * 100));
  const active = data.chunks.filter((c) => c.state === "active");
  const other = data.chunks.filter((c) => c.state !== "active");

  return (
    <div className="space-y-6">
      <Section title="Context usage">
        <Group className="space-y-0">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Uncompacted history</span>
            <span className="tabular-nums">
              {formatNum(data.uncoveredTokens)} / {formatNum(data.threshold)} tok
            </span>
          </div>
          <div className="surface-well mt-2 h-1.5 overflow-hidden rounded-full">
            <motion.div className={cn("h-full rounded-full", pct > 90 ? "bg-destructive" : "bg-brand")} initial={false} animate={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {data.coveredCount} of {data.pathLength} messages summarized
            </span>
            {data.compacting ? (
              <span className="flex items-center gap-1 text-brand">
                <Loader2 className="size-3 animate-spin" /> {data.compacting}
              </span>
            ) : (
              <span>{data.enabled ? "Auto-compaction on" : "Auto-compaction off"}</span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            disabled={!!data.compacting}
            onClick={async () => {
              await rpc("memory.compactNow", { chatId });
              toast.info("Compacting memory…");
              setTimeout(refresh, 400);
            }}
          >
            <Layers /> Compact now
          </Button>
        </Group>
      </Section>

      <Section title={`Pinned facts (${data.facts.filter((f) => !f.suggested).length})`}>
        <Group className="space-y-1">
          <AnimatePresence initial={false}>
            {data.facts.map((f) => (
              <FactRow key={f.id} fact={f} onChange={refresh} />
            ))}
          </AnimatePresence>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newFact.trim()) return;
              await rpc("facts.create", { chatId, content: newFact.trim() });
              setNewFact("");
              refresh();
            }}
            className="flex gap-1.5 pt-1"
          >
            <input
              value={newFact}
              onChange={(e) => setNewFact(e.target.value)}
              placeholder="Add a fact the story must never forget…"
              aria-label="New fact"
              className="h-8 min-w-0 flex-1 rounded-lg px-2.5 text-sm outline-none"
            />
            <Button type="submit" size="icon" variant="outline" className="size-8" aria-label="Add fact">
              <Plus />
            </Button>
          </form>
        </Group>
      </Section>

      <Section title={`Memories (${active.length})`}>
        {!data.chunks.length && (
          <p className="surface-well rounded-xl p-4 text-center text-xs text-muted-foreground">
            No memories yet. When the chat grows past the threshold, older messages are summarized here automatically.
          </p>
        )}
        <div className="space-y-2">
          {active.map((c) => (
            <ChunkCard key={c.id} chunk={c} onChange={refresh} />
          ))}
        </div>
        {other.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer px-1 text-xs text-muted-foreground hover:text-foreground">
              {other.length} inactive (merged, stale, or from other branches)
            </summary>
            <div className="mt-2 space-y-2 opacity-70">
              {other.map((c) => (
                <ChunkCard key={c.id} chunk={c} onChange={refresh} />
              ))}
            </div>
          </details>
        )}
      </Section>
    </div>
  );
}

function FactRow({ fact, onChange }: { fact: Mem["facts"][number]; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.content);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className={cn("group flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-foreground/5", fact.suggested && "bg-brand/10 hover:bg-brand/15")}
    >
      {fact.suggested ? <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand" /> : <Pin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
      {editing ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={async () => {
            setEditing(false);
            if (text.trim() && text !== fact.content) {
              await rpc("facts.update", { id: fact.id, content: text.trim() });
              onChange();
            }
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="flex-1 rounded bg-transparent outline-none"
        />
      ) : (
        <span className="flex-1" onDoubleClick={() => setEditing(true)}>
          {fact.content}
        </span>
      )}
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
        {fact.suggested && (
          <button
            aria-label="Accept"
            onClick={async () => {
              await rpc("facts.update", { id: fact.id, suggested: false });
              onChange();
            }}
            className="rounded p-0.5 text-muted-foreground hover:text-brand"
          >
            <Check className="size-3.5" />
          </button>
        )}
        <button aria-label="Edit" onClick={() => setEditing(true)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
          <Pencil className="size-3.5" />
        </button>
        <button
          aria-label="Delete"
          onClick={async () => {
            await rpc("facts.delete", { id: fact.id });
            onChange();
          }}
          className="rounded p-0.5 text-muted-foreground hover:text-destructive"
        >
          {fact.suggested ? <X className="size-3.5" /> : <Trash2 className="size-3.5" />}
        </button>
      </div>
    </motion.div>
  );
}

function ChunkCard({ chunk, onChange }: { chunk: Mem["chunks"][number]; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(chunk.content);
  const [busy, setBusy] = useState(false);
  return (
    <div className="surface-grain rounded-xl p-3 text-sm">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={cn("rounded-full px-1.5 py-px font-medium", chunk.level > 0 ? "bg-brand/15 text-brand" : "surface-well")}>{chunk.level > 0 ? `Story so far · L${chunk.level}` : "Summary"}</span>
        <span>
          {chunk.fromDepth != null ? `#${chunk.fromDepth + 1}–${(chunk.toDepth ?? 0) + 1}` : "other branch"} · {chunk.messageCount} msgs · {formatNum(chunk.tokenCount)} tok
        </span>
        {chunk.state === "stale" && <span className="text-destructive">stale</span>}
        {chunk.userEdited && <span>· edited</span>}
      </div>
      {editing ? (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-32 text-sm" autoFocus />
      ) : (
        <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">{chunk.content}</p>
      )}
      <div className="mt-2 flex justify-end gap-1">
        {editing ? (
          <>
            <Button size="xs" variant="ghost" onClick={() => (setEditing(false), setText(chunk.content))}>
              Cancel
            </Button>
            <Button
              size="xs"
              onClick={async () => {
                await rpc("memory.update", { id: chunk.id, content: text });
                setEditing(false);
                onChange();
              }}
            >
              Save
            </Button>
          </>
        ) : (
          <>
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await rpc("memory.regenerate", { id: chunk.id });
                  onChange();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Redo
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={async () => {
                await rpc("memory.delete", { id: chunk.id });
                onChange();
              }}
            >
              <Trash2 />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
