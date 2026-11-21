"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Info, Minus, Plus } from "lucide-react";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ModelPicker } from "@/components/common/model-picker";
import { ParamSlider, SAMPLERS } from "@/components/common/param-controls";
import { qk, useModels, usePresets, useTemplates, type ChatInfo, type PresetT } from "@/lib/client/queries";
import { rpc, type ProcInput } from "@/lib/client/rpc";
import type { PresetParams } from "@/lib/types";

/** A titled block in the chat side panel. Put its controls in a <Group>. */
export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-6 items-center justify-between gap-2 px-1">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Borderless grain surface holding a section's controls. `className` replaces the default spacing. */
export function Group({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("surface-grain rounded-xl p-3", className ?? "space-y-3")}>{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs font-medium text-muted-foreground">{children}</div>;
}

export function GenerationPanel({ info }: { info: ChatInfo }) {
  const qc = useQueryClient();
  const { data: presets } = usePresets();
  const { data: templates } = useTemplates();
  const { data: models } = useModels();
  const preset = presets?.find((p) => p.id === info.effectivePresetId) ?? presets?.[0];
  const model = models?.find((m) => m.id === preset?.modelId) ?? null;
  const [note, setNote] = useState(info.chat.authorsNote);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setNote(info.chat.authorsNote), [info.chat.authorsNote, info.chat.id]);

  const updateChat = async (patch: Omit<ProcInput<"chats.update">, "id">) => {
    await rpc("chats.update", { ...patch, id: info.chat.id });
    qc.invalidateQueries({ queryKey: qk.chat(info.chat.id) });
  };

  const updatePreset = async (patch: { modelId?: string; params?: PresetParams }) => {
    if (!preset) return;
    qc.setQueryData<PresetT[]>(qk.presets, (old) => old?.map((p) => (p.id === preset.id ? { ...p, ...patch, params: patch.params ?? p.params } : p)));
    await rpc("presets.update", { id: preset.id, modelId: patch.modelId, params: patch.params as Record<string, unknown> | undefined });
  };
  const setParam = (k: keyof PresetParams, v: unknown) => {
    if (!preset) return;
    const params = { ...(preset.params as PresetParams) };
    if (v === undefined) Reflect.deleteProperty(params, k);
    else (params as Record<string, unknown>)[k] = v;
    void updatePreset({ params });
  };

  return (
    <div className="space-y-6">
      <Section
        title="Setup"
        action={
          preset && (
            <Link href={`/presets?id=${preset.id}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Full editor <ExternalLink className="size-3" />
            </Link>
          )
        }
      >
        <Group>
          <div>
            <Label>Preset</Label>
            <Select value={info.chat.presetId ?? "__default"} onValueChange={(v) => updateChat({ presetId: v === "__default" ? null : (v as string) })}>
              <SelectTrigger className="w-full" aria-label="Preset">
                <SelectValue>{(v: string) => (v === "__default" ? `Default (${presets?.find((p) => p.id === info.effectivePresetId)?.name ?? "…"})` : presets?.find((p) => p.id === v)?.name)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default">Use default</SelectItem>
                {presets?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {preset && (
            <div>
              <Label>Model</Label>
              {/* Reasoning effort lives in the chat input (brain button), not here. */}
              <ModelPicker value={preset.modelId} onChange={(id) => updatePreset({ modelId: id })} />
            </div>
          )}
          <div>
            <Label>Prompt template</Label>
            <Select value={info.chat.templateId ?? "__default"} onValueChange={(v) => updateChat({ templateId: v === "__default" ? null : (v as string) })}>
              <SelectTrigger className="w-full" aria-label="Prompt template">
                <SelectValue>{(v: string) => (v === "__default" ? "Use default" : templates?.find((t) => t.id === v)?.name)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default">Use default</SelectItem>
                {templates?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Group>
      </Section>

      {preset && (
        <Section title="Sampling">
          <Group className="space-y-4">
            {SAMPLERS.filter((s) => ["temperature", "minP", "topP", "repetitionPenalty", "maxTokens", "targetWords"].includes(s.key)).map((d) => (
              <ParamSlider key={d.key} def={d} model={model} value={(preset.params as PresetParams)[d.key] as number | undefined} onChange={(v) => setParam(d.key, v)} />
            ))}
          </Group>
          <p className="px-1 text-xs text-muted-foreground">Edits the “{preset.name}” preset, so every chat using it changes too.</p>
        </Section>
      )}

      <Section title="Author's note">
        <Group>
          <Textarea
            value={note}
            aria-label="Author's note"
            placeholder="Steer the story, e.g. “Keep the tone tense. It's about to rain.”"
            className="min-h-20 text-sm"
            onChange={(e) => {
              setNote(e.target.value);
              if (noteTimer.current) clearTimeout(noteTimer.current);
              const v = e.target.value;
              noteTimer.current = setTimeout(() => updateChat({ authorsNote: v }), 600);
            }}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              Insert depth
              <Tooltip>
                <TooltipTrigger render={<button type="button" aria-label="What is insert depth?" className="text-muted-foreground/70 transition-colors hover:text-foreground" />}>
                  <Info className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 text-left leading-snug">
                  How many messages from the end the note is placed. 0 = right before the reply (strongest, but the model may fixate on it). Higher reads as gentle background guidance. 2–4 suits ongoing tone, 0–1 a one-off nudge.
                </TooltipContent>
              </Tooltip>
            </span>
            <DepthStepper key={info.chat.id} initial={info.chat.authorsNoteDepth} onCommit={(v) => updateChat({ authorsNoteDepth: v })} />
          </div>
        </Group>
      </Section>
    </div>
  );
}

const DEPTH_MIN = 0;
const DEPTH_MAX = 50;

/** −/+ stepper for the author's note depth: shadcn Input and Buttons, no native spinner. */
function DepthStepper({ initial, onCommit }: { initial: number; onCommit: (v: number) => void }) {
  const [value, setValue] = useState(String(initial));
  const saved = useRef(initial);
  const clamp = (n: number) => Math.max(DEPTH_MIN, Math.min(DEPTH_MAX, n));
  const current = clamp(parseInt(value, 10) || 0);
  const commit = (n: number) => {
    const v = clamp(n);
    setValue(String(v));
    if (v !== saved.current) {
      saved.current = v;
      onCommit(v);
    }
  };
  return (
    <div className="flex items-center gap-0.5">
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Decrease insert depth" disabled={current <= DEPTH_MIN} onClick={() => commit(current - 1)}>
        <Minus />
      </Button>
      <Input
        inputMode="numeric"
        aria-label="Insert depth"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 2))}
        onBlur={() => commit(value === "" ? saved.current : current)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            commit(current + (e.key === "ArrowUp" ? 1 : -1));
          } else if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-7 w-10 px-1 text-center text-sm tabular-nums"
      />
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Increase insert depth" disabled={current >= DEPTH_MAX} onClick={() => commit(current + 1)}>
        <Plus />
      </Button>
    </div>
  );
}
