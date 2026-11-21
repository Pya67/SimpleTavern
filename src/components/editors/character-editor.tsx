"use client";
import { useEffect, useMemo, useState } from "react";
import { download } from "@/lib/client/download";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, Reorder, useDragControls } from "motion/react";
import { toast } from "sonner";
import { cn } from "cn";
import { ArrowLeft, BookOpen, Check, Download, GripVertical, Loader2, MessageSquarePlus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SidebarToggle } from "@/components/app/app-shell";
import { AvatarUploader } from "@/components/common/avatar-uploader";
import { EntityAvatar } from "@/components/common/avatar";
import { Markdown } from "@/components/chat/markdown";
import { CharacterFieldAssistant, type CharacterWritingField } from "@/components/editors/character-field-assistant";
import { FieldLabel, SaveIndicator, TextField } from "@/components/editors/field";
import { useAutosave } from "@/hooks/use-autosave";
import { qk, useCharacters, useLorebooks, usePersonas, usePresets, useSettings } from "@/lib/client/queries";
import { TagInput, type TagSuggestion } from "@/components/common/tag-input";
import { rpc, type ProcInput } from "@/lib/client/rpc";
import { estimateTokens } from "@/lib/tokens";
import { applyMacros } from "@/lib/prompt/macros";

type Form = Omit<ProcInput<"characters.create">, "tags" | "alternateGreetings"> & { tags: string[]; alternateGreetings: string[]; lorebookIds: string[] };

const EMPTY: Form = {
  name: "",
  avatar: null,
  color: null,
  tagline: "",
  description: "",
  personality: "",
  scenario: "",
  firstMessage: "",
  alternateGreetings: [],
  exampleDialogue: "",
  systemPrompt: "",
  postHistoryInstructions: "",
  creatorNotes: "",
  creator: "",
  characterVersion: "",
  tags: [],
  favorite: false,
  defaultPresetId: null,
  defaultPersonaId: null,
  lorebookIds: [],
};


export function CharacterEditor({ id }: { id?: string }) {
  const isNew = !id;
  const router = useRouter();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: qk.character(id ?? "new"), queryFn: () => rpc("characters.get", { id: id! }), enabled: !!id });
  const [form, setForm] = useState<Form>(EMPTY);
  const [ready, setReady] = useState(isNew);
  const [creating, setCreating] = useState(false);
  const [gids, setGids] = useState<string[]>([]);
  const [writingModel, setWritingModel] = useState("");
  const { data: presets } = usePresets();
  const { data: settings } = useSettings();
  const { data: personas } = usePersonas();
  const { data: books } = useLorebooks();
  const { data: allCharacters } = useCharacters();
  // Every tag used across your characters, with how many use it (this character excluded).
  const tagSuggestions = useMemo<TagSuggestion[]>(() => {
    const counts = new Map<string, number>();
    for (const c of allCharacters ?? []) if (c.id !== id) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count }));
  }, [allCharacters, id]);

  useEffect(() => {
    if (existing.data && !ready) {
      const d = existing.data;
      setGids(d.alternateGreetings.map(() => crypto.randomUUID()));
      setForm({ ...EMPTY, ...d, avatar: d.avatar, color: d.color, defaultPresetId: d.defaultPresetId, defaultPersonaId: d.defaultPersonaId, lorebookIds: d.lorebookIds });
      setReady(true);
    }
  }, [existing.data, ready]);

  const saveState = useAutosave(
    form,
    async (f) => {
      if (!id) return;
      await rpc("characters.update", { id, ...f });
      qc.invalidateQueries({ queryKey: qk.characters });
    },
    { enabled: !isNew && ready },
  );

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const writingContext = {
    name: form.name,
    tagline: form.tagline,
    description: form.description,
    personality: form.personality,
    scenario: form.scenario,
    firstMessage: form.firstMessage,
    tags: form.tags.join(", "),
  };
  const defaultWritingModel = presets?.find((p) => p.id === (form.defaultPresetId ?? settings?.defaultPresetId))?.modelId;
  const writingAction = (field: CharacterWritingField, label: string, value: string, onApply: (draft: string) => void) => (
    <CharacterFieldAssistant field={field} label={label} value={value} onApply={onApply} character={writingContext} model={writingModel} defaultModel={defaultWritingModel} onModelChange={setWritingModel} />
  );
  const writingField = (field: Exclude<CharacterWritingField, "tags" | "alternateGreeting">, label: string) => {
    const value = form[field] ?? "";
    const onChange = (draft: string) => set(field, draft);
    return { label, value, onChange, right: writingAction(field, label, value, onChange) };
  };

  const create = async () => {
    if (!form.name.trim()) return toast.error("Give your character a name");
    setCreating(true);
    try {
      const { lorebookIds, ...rest } = form;
      const c = await rpc("characters.create", rest);
      if (lorebookIds.length) await rpc("characters.update", { id: c.id, lorebookIds });
      qc.invalidateQueries({ queryKey: qk.characters });
      toast.success(`${c.name} created`);
      router.replace(`/characters/${c.id}`);
    } finally {
      setCreating(false);
    }
  };

  const startChat = async () => {
    if (!id) return;
    const r = await rpc("chats.create", { characterId: id });
    qc.invalidateQueries({ queryKey: qk.chats });
    router.push(`/chats/${r.id}`);
  };

  const permanent = [form.description, form.personality, form.scenario, form.systemPrompt, form.postHistoryInstructions].map(estimateTokens).reduce((a, b) => a + b, 0);
  const examples = estimateTokens(form.exampleDialogue);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="z-20 flex h-14 shrink-0 items-center gap-2 bg-background/85 px-3 backdrop-blur-md md:px-5">
        <SidebarToggle />
        <Button variant="ghost" size="icon-sm" onClick={() => router.push("/characters")} aria-label="Back">
          <ArrowLeft />
        </Button>
        <h1 className="truncate font-semibold">{isNew ? "New character" : form.name || "Untitled"}</h1>
        <div className="flex-1" />
        {!isNew && <SaveIndicator state={saveState} />}
        {!isNew && (
          <>
            <Button variant="ghost" size="sm" onClick={() => download(`/api/characters/${id}/export?format=png`)} className="hidden sm:inline-flex">
              <Download /> Export
            </Button>
            <Button size="sm" onClick={startChat} className="bg-brand text-brand-foreground hover:bg-brand/90">
              <MessageSquarePlus /> Chat
            </Button>
          </>
        )}
        {isNew && (
          <Button size="sm" onClick={create} disabled={creating} className="bg-brand text-brand-foreground hover:bg-brand/90">
            {creating && <Loader2 className="animate-spin" />} Create character
          </Button>
        )}
      </header>

      <div className="borderless-controls min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 md:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            <div className="flex items-center gap-5">
              <AvatarUploader name={form.name} value={form.avatar ?? null} color={form.color} onChange={(v) => set("avatar", v)} />
              <div className="min-w-0 flex-1 space-y-3">
                {/* Short fields: quicker to type than to generate, so no writing assistant. */}
                <TextField label="Name" value={form.name} onChange={(v) => set("name", v)} placeholder="e.g. Mira" />
                <TextField label="Tagline" value={form.tagline ?? ""} onChange={(v) => set("tagline", v)} placeholder="One line shown in lists" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-60 flex-1">
                <FieldLabel label="Tags" />
                <TagInput label="Tags" value={form.tags} onChange={(t) => set("tags", t)} suggestions={tagSuggestions} placeholder="Add tags like fantasy or slice of life" />
              </div>
            </div>

            <Tabs defaultValue="persona">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="persona">Personality</TabsTrigger>
                <TabsTrigger value="greetings">Greetings {form.alternateGreetings.length ? `(${form.alternateGreetings.length + 1})` : ""}</TabsTrigger>
                <TabsTrigger value="examples">Examples</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>
              <TabsContent value="persona" className="space-y-5 pt-4">
                <TextField {...writingField("description", "Description")} hint="Who the character is: appearance, background, relationships. Sent with every message." multiline rows={8} placeholder="{{char}} is…" />
                <TextField {...writingField("personality", "Personality")} hint="A short summary of traits." multiline rows={3} placeholder="Witty, guarded, secretly kind…" />
                <TextField {...writingField("scenario", "Scenario")} hint="The situation the roleplay starts in." multiline rows={3} placeholder="{{user}} arrives at…" />
              </TabsContent>
              <TabsContent value="greetings" className="space-y-5 pt-4">
                <TextField {...writingField("firstMessage", "First message")} hint="The opening message of every new chat. Alternate greetings can be swiped to." multiline rows={6} />
                <div>
                  <FieldLabel label="Alternate greetings" hint="Swipe between greetings at the start of a chat. Drag to reorder." />
                  <Reorder.Group
                    axis="y"
                    values={gids}
                    onReorder={(ids: string[]) => {
                      const byId = new Map(gids.map((g, i) => [g, form.alternateGreetings[i]]));
                      setGids(ids);
                      set("alternateGreetings", ids.map((g) => byId.get(g) ?? ""));
                    }}
                    className="space-y-2"
                  >
                    {gids.map((gid, i) => {
                      const value = form.alternateGreetings[i] ?? "";
                      const onChange = (draft: string) => set("alternateGreetings", form.alternateGreetings.map((x, j) => (j === i ? draft : x)));
                      return (
                        <GreetingItem
                          key={gid}
                          id={gid}
                          value={value}
                          index={i}
                          onChange={onChange}
                          action={writingAction("alternateGreeting", `Greeting ${i + 2}`, value, onChange)}
                          onRemove={() => {
                            setGids(gids.filter((_, j) => j !== i));
                            set("alternateGreetings", form.alternateGreetings.filter((_, j) => j !== i));
                          }}
                        />
                      );
                    })}
                  </Reorder.Group>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => {
                      setGids([...gids, crypto.randomUUID()]);
                      set("alternateGreetings", [...form.alternateGreetings, ""]);
                    }}>
                    <Plus /> Add greeting
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="examples" className="space-y-5 pt-4">
                <TextField
                  {...writingField("exampleDialogue", "Example dialogue")}
                  hint="Shows the model how the character talks. Separate examples with <START>."
                  multiline
                  rows={12}
                  mono
                  placeholder={"<START>\n{{user}}: Hello!\n{{char}}: *waves* \"Well met.\""}
                />
              </TabsContent>
              <TabsContent value="advanced" className="space-y-5 pt-4">
                <TextField {...writingField("systemPrompt", "System prompt override")} hint="Replaces the main prompt of the template for this character. Write {{original}} to include the template's main prompt. Leave empty to use the template." multiline rows={4} />
                <TextField {...writingField("postHistoryInstructions", "Post-history instructions")} hint="Sent after the chat history (also called jailbreak / UJB). Strong steering. Replaces the template's version; write {{original}} to include it." multiline rows={3} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <FieldLabel label="Default preset" />
                    <Select value={form.defaultPresetId ?? "__none"} onValueChange={(v) => set("defaultPresetId", v === "__none" ? null : (v as string))}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{(v: string) => (v === "__none" ? "Use global default" : presets?.find((p) => p.id === v)?.name)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Use global default</SelectItem>
                        {presets?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel label="Default persona" />
                    <Select value={form.defaultPersonaId ?? "__none"} onValueChange={(v) => set("defaultPersonaId", v === "__none" ? null : (v as string))}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{(v: string) => (v === "__none" ? "Use global default" : personas?.find((p) => p.id === v)?.name)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Use global default</SelectItem>
                        {personas?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <FieldLabel label="Lorebooks" hint="Linked lorebooks are active in every chat with this character." />
                  <p className="-mt-1 mb-2 text-xs text-muted-foreground">({form.lorebookIds.length} selected)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {books?.map((b) => {
                      const on = form.lorebookIds.includes(b.id);
                      return (
                        <button
                          key={b.id}
                          onClick={() => set("lorebookIds", on ? form.lorebookIds.filter((x) => x !== b.id) : [...form.lorebookIds, b.id])}
                          className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors", on ? "bg-brand/15 font-medium" : "surface-well text-muted-foreground hover:text-foreground")}
                        >
                          {on ? <Check className="size-3" /> : <BookOpen className="size-3" />} {b.name}
                        </button>
                      );
                    })}
                    {!books?.length && <span className="text-xs text-muted-foreground">No lorebooks yet.</span>}
                  </div>
                </div>
                <TextField {...writingField("creatorNotes", "Creator notes")} hint="Not included in the roleplay prompt." multiline rows={3} showTokens={false} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField {...writingField("creator", "Creator")} />
                  <TextField {...writingField("characterVersion", "Version")} />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Live preview */}
          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <div className="surface-grain rounded-2xl p-4">
              <div className="mb-3 text-sm font-semibold tracking-tight">Preview</div>
              <div className="flex flex-col items-center gap-2 pb-3 text-center">
                <EntityAvatar name={form.name || "?"} src={form.avatar} color={form.color} size={64} />
                <div className="font-semibold">{form.name || "Unnamed"}</div>
                {form.tagline && <div className="text-xs text-muted-foreground">{form.tagline}</div>}
              </div>
              {form.firstMessage ? (
                <div className="max-h-80 overflow-y-auto rounded-xl rounded-tl-sm bg-background px-3 py-2 text-[13px]">
                  <Markdown text={applyMacros(form.firstMessage, { char: form.name || "Character", user: personas?.[0]?.name ?? "You" })} />
                </div>
              ) : (
                <div className="surface-well rounded-xl p-4 text-center text-xs text-muted-foreground">Write a first message to see it here.</div>
              )}
            </div>
            <div className="surface-grain rounded-2xl p-4 text-sm">
              <div className="mb-3 text-sm font-semibold tracking-tight">Token budget</div>
              <Meter label="Permanent (every message)" value={permanent} max={2000} />
              <Meter label="Example dialogue" value={examples} max={1000} />
              <p className="mt-3 text-[11px] text-muted-foreground">Permanent tokens are sent with every request. Keep them lean so more chat history fits.</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{value} tok</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <motion.div className={cn("h-full rounded-full", pct > 90 ? "bg-destructive" : pct > 60 ? "bg-brand" : "bg-emerald-500")} animate={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function GreetingItem({ id, value, index, onChange, onRemove, action }: { id: string; value: string; index: number; onChange: (v: string) => void; onRemove: () => void; action: React.ReactNode }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={id} dragListener={false} dragControls={controls} className="surface-grain relative flex gap-2 rounded-xl p-2">
      <button onPointerDown={(e) => controls.start(e)} className="cursor-grab touch-none px-0.5 text-muted-foreground active:cursor-grabbing" aria-label="Drag to reorder">
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          <label htmlFor={id} className="text-xs text-muted-foreground">Greeting {index + 2}</label>
          {action}
        </div>
        <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="field-sizing-content min-h-16 w-full resize-none bg-transparent text-sm leading-relaxed outline-none" placeholder="Another way to open the scene…" />
      </div>
      <button onClick={onRemove} className="self-start rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Remove greeting">
        <X className="size-4" />
      </button>
    </Reorder.Item>
  );
}

