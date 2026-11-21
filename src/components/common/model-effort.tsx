"use client";
import { useQueryClient } from "@tanstack/react-query";
import { qk, useModels, useSettings } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import type { ReasoningEffort } from "@/lib/types";

/** Per-model reasoning effort (stored in settings, overrides the preset). */
export function useModelEffort(modelId: string | null | undefined) {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: models } = useModels();
  const model = models?.find((m) => m.id === modelId) ?? null;
  const effort = (modelId && settings?.modelPrefs?.[modelId]?.reasoningEffort) || null;
  const setEffort = async (v: ReasoningEffort | null) => {
    if (!modelId) return;
    qc.setQueryData(qk.settings, (old: typeof settings) =>
      old ? { ...old, modelPrefs: { ...old.modelPrefs, [modelId]: { ...(old.modelPrefs[modelId] ?? {}), reasoningEffort: v ?? undefined } } } : old,
    );
    await rpc("settings.setModelPref", { modelId, reasoningEffort: v });
    qc.invalidateQueries({ queryKey: qk.settings });
  };
  return { model, effort, setEffort, supported: !!model?.reasoning };
}
