import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadNunito } from "@remotion/google-fonts/Nunito";
import { loadFont as loadMono } from "@remotion/google-fonts/GeistMono";
import clipsJson from "./clips.json";

// Inter is the app's UI font; Nunito's round shapes do the cute headlines.
export const sans = loadInter("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;
export const round = loadNunito("normal", { weights: ["700", "800", "900"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;

// The app's Dark theme with the Blue accent (globals.css: --nh 250, --ah 245, --ac 0.15).
export const colors = {
  bg: "oklch(0.165 0.008 250)",
  card: "oklch(0.2 0.009 250)",
  well: "oklch(0.24 0.009 250)",
  border: "oklch(0.3 0.012 250)",
  text: "oklch(0.95 0.01 250)",
  muted: "oklch(0.72 0.02 250)",
  brand: "oklch(0.72 0.15 245)",
  brandSoft: "oklch(0.82 0.09 245)",
  brandInk: "oklch(0.2 0.03 245)",
  // A little pink for hearts and sparkles.
  blush: "oklch(0.82 0.11 350)",
};

export const FPS = 60;
export const sec = (seconds: number) => Math.round(seconds * FPS);

/** How long each crossfade between scenes takes. */
export const TRANSITION = sec(0.7);
/** Still time before a clip starts playing, so the scene has faded in first. */
export const LEAD = TRANSITION + sec(0.25);
/** How long a scene holds on its last frame once the action is over. */
export const LINGER = sec(1.6);

export type ClipName = "chat" | "actions" | "persona" | "mobile" | "theme" | "characters" | "lorebooks" | "sidebar" | "templates";
export type ClipInfo = { duration: number; segments: [number, number][]; keys: { t: number; keys: string }[] };
export const clips = clipsJson as unknown as Partial<Record<ClipName, ClipInfo>>;

/** Frames a clip plays for once the waiting time is cut out (4s placeholder when it isn't recorded yet). */
export const clipFrames = (name: ClipName) => {
  const info = clips[name];
  return info ? sec(info.segments.reduce((s, [a, b]) => s + b - a, 0)) : sec(4);
};

/** A clip scene lasts: lead-in, the clip, a linger, and the outgoing transition. */
export const clipSceneFrames = (...names: ClipName[]) => LEAD + Math.max(...names.map(clipFrames)) + LINGER + TRANSITION;

export const MORE_CLIPS: ClipName[] = ["lorebooks", "sidebar", "persona", "templates"];

export const SCENES = {
  intro: sec(3) + TRANSITION,
  chat: clipSceneFrames("chat"),
  actions: clipSceneFrames("actions"),
  mobile: clipSceneFrames("mobile"),
  theme: clipSceneFrames("theme"),
  characters: clipSceneFrames("characters"),
  more: clipSceneFrames(...MORE_CLIPS),
  setup: sec(7.5) + TRANSITION,
  outro: sec(3.5),
};

export const TOTAL_FRAMES =
  Object.values(SCENES).reduce((a, b) => a + b, 0) - TRANSITION * (Object.keys(SCENES).length - 1);
