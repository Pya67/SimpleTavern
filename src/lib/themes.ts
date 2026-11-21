/** Accent palettes. Each sets the brand hue/chroma; neutrals pick up a faint tint of the same hue. */
export const ACCENTS = [
  { id: "amber", label: "Amber", h: 65, c: 0.16 },
  { id: "rose", label: "Rose", h: 12, c: 0.17 },
  { id: "crimson", label: "Crimson", h: 25, c: 0.2 },
  { id: "pink", label: "Pink", h: 350, c: 0.17 },
  { id: "violet", label: "Violet", h: 300, c: 0.17 },
  { id: "indigo", label: "Indigo", h: 270, c: 0.16 },
  { id: "blue", label: "Blue", h: 245, c: 0.15 },
  { id: "teal", label: "Teal", h: 190, c: 0.12 },
  { id: "emerald", label: "Emerald", h: 155, c: 0.15 },
  { id: "lime", label: "Lime", h: 125, c: 0.18 },
  // Monochrome: white on dark themes, near-black on light (see globals.css).
  { id: "white", label: "White", h: 0, c: 0 },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export const BASE_THEMES = ["light", "dark", "black"] as const;

const KEY = "st-accent";
const VARS_KEY = "st-accent-vars";
export const CUSTOM_ACCENT = "custom";
export const DEFAULT_CUSTOM_ACCENT = "#e05d9f";

/** sRGB hex → OKLCH (L 0–1, C, H degrees). */
export function hexToOklch(hex: string) {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 0.002 ? 0 : (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: C, h: (H + 360) % 360 };
}

/** CSS variables a custom accent sets inline on <html>: the exact colour for brand surfaces, its hue for tints. */
export function customAccentVars(hex: string): Record<string, string> {
  const { l, c, h } = hexToOklch(hex);
  const fg = l > 0.62 ? "oklch(0.18 0 0)" : "oklch(0.98 0 0)";
  const hue = h.toFixed(1);
  return {
    "--ah": hue,
    "--ac": Math.min(c, 0.25).toFixed(3),
    "--nh": hue,
    "--brand": hex,
    "--brand-foreground": fg,
    "--sidebar-primary": hex,
    "--sidebar-primary-foreground": fg,
    "--chart-1": hex,
    "--ring": `color-mix(in oklch, ${hex} 60%, transparent)`,
    "--sidebar-ring": `color-mix(in oklch, ${hex} 60%, transparent)`,
  };
}

let applied: string[] = [];

export function applyAccent(id: string, customHex?: string) {
  const el = document.documentElement;
  const isCustom = id === CUSTOM_ACCENT;
  const a = ACCENTS.find((x) => x.id === id) ?? ACCENTS[0];
  el.dataset.accent = isCustom ? CUSTOM_ACCENT : a.id;
  // Clear whatever a previous custom accent set (including the boot script's copy).
  const prev = new Set([...applied, ...Object.keys(customAccentVars("#000000"))]);
  prev.forEach((k) => el.style.removeProperty(k));
  applied = [];
  const vars = isCustom ? customAccentVars(customHex || DEFAULT_CUSTOM_ACCENT) : null;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    applied = Object.keys(vars);
  }
  try {
    localStorage.setItem(KEY, el.dataset.accent);
    if (vars) localStorage.setItem(VARS_KEY, JSON.stringify(vars));
    else localStorage.removeItem(VARS_KEY);
  } catch {}
}

/** Runs before paint (inline in <head>) so the saved accent never flashes. */
export const ACCENT_BOOT_SCRIPT = `try{var d=document.documentElement,a=localStorage.getItem("${KEY}");if(a)d.dataset.accent=a;var v=a==="${CUSTOM_ACCENT}"&&JSON.parse(localStorage.getItem("${VARS_KEY}")||"null");if(v)for(var k in v)d.style.setProperty(k,v[k])}catch(e){}`;

/** next-themes resolves to "black" for the OLED theme; treat it as dark everywhere. */
export const isDarkTheme = (t: string | undefined) => t === "dark" || t === "black";
