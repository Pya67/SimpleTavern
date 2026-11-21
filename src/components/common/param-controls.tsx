"use client";
import { useEffect, useState } from "react";
import { cn } from "cn";
import { RotateCcw } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PresetParams, ReasoningEffort } from "@/lib/types";
import type { ModelInfo } from "@/lib/client/queries";

export interface ParamDef {
  key: keyof PresetParams;
  label: string;
  param: string; // OpenRouter supported_parameters name ("" = not a model param, always available)
  min: number;
  max: number;
  step: number;
  def: number;
  hint: string;
  off?: number; // value meaning "not sent"
}

export const SAMPLERS: ParamDef[] = [
  { key: "temperature", label: "Temperature", param: "temperature", min: 0, max: 2, step: 0.01, def: 1, hint: "Randomness. Higher = more creative, lower = more focused." },
  { key: "topP", label: "Top P", param: "top_p", min: 0, max: 1, step: 0.01, def: 1, hint: "Nucleus sampling: only consider tokens within this cumulative probability." },
  { key: "topK", label: "Top K", param: "top_k", min: 0, max: 200, step: 1, def: 0, off: 0, hint: "Only consider the K most likely tokens. 0 = disabled." },
  { key: "minP", label: "Min P", param: "min_p", min: 0, max: 1, step: 0.01, def: 0, off: 0, hint: "Drop tokens less likely than this fraction of the top token. Great for creative RP." },
  { key: "topA", label: "Top A", param: "top_a", min: 0, max: 1, step: 0.01, def: 0, off: 0, hint: "Dynamic cutoff based on the top token's probability squared." },
  { key: "repetitionPenalty", label: "Repetition penalty", param: "repetition_penalty", min: 1, max: 2, step: 0.01, def: 1, off: 1, hint: "Penalize repeating tokens. 1 = off." },
  { key: "frequencyPenalty", label: "Frequency penalty", param: "frequency_penalty", min: -2, max: 2, step: 0.01, def: 0, off: 0, hint: "Penalize tokens by how often they've appeared." },
  { key: "presencePenalty", label: "Presence penalty", param: "presence_penalty", min: -2, max: 2, step: 0.01, def: 0, off: 0, hint: "Penalize tokens that have appeared at all — encourages new topics." },
  { key: "maxTokens", label: "Max response tokens", param: "max_tokens", min: 16, max: 8192, step: 16, def: 600, hint: "Upper bound on the visible reply. Thinking models get an extra thinking budget on top." },
  { key: "targetWords", label: "Target word count", param: "", min: 0, max: 1500, step: 25, def: 0, off: 0, hint: "Ask the model for replies of about this many words. 0 = no target. Max tokens is raised automatically if it's too small." },
];

export function ParamSlider({ def, value, onChange, model }: { def: ParamDef; value: number | undefined; onChange: (v: number | undefined) => void; model?: ModelInfo | null }) {
  const supported = !def.param || !model?.supportedParams?.length || model.supportedParams.includes(def.param);
  const v = value ?? def.def;
  const [local, setLocal] = useState(String(v));
  useEffect(() => setLocal(String(value ?? def.def)), [value, def.def]);
  const isOff = def.off !== undefined && v === def.off;
  return (
    <div className={cn("space-y-1.5", !supported && "opacity-45")}>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger render={<label className="flex-1 cursor-help text-xs font-medium" />}>
            {def.label}
            {!supported && <span className="ml-1.5 font-normal text-muted-foreground">(not supported by model)</span>}
          </TooltipTrigger>
          <TooltipContent className="max-w-60">{def.hint}</TooltipContent>
        </Tooltip>
        {value !== undefined && value !== def.def && (
          <button onClick={() => onChange(undefined)} className="text-muted-foreground hover:text-foreground" aria-label={`Reset ${def.label}`}>
            <RotateCcw className="size-3" />
          </button>
        )}
        <input
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => {
            const n = parseFloat(local);
            if (Number.isFinite(n)) onChange(Math.min(def.max * 4, Math.max(def.min, n)));
            else setLocal(String(v));
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className={cn("h-6 w-16 rounded-md border bg-transparent px-1.5 text-right text-xs tabular-nums outline-none focus:border-ring", isOff && "text-muted-foreground")}
          disabled={!supported}
        />
      </div>
      <Slider min={def.min} max={def.max} step={def.step} value={[Math.min(def.max, v)]} onValueChange={(vals) => onChange(Array.isArray(vals) ? vals[0] : (vals as number))} disabled={!supported} />
    </div>
  );
}

/** Reasoning effort choices. "default" = don't send anything (the model's own default). */
export const EFFORT_OPTIONS: { v: ReasoningEffort | "default"; label: string; hint: string }[] = [
  { v: "default", label: "Auto", hint: "Model default" },
  { v: "none", label: "Off", hint: "No thinking (if the model allows it)" },
  { v: "minimal", label: "Min", hint: "Minimal thinking" },
  { v: "low", label: "Low", hint: "Light thinking" },
  { v: "medium", label: "Med", hint: "Balanced" },
  { v: "high", label: "High", hint: "Think hard" },
  { v: "xhigh", label: "XHigh", hint: "Think very hard (slow, costly)" },
];
