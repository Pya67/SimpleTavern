"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { toast } from "sonner";
import { cn } from "cn";
import { Copy, Eye, EyeOff, GripVertical, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/app/page-header";
import { ModelPicker } from "@/components/common/model-picker";
import { ParamSlider, SAMPLERS } from "@/components/common/param-controls";
import { confirmDialog } from "@/components/common/confirm";
import { FieldLabel, SaveIndicator, TextField } from "@/components/editors/field";
import { useAutosave } from "@/hooks/use-autosave";
import { qk, useModels, usePresets, useSettings, useTemplates, type PresetT } from "@/lib/client/queries";
import { rpc, type ProcOutput } from "@/lib/client/rpc";
import { formatNum } from "@/lib/format";
import type { PresetParams, PromptBlock, PromptBlockKind } from "@/lib/types";

export function PresetsView() {
  const params = useSearchParams();
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Presets & prompts" description="Configure every aspect of generation." />
      <Tabs defaultValue={params.get("tab") ?? "presets"} className="min-h-0 flex-1">
        <div className="borderless-controls px-4 pt-1 md:px-6">
          <TabsList className="surface-well h-9 rounded-lg p-0.5">
            <TabsTrigger value="presets">Generation presets</TabsTrigger>
            <TabsTrigger value="templates">Prompt templates</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="presets" className="borderless-controls min-h-0 overflow-y-auto">
          <PresetsTab initial={params.get("id")} />
        </TabsContent>
        <TabsContent value="templates" className="borderless-controls min-h-0 overflow-y-auto">
          <TemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ListItem({ active, onClick, title, subtitle, isDefault }: { active: boolean; onClick: () => void; title: string; subtitle?: string; isDefault?: boolean }) {
  return (
    <button onClick={onClick} className={cn("surface-grain flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent", active && "bg-brand/12 hover:bg-brand/15")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-sm font-medium">
          {title}
          {isDefault && <Star className="size-3 shrink-0 fill-brand text-brand" />}
        </div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
    </button>
  );
}

function PresetsTab({ initial }: { initial: string | null }) {
  const { data: presets } = usePresets();
  const { data: settings } = useSettings();
  const { data: models } = useModels();
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(initial);
  useEffect(() => {
    if (presets && (!sel || !presets.some((p) => p.id === sel))) setSel(settings?.defaultPresetId ?? presets[0]?.id ?? null);
  }, [presets, sel, settings?.defaultPresetId]);
  const current = presets?.find((p) => p.id === sel);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:grid-cols-[260px_1fr] md:px-6">
      <div className="space-y-1.5">
        {presets?.map((p) => (
          <ListItem key={p.id} active={p.id === sel} onClick={() => setSel(p.id)} title={p.name} subtitle={models?.find((m) => m.id === p.modelId)?.name ?? p.modelId} isDefault={settings?.defaultPresetId === p.id} />
        ))}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={async () => {
            const p = await rpc("presets.create", { name: "New preset", modelId: current?.modelId, params: current?.params as Record<string, unknown> });
            await qc.invalidateQueries({ queryKey: qk.presets });
            setSel(p.id);
          }}
        >
          <Plus /> New preset
        </Button>
      </div>
      <AnimatePresence mode="wait">
        {current && (
          <motion.div key={current.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <PresetEditor preset={current} isDefault={settings?.defaultPresetId === current.id} onSelect={setSel} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PresetEditor({ preset, isDefault, onSelect }: { preset: PresetT; isDefault: boolean; onSelect: (id: string | null) => void }) {
  const qc = useQueryClient();
  const { data: models } = useModels();
  const [form, setForm] = useState({ name: preset.name, modelId: preset.modelId, params: preset.params as PresetParams, contextSize: preset.contextSize });
  const model = models?.find((m) => m.id === form.modelId) ?? null;
  const state = useAutosave(form, async (f) => {
    await rpc("presets.update", { id: preset.id, name: f.name || "Untitled", modelId: f.modelId, params: f.params as Record<string, unknown>, contextSize: f.contextSize ?? null });
    qc.invalidateQueries({ queryKey: qk.presets });
  });
  const setP = (k: keyof PresetParams, v: unknown) =>
    setForm((f) => {
      const params = { ...f.params } as Record<string, unknown>;
      if (v === undefined) Reflect.deleteProperty(params, k);
      else params[k] = v;
      return { ...f, params: params as PresetParams };
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <TextField className="min-w-60 flex-1" label="Preset name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
        <SaveIndicator state={state} />
        <Button
          variant="outline"
          size="sm"
          disabled={isDefault}
          onClick={async () => {
            await rpc("settings.update", { defaultPresetId: preset.id });
            qc.invalidateQueries({ queryKey: qk.settings });
          }}
        >
          <Star /> {isDefault ? "Default" : "Make default"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const n = await rpc("presets.duplicate", { id: preset.id });
            await qc.invalidateQueries({ queryKey: qk.presets });
            onSelect(n.id);
          }}
        >
          <Copy /> Duplicate
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={async () => {
            if (!(await confirmDialog({ title: `Delete preset “${preset.name}”?`, confirmLabel: "Delete", destructive: true }))) return;
            try {
              await rpc("presets.delete", { id: preset.id });
              qc.invalidateQueries({ queryKey: qk.presets });
              onSelect(null);
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          <Trash2 />
        </Button>
      </div>

      <section className="surface-grain grid gap-4 rounded-2xl p-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <FieldLabel label="Model" />
          <ModelPicker value={form.modelId} onChange={(id) => setForm((f) => ({ ...f, modelId: id }))} />
        </div>
        <div>
          <FieldLabel label="Context size override" hint="Leave empty to use the model's full context window." />
          <input
            type="number"
            placeholder={model ? `${formatNum(model.contextLength)} (model max)` : "auto"}
            value={form.contextSize ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, contextSize: e.target.value ? parseInt(e.target.value, 10) : null }))}
            className="surface-well h-9 w-full rounded-lg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          />
        </div>
        <div>
          <FieldLabel label="Seed" hint="Fixed seed for reproducible outputs (if supported)." />
          <input
            type="number"
            placeholder="random"
            value={form.params.seed ?? ""}
            onChange={(e) => setP("seed", e.target.value ? parseInt(e.target.value, 10) : undefined)}
            className="surface-well h-9 w-full rounded-lg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          />
        </div>
      </section>

      <section className="surface-grain rounded-2xl p-5">
        <h3 className="mb-4 text-sm font-semibold">Sampling</h3>
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {SAMPLERS.map((d) => (
            <ParamSlider key={d.key} def={d} model={model} value={form.params[d.key] as number | undefined} onChange={(v) => setP(d.key, v)} />
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------- Templates ----------------

const KIND_INFO: Record<PromptBlockKind, { label: string; desc: string; editable: "full" | "wrapper" | "none" }> = {
  main: { label: "Main prompt", desc: "Core instructions. Overridden by a character's system prompt.", editable: "full" },
  char_description: { label: "Character description", desc: "Wrapper — {{content}} is the description.", editable: "wrapper" },
  char_personality: { label: "Personality", desc: "Wrapper — {{content}} is the personality.", editable: "wrapper" },
  scenario: { label: "Scenario", desc: "Wrapper — {{content}} is the scenario.", editable: "wrapper" },
  persona: { label: "Persona", desc: "Wrapper — {{content}} is your persona's description.", editable: "wrapper" },
  examples: { label: "Example dialogue", desc: "Wrapper — {{content}} is the example dialogue.", editable: "wrapper" },
  lore_before: { label: "Lore (before character)", desc: "Lorebook entries positioned before the character.", editable: "none" },
  lore_after: { label: "Lore (after character)", desc: "Lorebook entries positioned after the character.", editable: "none" },
  memory: { label: "Memory", desc: "Wrapper — {{content}} is the compacted story-so-far.", editable: "wrapper" },
  facts: { label: "Pinned facts", desc: "Wrapper — {{content}} is the list of pinned facts.", editable: "wrapper" },
  history: { label: "Chat history", desc: "The conversation itself (with author's note and depth lore).", editable: "none" },
  post_history: { label: "Post-history instructions", desc: "Sent after the history. Overridden by the character's post-history field.", editable: "full" },
  custom: { label: "Custom block", desc: "Any text you like. Macros are supported.", editable: "full" },
};

type Template = ProcOutput<"templates.list">[number];

function TemplatesTab() {
  const { data: templates } = useTemplates();
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (templates && (!sel || !templates.some((t) => t.id === sel))) setSel(settings?.defaultTemplateId ?? templates[0]?.id ?? null);
  }, [templates, sel, settings?.defaultTemplateId]);
  const current = templates?.find((t) => t.id === sel);
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:grid-cols-[260px_1fr] md:px-6">
      <div className="space-y-1.5">
        {templates?.map((t) => (
          <ListItem key={t.id} active={t.id === sel} onClick={() => setSel(t.id)} title={t.name} subtitle={`${t.blocks.filter((b) => b.enabled).length} blocks`} isDefault={settings?.defaultTemplateId === t.id} />
        ))}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={async () => {
            const t = await rpc("templates.create", { name: "New template", blocks: current?.blocks });
            await qc.invalidateQueries({ queryKey: qk.templates });
            setSel(t.id);
          }}
        >
          <Plus /> New template
        </Button>
        <p className="px-1 pt-2 text-xs text-muted-foreground">
          Macros: <code>{"{{char}}"}</code> <code>{"{{user}}"}</code> <code>{"{{time}}"}</code> <code>{"{{date}}"}</code> <code>{"{{random:a,b}}"}</code> <code>{"{{roll:1d20}}"}</code> <code>{"{{idle_duration}}"}</code>
        </p>
      </div>
      {current && <TemplateEditor key={current.id} template={current} isDefault={settings?.defaultTemplateId === current.id} onDeleted={() => setSel(null)} />}
    </div>
  );
}

function TemplateEditor({ template, isDefault, onDeleted }: { template: Template; isDefault: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(template.name);
  const [blocks, setBlocks] = useState<PromptBlock[]>(template.blocks as PromptBlock[]);
  const state = useAutosave({ name, blocks }, async (v) => {
    await rpc("templates.update", { id: template.id, name: v.name || "Untitled", blocks: v.blocks });
    qc.invalidateQueries({ queryKey: qk.templates });
  });
  const update = (id: string, patch: Partial<PromptBlock>) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <TextField className="min-w-60 flex-1" label="Template name" value={name} onChange={setName} />
        <SaveIndicator state={state} />
        <Button
          variant="outline"
          size="sm"
          disabled={isDefault}
          onClick={async () => {
            await rpc("settings.update", { defaultTemplateId: template.id });
            qc.invalidateQueries({ queryKey: qk.settings });
          }}
        >
          <Star /> {isDefault ? "Default" : "Make default"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={async () => {
            if (!(await confirmDialog({ title: `Delete template “${template.name}”?`, confirmLabel: "Delete", destructive: true }))) return;
            try {
              await rpc("templates.delete", { id: template.id });
              qc.invalidateQueries({ queryKey: qk.templates });
              onDeleted();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          <Trash2 />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Drag blocks to change the order they are sent in. Adjacent system blocks before the history are merged into one system message.</p>
      <Reorder.Group axis="y" values={blocks} onReorder={setBlocks} className="space-y-2">
        {blocks.map((b) => (
          <BlockRow key={b.id} block={b} onChange={(p) => update(b.id, p)} onRemove={() => setBlocks((bs) => bs.filter((x) => x.id !== b.id))} />
        ))}
      </Reorder.Group>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setBlocks((bs) => [...bs, { id: crypto.randomUUID(), kind: "custom", enabled: true, role: "system", label: "Custom block", content: "" }])}
      >
        <Plus /> Add custom block
      </Button>
    </div>
  );
}

function BlockRow({ block, onChange, onRemove }: { block: PromptBlock; onChange: (p: Partial<PromptBlock>) => void; onRemove: () => void }) {
  const controls = useDragControls();
  const info = KIND_INFO[block.kind];
  const [open, setOpen] = useState(false);
  return (
    <Reorder.Item value={block} dragListener={false} dragControls={controls} className={cn("surface-grain rounded-xl", !block.enabled && "opacity-55", block.kind === "history" && "bg-brand/10")}>
      <div className="flex items-center gap-2 px-2 py-2">
        <button onPointerDown={(e) => controls.start(e)} className="cursor-grab touch-none px-1 text-muted-foreground active:cursor-grabbing" aria-label="Drag">
          <GripVertical className="size-4" />
        </button>
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium">{block.label || info.label}</div>
          <div className="truncate text-xs text-muted-foreground">{info.desc}</div>
        </button>
        <Select value={block.role} onValueChange={(v) => onChange({ role: v as PromptBlock["role"] })}>
          <SelectTrigger size="sm" className="w-24" disabled={block.kind === "history"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">system</SelectItem>
            <SelectItem value="user">user</SelectItem>
            <SelectItem value="assistant">assistant</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon-sm" onClick={() => onChange({ enabled: !block.enabled })} aria-label={block.enabled ? "Disable" : "Enable"}>
          {block.enabled ? <Eye /> : <EyeOff />}
        </Button>
        {block.kind === "custom" && (
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove" className="text-muted-foreground hover:text-destructive">
            <Trash2 />
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && info.editable !== "none" && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-2 px-3 pb-3">
              {block.kind === "custom" && <input value={block.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} placeholder="Label" className="surface-well h-8 w-full rounded-md px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60" />}
              <textarea
                value={block.content ?? ""}
                onChange={(e) => onChange({ content: e.target.value })}
                rows={info.editable === "full" ? 6 : 2}
                placeholder={info.editable === "wrapper" ? "{{content}}" : ""}
                className="surface-well field-sizing-content min-h-16 w-full rounded-lg px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}
