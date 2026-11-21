import type { PresetParams, ReasoningEffort } from "@/lib/types";

/**
 * Thinking budget added on top of the reply budget for reasoning models. On OpenRouter,
 * max_tokens covers reasoning + visible text, so without this a thinking model can spend the
 * whole limit thinking and return an empty reply.
 */
export const THINKING_BUDGET: Record<Exclude<ReasoningEffort, "none">, number> = {
  minimal: 1024,
  low: 2048,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
};

/** Reply budget in tokens: the preset limit, raised if needed to fit the target word count. */
export function answerBudget(p: PresetParams) {
  const base = p.maxTokens ?? 600;
  return p.targetWords ? Math.max(base, Math.ceil(p.targetWords * 1.6) + 64) : base;
}
import type { ModelInfo } from "@/lib/llm/models";

/** Map a preset to AI SDK call settings + OpenRouter provider options. Unsupported params are dropped. */
export function toCallSettings(p: PresetParams, model: ModelInfo | null) {
  const supported = model?.supportedParams?.length ? new Set(model.supportedParams) : null;
  const ok = (name: string) => !supported || supported.has(name);

  const settings: {
    temperature?: number;
    topP?: number;
    topK?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    seed?: number;
  } = {};
  if (p.temperature != null && ok("temperature")) settings.temperature = p.temperature;
  if (p.topP != null && ok("top_p")) settings.topP = p.topP;
  if (p.topK != null && p.topK > 0 && ok("top_k")) settings.topK = p.topK;
  if (p.presencePenalty != null && p.presencePenalty !== 0 && ok("presence_penalty")) settings.presencePenalty = p.presencePenalty;
  if (p.frequencyPenalty != null && p.frequencyPenalty !== 0 && ok("frequency_penalty")) settings.frequencyPenalty = p.frequencyPenalty;
  const r = p.reasoning;
  const reasoningOff = r?.effort === "none";
  const thinks = !!model?.reasoning && !reasoningOff;
  if (ok("max_tokens")) {
    let max = answerBudget(p);
    if (thinks) max += r?.enabled && r.maxTokens ? r.maxTokens : THINKING_BUDGET[r?.enabled && r.effort && r.effort !== "none" ? r.effort : "medium"];
    if (model?.maxCompletion) max = Math.min(max, model.maxCompletion);
    settings.maxOutputTokens = max;
  }
  if (p.stop?.length && ok("stop")) settings.stopSequences = p.stop.filter(Boolean);
  if (p.seed != null && ok("seed")) settings.seed = p.seed;

  const or: Record<string, unknown> = { usage: { include: true } };
  if (p.minP != null && p.minP > 0 && ok("min_p")) or.min_p = p.minP;
  if (p.topA != null && p.topA > 0 && ok("top_a")) or.top_a = p.topA;
  if (p.repetitionPenalty != null && p.repetitionPenalty !== 1 && ok("repetition_penalty")) or.repetition_penalty = p.repetitionPenalty;
  if (ok("reasoning") || ok("include_reasoning")) {
    if (reasoningOff) or.reasoning = { effort: "none" };
    else if (r?.enabled)
      or.reasoning = {
        ...(r.maxTokens ? { max_tokens: r.maxTokens } : r.effort ? { effort: r.effort } : { enabled: true }),
        ...(r.exclude ? { exclude: true } : {}),
      };
  }
  const provider: Record<string, unknown> = {};
  if (p.providerOrder?.length) provider.order = p.providerOrder;
  if (p.allowFallbacks === false) provider.allow_fallbacks = false;
  if (Object.keys(provider).length) or.provider = provider;
  if (p.middleOut) or.transforms = ["middle-out"];
  if (p.extraBody?.trim()) {
    try {
      Object.assign(or, JSON.parse(p.extraBody));
    } catch {
      /* ignore invalid JSON; validated in the UI */
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { settings, providerOptions: { openrouter: or } as any };
}
