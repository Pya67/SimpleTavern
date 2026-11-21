export function relativeTime(d: string | Date | null | undefined) {
  if (!d) return "";
  const t = typeof d === "string" ? new Date(d) : d;
  const s = (Date.now() - t.getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return t.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function groupByRecency<T>(items: T[], getDate: (t: T) => string | Date) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups: Record<string, T[]> = { Today: [], Yesterday: [], "This week": [], "This month": [], Older: [] };
  for (const it of items) {
    const t = new Date(getDate(it)).getTime();
    if (t >= startToday) groups.Today.push(it);
    else if (t >= startToday - 86400000) groups.Yesterday.push(it);
    else if (t >= startToday - 6 * 86400000) groups["This week"].push(it);
    else if (t >= startToday - 30 * 86400000) groups["This month"].push(it);
    else groups.Older.push(it);
  }
  return Object.entries(groups).filter(([, v]) => v.length);
}

export function formatCost(c: number | null | undefined) {
  if (c == null) return "";
  if (c === 0) return "$0";
  if (c < 0.0001) return "<$0.0001";
  if (c < 0.01) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(c < 1 ? 3 : 2)}`;
}

export function formatNum(n: number | null | undefined) {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function pricePerM(p: number) {
  if (!p) return "free";
  const v = p * 1_000_000;
  return `$${v < 1 ? v.toFixed(2) : v.toFixed(v < 10 ? 2 : 0)}/M`;
}

const PALETTE = ["#f59e0b", "#f472b6", "#60a5fa", "#34d399", "#a78bfa", "#fb7185", "#22d3ee", "#facc15", "#4ade80", "#c084fc"];
export function colorFor(seed: string, explicit?: string | null) {
  if (explicit) return explicit;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}
