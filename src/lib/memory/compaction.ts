/**
 * Pure helpers for hierarchical, branch-safe auto-compaction.
 *
 * A chunk covers a set of message ids. It is valid for the current active path iff every
 * covered message is on the path and none was edited after the chunk was written.
 * Level-N chunks merged into a level-N+1 chunk are hidden while the merged chunk is valid,
 * and resurface automatically if it becomes invalid (e.g. after branching inside its range).
 */

export interface ChunkLike {
  id: string;
  level: number;
  messageIds: string[];
  mergedIntoId: string | null;
  createdAt: Date;
  userEdited?: boolean;
}

export interface PathMsgLike {
  id: string;
  updatedAt: Date;
  hidden?: boolean;
  tokens: number;
}

export function isChunkValid(chunk: ChunkLike, pathIndex: Map<string, PathMsgLike>) {
  if (!chunk.messageIds.length) return false;
  for (const id of chunk.messageIds) {
    const msg = pathIndex.get(id);
    if (!msg) return false;
    // Allow a small clock skew between message update and chunk creation.
    if (msg.updatedAt.getTime() > chunk.createdAt.getTime() + 1000 && !chunk.userEdited) return false;
  }
  return true;
}

/** Returns the effective (top-level, valid) chunks ordered by position in the path. */
export function effectiveChunks<T extends ChunkLike>(chunks: T[], path: PathMsgLike[]) {
  const index = new Map(path.map((p) => [p.id, p]));
  const pos = new Map(path.map((p, i) => [p.id, i]));
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const valid = new Map(chunks.map((c) => [c.id, isChunkValid(c, index)]));

  const visible = (c: T): boolean => {
    if (!valid.get(c.id)) return false;
    if (!c.mergedIntoId) return true;
    const parent = byId.get(c.mergedIntoId);
    // Visible if its merge parent is missing or itself not effective.
    return !parent || !(visible(parent) || ancestorVisible(parent));
  };
  const ancestorVisible = (c: T): boolean => {
    if (!c.mergedIntoId) return false;
    const p = byId.get(c.mergedIntoId);
    return !!p && (visible(p) || ancestorVisible(p));
  };

  const out = chunks.filter((c) => visible(c));
  // Remove overlaps (prefer higher level) to be defensive.
  out.sort((a, b) => b.level - a.level);
  const claimed = new Set<string>();
  const result: T[] = [];
  for (const c of out) {
    if (c.messageIds.some((id) => claimed.has(id))) continue;
    c.messageIds.forEach((id) => claimed.add(id));
    result.push(c);
  }
  result.sort((a, b) => (pos.get(a.messageIds[0]) ?? 0) - (pos.get(b.messageIds[0]) ?? 0));
  return { chunks: result, coveredIds: claimed };
}

export interface CompactionPlanInput {
  path: PathMsgLike[];
  coveredIds: Set<string>;
  historyBudget: number;
  thresholdPct: number;
  keepRecent: number;
  chunkTokens: number;
  force?: boolean;
}

/**
 * Decide the next contiguous batch of messages to summarize, or null.
 * Only messages before the protected recent window are eligible, and the batch must be
 * contiguous and directly follow already-covered history (oldest first).
 */
export function planCompaction(input: CompactionPlanInput): string[] | null {
  const { path, coveredIds } = input;
  const uncovered = path.filter((p) => !coveredIds.has(p.id) && !p.hidden);
  const uncoveredTokens = uncovered.reduce((a, b) => a + b.tokens, 0);
  const threshold = input.historyBudget * input.thresholdPct;
  if (!input.force && uncoveredTokens <= threshold) return null;

  // Protected window: the last `keepRecent` messages (and ~40% of the budget) stay verbatim,
  // but never more than ~55% of the budget, so compaction can always bring history back under
  // the threshold even with small context windows.
  const protectTokens = input.force ? 0 : input.historyBudget * 0.4;
  const maxProtect = input.historyBudget * 0.55;
  let protectedFrom = path.length;
  let acc = 0;
  let count = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    if (count >= input.keepRecent && acc >= protectTokens) break;
    if (count >= 2 && acc + path[i].tokens > maxProtect) break;
    acc += path[i].tokens;
    count++;
    protectedFrom = i;
  }

  const batch: string[] = [];
  let tokens = 0;
  let started = false;
  for (let i = 0; i < protectedFrom; i++) {
    const p = path[i];
    if (coveredIds.has(p.id)) {
      if (started) break; // keep batches contiguous
      continue;
    }
    started = true;
    if (p.hidden) continue;
    batch.push(p.id);
    tokens += p.tokens;
    if (tokens >= input.chunkTokens) break;
  }
  // Avoid tiny summaries unless forced.
  if (!batch.length) return null;
  if (!input.force && tokens < Math.min(input.chunkTokens * 0.3, 600, input.historyBudget * 0.12)) return null;
  return batch;
}

/** Pick the oldest `mergeCount` consecutive same-level chunks to merge, if the level is over its limit. */
export function planMerge<T extends ChunkLike>(effective: T[], mergeAfter: number): T[] | null {
  const levels = new Map<number, T[]>();
  for (const c of effective) {
    const arr = levels.get(c.level) ?? [];
    arr.push(c);
    levels.set(c.level, arr);
  }
  for (const [, arr] of [...levels.entries()].sort((a, b) => a[0] - b[0])) {
    if (arr.length > mergeAfter) {
      const take = Math.max(2, Math.ceil(mergeAfter / 2));
      return arr.slice(0, take);
    }
  }
  return null;
}
