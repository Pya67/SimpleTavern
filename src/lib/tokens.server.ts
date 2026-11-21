import "server-only";
import { countTokens as count } from "gpt-tokenizer";

const cache = new Map<string, number>();

/** Approximate token count (o200k). Cached for repeated message bodies. */
export function countTokens(text: string | null | undefined): number {
  if (!text) return 0;
  if (text.length > 200) {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
  }
  const n = count(text);
  if (text.length > 200) {
    if (cache.size > 5000) cache.clear();
    cache.set(text, n);
  }
  return n;
}
