import { describe, expect, it } from "vitest";
import { effectiveChunks, planCompaction, planMerge, type ChunkLike, type PathMsgLike } from "@/lib/memory/compaction";
import { splitFacts } from "@/lib/memory/facts";

const t0 = new Date("2026-01-01T00:00:00Z");
const path = (n: number, tokens = 100): PathMsgLike[] => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, updatedAt: t0, tokens }));
const chunk = (id: string, ids: string[], p: Partial<ChunkLike> = {}): ChunkLike => ({
  id,
  level: 0,
  messageIds: ids,
  mergedIntoId: null,
  createdAt: new Date(t0.getTime() + 60_000),
  ...p,
});

describe("effectiveChunks", () => {
  it("uses valid chunks and their coverage", () => {
    const { chunks, coveredIds } = effectiveChunks([chunk("a", ["m0", "m1"])], path(5));
    expect(chunks.map((c) => c.id)).toEqual(["a"]);
    expect([...coveredIds]).toEqual(["m0", "m1"]);
  });
  it("invalidates chunks whose messages left the path (branching)", () => {
    expect(effectiveChunks([chunk("a", ["m0", "zz"])], path(5)).chunks).toHaveLength(0);
  });
  it("invalidates chunks after an edit unless the memory was hand-edited", () => {
    const p = path(5);
    p[1] = { ...p[1], updatedAt: new Date(t0.getTime() + 3600_000) };
    expect(effectiveChunks([chunk("a", ["m0", "m1"])], p).chunks).toHaveLength(0);
    expect(effectiveChunks([chunk("a", ["m0", "m1"], { userEdited: true })], p).chunks).toHaveLength(1);
  });
  it("hides merged sources while the merged chunk is valid, and resurfaces them otherwise", () => {
    const a = chunk("a", ["m0", "m1"], { mergedIntoId: "c" });
    const b = chunk("b", ["m2", "m3"], { mergedIntoId: "c" });
    const c = chunk("c", ["m0", "m1", "m2", "m3"], { level: 1 });
    expect(effectiveChunks([a, b, c], path(6)).chunks.map((x) => x.id)).toEqual(["c"]);
    const p = path(6);
    p[3] = { ...p[3], updatedAt: new Date(t0.getTime() + 3600_000) };
    expect(effectiveChunks([a, b, c], p).chunks.map((x) => x.id)).toEqual(["a"]);
  });
});

describe("planCompaction", () => {
  it("does nothing under the threshold", () => {
    expect(planCompaction({ path: path(10), coveredIds: new Set(), historyBudget: 10_000, thresholdPct: 0.6, keepRecent: 4, chunkTokens: 500 })).toBeNull();
  });
  it("summarizes the oldest uncovered contiguous batch outside the protected window", () => {
    const batch = planCompaction({ path: path(100), coveredIds: new Set(["m0", "m1"]), historyBudget: 5000, thresholdPct: 0.6, keepRecent: 10, chunkTokens: 500 });
    expect(batch?.[0]).toBe("m2");
    expect(batch).toHaveLength(5);
  });
  it("keeps the recent window verbatim when it fits", () => {
    // Budget 8000: protect >= 30 msgs and >= 40% (3200 tok) -> last 32 messages stay verbatim.
    const batch = planCompaction({ path: path(40), coveredIds: new Set(), historyBudget: 8000, thresholdPct: 0.1, keepRecent: 30, chunkTokens: 5000 })!;
    expect(batch).toHaveLength(8);
    expect(batch[batch.length - 1]).toBe("m7");
  });
  it("shrinks the protected window when it would not fit the budget", () => {
    // 19 messages, keepRecent 30, but the budget only fits ~5 messages: still compacts.
    const batch = planCompaction({ path: path(19), coveredIds: new Set(), historyBudget: 1000, thresholdPct: 0.6, keepRecent: 30, chunkTokens: 600 })!;
    expect(batch).not.toBeNull();
    expect(batch[0]).toBe("m0");
  });
});

describe("planMerge", () => {
  it("merges the oldest chunks once a level overflows", () => {
    const cs = Array.from({ length: 5 }, (_, i) => chunk(`c${i}`, [`m${i}`]));
    expect(planMerge(cs, 8)).toBeNull();
    expect(planMerge(cs, 4)?.map((c) => c.id)).toEqual(["c0", "c1"]);
  });
});

describe("splitFacts", () => {
  it("pulls FACT lines out of a summary", () => {
    const r = splitFacts("They met.\nFACT: Mira owes a favor.\n- FACT: The mill burned.");
    expect(r.text).toBe("They met.");
    expect(r.facts).toEqual(["Mira owes a favor.", "The mill burned."]);
  });
});
