export type GenErrorCode = "rate_limit" | "no_credits" | "context" | "auth" | "no_key" | "provider" | "unknown";

export interface GenError {
  code: GenErrorCode;
  message: string;
  hint: string;
}

export function mapError(err: unknown): GenError {
  const e = err as { statusCode?: number; status?: number; message?: string; code?: string; responseBody?: string; data?: { error?: { message?: string } } };
  const status = e?.statusCode ?? e?.status;
  let msg = e?.data?.error?.message ?? e?.message ?? String(err);
  if (e?.responseBody) {
    try {
      msg = JSON.parse(e.responseBody)?.error?.message ?? msg;
    } catch {}
  }
  if (e?.code === "no_key") return { code: "no_key", message: msg, hint: "Open Settings and add your OpenRouter API key." };
  if (status === 429 || /rate limit/i.test(msg)) return { code: "rate_limit", message: msg, hint: "Wait a moment and retry, or switch to another model." };
  if (status === 402 || /credit/i.test(msg)) return { code: "no_credits", message: msg, hint: "Add credits on OpenRouter or pick a free model." };
  if (status === 401 || status === 403) return { code: "auth", message: msg, hint: "Your API key was rejected. Check it in Settings." };
  if (/context length|maximum context|too many tokens/i.test(msg)) return { code: "context", message: msg, hint: "Lower max tokens, reduce the context size, or compact the chat." };
  if (status && status >= 500) return { code: "provider", message: msg, hint: "The provider had a hiccup. Retry, or enable fallbacks in the preset." };
  return { code: "unknown", message: msg, hint: "Retry, or open the prompt inspector for details." };
}
