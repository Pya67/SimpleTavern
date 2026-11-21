/** Fast client-safe estimate (~3.7 chars/token for English prose). */
export function estimateTokens(text: string | null | undefined) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.7);
}
