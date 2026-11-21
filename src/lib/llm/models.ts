import "server-only";
import { baseUrl, getApiKey, isMock, orFetch } from "@/lib/llm/openrouter";

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  promptPrice: number; // USD per token
  completionPrice: number;
  supportedParams: string[];
  reasoning: boolean;
  maxCompletion: number | null;
}

let cache: { at: number; mock: boolean; models: ModelInfo[] } | null = null;
const TTL = 24 * 60 * 60 * 1000;

export async function listModels(force = false): Promise<ModelInfo[]> {
  if (!force && cache && cache.mock === isMock() && Date.now() - cache.at < TTL) return cache.models;
  const key = isMock() ? "mock-key" : await getApiKey();
  const res = await orFetch()(`${baseUrl()}/models`, {
    method: "GET",
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) throw new Error(`Failed to load models (${res.status})`);
  type RawModel = {
    id: string;
    name?: string;
    description?: string;
    context_length?: number;
    pricing?: { prompt?: string; completion?: string };
    supported_parameters?: string[];
    top_provider?: { context_length?: number; max_completion_tokens?: number | null };
  };
  const json = (await res.json()) as { data: RawModel[] };
  const models: ModelInfo[] = json.data.map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    description: m.description ?? "",
    contextLength: m.context_length ?? m.top_provider?.context_length ?? 8192,
    promptPrice: parseFloat(m.pricing?.prompt ?? "0") || 0,
    completionPrice: parseFloat(m.pricing?.completion ?? "0") || 0,
    supportedParams: m.supported_parameters ?? [],
    reasoning: (m.supported_parameters ?? []).includes("reasoning"),
    maxCompletion: m.top_provider?.max_completion_tokens ?? null,
  }));
  models.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), mock: isMock(), models };
  return models;
}

export async function getModel(id: string) {
  try {
    return (await listModels()).find((m) => m.id === id) ?? null;
  } catch {
    return null;
  }
}

export async function checkKey(key?: string) {
  const k = isMock() ? "mock-key" : key ?? (await getApiKey());
  if (!k) return { ok: false as const, error: "No key" };
  const res = await orFetch()(`${baseUrl()}/key`, { method: "GET", headers: { authorization: `Bearer ${k}` } });
  if (!res.ok) return { ok: false as const, error: res.status === 401 ? "Invalid API key" : `Error ${res.status}` };
  const j = (await res.json()) as { data: { label?: string; usage?: number; limit?: number | null; limit_remaining?: number | null } };
  return { ok: true as const, label: j.data.label ?? "", usage: j.data.usage ?? 0, limit: j.data.limit ?? null, remaining: j.data.limit_remaining ?? null };
}
