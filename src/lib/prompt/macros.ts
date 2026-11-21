export interface MacroContext {
  char: string;
  user: string;
  persona?: string;
  model?: string;
  lastMessageAt?: Date | null;
  now?: Date;
  /** Deterministic randomness for tests. */
  random?: () => number;
}

function rollDice(spec: string, rnd: () => number) {
  const m = spec.trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return spec;
  const n = Math.min(parseInt(m[1] || "1", 10), 100);
  const sides = Math.max(parseInt(m[2], 10), 1);
  let total = m[3] ? parseInt(m[3], 10) : 0;
  for (let i = 0; i < n; i++) total += 1 + Math.floor(rnd() * sides);
  return String(total);
}

function humanDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return "a few seconds";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

export function applyMacros(text: string, ctx: MacroContext): string {
  if (!text || !text.includes("{{")) return text ?? "";
  const rnd = ctx.random ?? Math.random;
  const now = ctx.now ?? new Date();
  return text.replace(/\{\{\s*([a-zA-Z_]+)(?::([^}]*))?\s*\}\}/g, (full, rawName: string, arg?: string) => {
    const name = rawName.toLowerCase();
    switch (name) {
      case "char":
        return ctx.char;
      case "user":
        return ctx.user;
      case "persona":
        return ctx.persona ?? "";
      case "model":
        return ctx.model ?? "";
      case "time":
        return now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      case "date":
        return now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      case "weekday":
        return now.toLocaleDateString("en-US", { weekday: "long" });
      case "idle_duration":
        return ctx.lastMessageAt ? humanDuration(now.getTime() - ctx.lastMessageAt.getTime()) : "a while";
      case "random": {
        const opts = (arg ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        return opts.length ? opts[Math.floor(rnd() * opts.length)] : "";
      }
      case "roll":
        return rollDice(arg ?? "1d6", rnd);
      case "newline":
        return "\n";
      case "trim":
        return "";
      default:
        return full;
    }
  });
}
