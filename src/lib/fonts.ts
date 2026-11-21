/** Fonts selectable in Settings → Appearance. Each `cssVar` is defined by next/font in app/fonts.ts. */
export const FONTS = [
  { id: "inter", label: "Inter", group: "Sans", cssVar: "--font-inter" },
  { id: "nunito", label: "Nunito", group: "Sans", cssVar: "--font-nunito" },
  { id: "atkinson", label: "Atkinson Hyperlegible", group: "Sans", cssVar: "--font-atkinson" },
  { id: "comic", label: "Comic Neue", group: "Sans", cssVar: "--font-comic" },
  { id: "literata", label: "Literata", group: "Serif", cssVar: "--font-literata" },
  { id: "lora", label: "Lora", group: "Serif", cssVar: "--font-lora" },
  { id: "merriweather", label: "Merriweather", group: "Serif", cssVar: "--font-merriweather" },
  { id: "garamond", label: "EB Garamond", group: "Serif", cssVar: "--font-garamond" },
  { id: "geist-mono", label: "Geist Mono", group: "Mono", cssVar: "--font-geist-mono" },
  { id: "jetbrains", label: "JetBrains Mono", group: "Mono", cssVar: "--font-jetbrains" },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

/** Chat font "auto": Inter-style sans in Bubbles, the serif in Book layout. */
export const CHAT_FONT_AUTO = "auto";

export const fontStack = (id: string | undefined) => {
  const f = FONTS.find((x) => x.id === id);
  return f ? `var(${f.cssVar})` : null;
};

const KEY = "st-fonts";

/** Sets --app-font / --chat-font on <html>; remembered locally so the boot script avoids a flash. */
export function applyFonts(appFont: string | undefined, chatFont: string | undefined) {
  const el = document.documentElement;
  const vars: Record<string, string | null> = { "--app-font": fontStack(appFont), "--chat-font": chatFont === CHAT_FONT_AUTO ? null : fontStack(chatFont) };
  const keep: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v) {
      el.style.setProperty(k, v);
      keep[k] = v;
    } else el.style.removeProperty(k);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(keep));
  } catch {}
}

export const FONT_BOOT_SCRIPT = `try{var f=JSON.parse(localStorage.getItem("${KEY}")||"{}");for(var k in f)document.documentElement.style.setProperty(k,f[k])}catch(e){}`;
