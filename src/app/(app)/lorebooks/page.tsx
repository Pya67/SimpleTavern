"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { cn } from "cn";
import { BookOpen, ChevronDown, FlaskConical, Plus, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { confirmDialog } from "@/components/common/confirm";
import { FieldLabel, SaveIndicator, TextField } from "@/components/editors/field";
import { useAutosave } from "@/hooks/use-autosave";
import { qk, useLorebooks } from "@/lib/client/queries";
import { TagInput } from "@/components/common/tag-input";
import { rpc, type ProcOutput } from "@/lib/client/rpc";
import { scanLore } from "@/lib/prompt/lore";
import { estimateTokens } from "@/lib/tokens";

type Book = ProcOutput<"lorebooks.get">;
type Entry = Book["entries"][number];

export default function LorebooksPage() {
  const { data: books } = useLorebooks();
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (books && (!sel || !books.some((b) => b.id === sel))) setSel(books[0]?.id ?? null);
  }, [books, sel]);

  const create = async () => {
    const b = await rpc("lorebooks.create", { name: "New lorebook" });
    await qc.invalidateQueries({ queryKey: qk.lorebooks });
    setSel(b.id);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Lorebooks"
        description="World info that's injected when keywords come up."
        actions={
          <Button size="sm" onClick={create} className="bg-brand text-brand-foreground hover:bg-brand/90">
            <Plus /> New lorebook
          </Button>
        }
      />
      {books && !books.length ? (
        <EmptyState
          icon={BookOpen}
          title="No lorebooks yet"
          description="Lorebooks hold facts about places, people and lore. Entries are only sent when their keywords appear, saving context."
          action={<Button onClick={create}>Create lorebook</Button>}
        />
      ) : (
        <div className="borderless-controls mx-auto grid min-h-0 w-full max-w-6xl flex-1 gap-6 overflow-y-auto px-4 py-6 md:grid-cols-[240px_1fr] md:px-6">
          <div className="space-y-1.5">
            {books?.map((b) => (
              <button
                key={b.id}
                onClick={() => setSel(b.id)}
                className={cn("surface-grain flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent", sel === b.id && "bg-brand/12 hover:bg-brand/15")}
              >
                <BookOpen className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.entryCount} {b.entryCount === 1 ? "entry" : "entries"}</div>
                </div>
              </button>
            ))}
          </div>
          {sel && <BookEditor key={sel} id={sel} onDeleted={() => setSel(null)} />}
        </div>
      )}
    </div>
  );
}

function BookEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: qk.lorebook(id), queryFn: () => rpc("lorebooks.get", { id }) });
  const [meta, setMeta] = useState<{ name: string; description: string; scanDepth: number; tokenBudget: number; recursive: boolean } | null>(null);
  const [test, setTest] = useState("");
  const [testOpen, setTestOpen] = useState(false);
  useEffect(() => {
    if (data && !meta) setMeta({ name: data.name, description: data.description, scanDepth: data.scanDepth, tokenBudget: data.tokenBudget, recursive: data.recursive });
  }, [data, meta]);
  const state = useAutosave(
    meta,
    async (m) => {
      if (!m) return;
      await rpc("lorebooks.update", { id, ...m, name: m.name || "Untitled" });
      qc.invalidateQueries({ queryKey: qk.lorebooks });
    },
    { enabled: !!meta },
  );

  const fired = useMemo(() => {
    if (!data || !meta || !test.trim()) return [];
    return scanLore({ books: [{ id, scanDepth: 1, tokenBudget: meta.tokenBudget, recursive: meta.recursive }], entries: data.entries, history: [test], countTokens: estimateTokens, random: () => 0 });
  }, [data, meta, test, id]);
  const firedIds = new Set(fired.map((f) => f.entry.id));

  if (!data || !meta) return <div className="h-60 animate-pulse rounded-2xl bg-muted" />;

  const addEntry = async () => {
    await rpc("lore.createEntry", { lorebookId: id, comment: "New entry", keys: [], content: "" });
    qc.invalidateQueries({ queryKey: qk.lorebook(id) });
    qc.invalidateQueries({ queryKey: qk.lorebooks });
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="surface-grain space-y-4 rounded-2xl p-5">
        <div className="flex flex-wrap items-end gap-3">
          <TextField className="min-w-60 flex-1" label="Name" value={meta.name} onChange={(v) => setMeta({ ...meta, name: v })} />
          <SaveIndicator state={state} />
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={async () => {
              if (!(await confirmDialog({ title: `Delete “${meta.name}”?`, description: `${data.entries.length} entries will be deleted.`, confirmLabel: "Delete", destructive: true }))) return;
              await rpc("lorebooks.delete", { id });
              qc.invalidateQueries({ queryKey: qk.lorebooks });
              onDeleted();
            }}
          >
            <Trash2 /> Delete
          </Button>
        </div>
        <TextField label="Description" value={meta.description} onChange={(v) => setMeta({ ...meta, description: v })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="Scan depth" hint="How many recent messages are scanned for keywords." value={meta.scanDepth} onChange={(v) => setMeta({ ...meta, scanDepth: Math.max(1, v) })} />
          <NumberField label="Token budget" hint="Max tokens of lore injected per request from this book." value={meta.tokenBudget} onChange={(v) => setMeta({ ...meta, tokenBudget: Math.max(0, v) })} />
          <div>
            <FieldLabel label="Recursive" hint="Activated entries can trigger other entries with their own content." />
            <Switch checked={meta.recursive} onCheckedChange={(c) => setMeta({ ...meta, recursive: c })} />
          </div>
        </div>
      </div>

      <div className="surface-grain rounded-2xl">
        <button onClick={() => setTestOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium">
          <FlaskConical className="size-4 text-brand" /> Test matcher
          {test && <span className="text-xs font-normal text-muted-foreground">· {fired.length} entries would fire</span>}
          <ChevronDown className={cn("ml-auto size-4 transition-transform", testOpen && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {testOpen && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
              <div className="space-y-2 px-4 pb-4">
                <textarea value={test} onChange={(e) => setTest(e.target.value)} rows={3} placeholder="Type or paste some chat text to see which entries activate…" className="surface-well field-sizing-content min-h-16 w-full rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60" />
                {fired.map((f) => (
                  <div key={f.entry.id} className="flex items-center gap-2 text-xs">
                    <Zap className="size-3 text-brand" /> <span className="font-medium">{f.entry.comment || f.entry.keys.join(", ")}</span>
                    <span className="text-muted-foreground">{f.reason}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Entries ({data.entries.length})</h3>
        <Button size="sm" variant="outline" onClick={addEntry}>
          <Plus /> Add entry
        </Button>
      </div>
      <div className="space-y-2">
        {data.entries.map((e) => (
          <EntryCard key={e.id} entry={e} bookId={id} active={firedIds.has(e.id)} />
        ))}
      </div>
    </div>
  );
}

function NumberField({ label, hint, value, onChange }: { label: string; hint?: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <FieldLabel label={label} hint={hint} />
      <input type="number" value={value} onChange={(e) => onChange(parseInt(e.target.value || "0", 10))} className="surface-well h-9 w-full rounded-lg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60" />
    </div>
  );
}

function EntryCard({ entry, bookId, active }: { entry: Entry; bookId: string; active: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(!entry.content);
  const [e, setE] = useState(entry);
  const state = useAutosave(e, async (v) => {
    await rpc("lore.updateEntry", {
      id: v.id,
      comment: v.comment,
      keys: v.keys,
      secondaryKeys: v.secondaryKeys,
      selectiveLogic: v.selectiveLogic,
      content: v.content,
      constant: v.constant,
      position: v.position,
      depth: v.depth,
      order: v.order,
      probability: v.probability,
      caseSensitive: v.caseSensitive,
      wholeWord: v.wholeWord,
      enabled: v.enabled,
    });
    qc.invalidateQueries({ queryKey: qk.lorebook(bookId) });
  });
  const set = <K extends keyof Entry>(k: K, v: Entry[K]) => setE((x) => ({ ...x, [k]: v }));

  return (
    <motion.div layout className={cn("surface-grain rounded-xl transition-colors", !e.enabled && "opacity-55", active && "bg-brand/12")}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Switch checked={e.enabled} onCheckedChange={(c) => set("enabled", c)} aria-label="Enabled" />
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2 truncate text-sm font-medium">
            {e.constant && <span className="rounded bg-brand/15 px-1.5 text-[11px] font-medium text-brand">Always on</span>}
            {e.comment || "Untitled entry"}
          </div>
          <div className="truncate text-xs text-muted-foreground">{e.keys.length ? e.keys.join(", ") : "No keywords"}</div>
        </button>
        <SaveIndicator state={state} />
        <span className="text-[11px] tabular-nums text-muted-foreground">{estimateTokens(e.content)} tok</span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-4 px-4 pb-4 pt-1">
              <TextField label="Title / comment" value={e.comment} onChange={(v) => set("comment", v)} />
              <div>
                <FieldLabel label="Keywords" hint="Any of these activates the entry. Use /regex/i for regular expressions." />
                <TagInput label="Keywords" value={e.keys} onChange={(v) => set("keys", v)} placeholder="Type a keyword and press Enter" />
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <div>
                  <FieldLabel label="Secondary keywords" hint="Optional extra filter combined using the logic on the right." />
                  <TagInput label="Secondary keywords" value={e.secondaryKeys} onChange={(v) => set("secondaryKeys", v)} placeholder="Optional" />
                </div>
                <div>
                  <FieldLabel label="Logic" />
                  <Select value={e.selectiveLogic} onValueChange={(v) => set("selectiveLogic", v as Entry["selectiveLogic"])}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="and_any">AND any</SelectItem>
                      <SelectItem value="and_all">AND all</SelectItem>
                      <SelectItem value="not_any">NOT any</SelectItem>
                      <SelectItem value="not_all">NOT all</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <TextField label="Content" multiline rows={5} value={e.content} onChange={(v) => set("content", v)} placeholder="What the model should know when this comes up…" />
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <FieldLabel label="Position" />
                  <Select value={e.position} onValueChange={(v) => set("position", v as Entry["position"])}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="before_char">Before character</SelectItem>
                      <SelectItem value="after_char">After character</SelectItem>
                      <SelectItem value="at_depth">In chat at depth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <NumberField label="Depth" value={e.depth} onChange={(v) => set("depth", Math.max(0, v))} />
                <NumberField label="Priority" hint="Higher wins when the token budget is tight." value={e.order} onChange={(v) => set("order", v)} />
                <NumberField label="Probability %" value={e.probability} onChange={(v) => set("probability", Math.min(100, Math.max(0, v)))} />
              </div>
              <div className="flex flex-wrap items-center gap-5 text-sm">
                <label className="flex items-center gap-2">
                  <Switch checked={e.constant} onCheckedChange={(c) => set("constant", c)} /> Always active
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={e.wholeWord} onCheckedChange={(c) => set("wholeWord", c)} /> Whole words
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={e.caseSensitive} onCheckedChange={(c) => set("caseSensitive", c)} /> Case sensitive
                </label>
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    await rpc("lore.deleteEntry", { id: e.id });
                    qc.invalidateQueries({ queryKey: qk.lorebook(bookId) });
                    qc.invalidateQueries({ queryKey: qk.lorebooks });
                    toast.success("Entry deleted");
                  }}
                >
                  <Trash2 /> Delete entry
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
