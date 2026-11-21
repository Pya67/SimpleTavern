"use client";
import { useQueryClient } from "@tanstack/react-query";
import { qk, useSettings, type ModelInfo } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";

/**
 * A model's provider, as shown by OpenRouter in its name ("Anthropic: Claude …" → "Anthropic").
 * Grouping by that name (not the id prefix) merges the variants OpenRouter uses for one maker:
 * "~anthropic/…" latest-aliases next to "anthropic/…", or "meta-llama/…" next to "meta/…".
 * Falls back to the id prefix for models without a "Provider: " name.
 */
export function providerLabel(m: Pick<ModelInfo, "id" | "name">) {
  const colon = m.name.indexOf(": ");
  if (colon > 0) return m.name.slice(0, colon).trim();
  return (m.id.includes("/") ? m.id.slice(0, m.id.indexOf("/")) : m.id).replace(/^~/, "");
}
/** Names OpenRouter uses inconsistently for the same maker. */
const KEY_ALIASES: Record<string, string> = { mistralai: "mistral", "bytedance seed": "bytedance" };
const LABEL_FOR: Record<string, string> = { mistral: "Mistral", bytedance: "ByteDance" };

/** Stable key for a provider (what the filter stores), e.g. "anthropic", "z.ai". */
export const providerKey = (m: Pick<ModelInfo, "id" | "name">) => {
  const k = providerLabel(m).toLowerCase();
  return KEY_ALIASES[k] ?? k;
};

/** Model name without the "Provider: " prefix ("Anthropic: Claude Fable 5" → "Claude Fable 5"). */
export function shortModelName(m: Pick<ModelInfo, "name">) {
  const colon = m.name.indexOf(": ");
  return colon > 0 ? m.name.slice(colon + 2) : m.name;
}

/** Shown at the top of the provider chooser, in this order. */
export const RECOMMENDED_PROVIDERS = ["anthropic", "deepseek", "google", "z.ai", "openai", "meta", "qwen"];

export interface ProviderInfo {
  id: string;
  label: string;
  count: number;
}

export function listProviders(models: ModelInfo[]): ProviderInfo[] {
  const map = new Map<string, ProviderInfo>();
  for (const m of models) {
    const id = providerKey(m);
    const p = map.get(id) ?? { id, label: LABEL_FOR[id] ?? providerLabel(m), count: 0 };
    p.count++;
    map.set(id, p);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** The provider filter from settings (empty = show everything) and a setter that saves it. */
export function useProviderFilter() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const selected = settings?.ui.modelProviders ?? [];
  const setSelected = async (next: string[]) => {
    qc.setQueryData(qk.settings, (old: typeof settings) => (old ? { ...old, ui: { ...old.ui, modelProviders: next } } : old));
    await rpc("settings.update", { ui: { modelProviders: next } });
    qc.invalidateQueries({ queryKey: qk.settings });
  };
  const filter = (models: ModelInfo[]) => (selected.length ? models.filter((m) => selected.includes(providerKey(m))) : models);
  return { selected, setSelected, filter };
}
