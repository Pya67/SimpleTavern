/** Profile picture shapes (Settings → Appearance), applied app-wide via --avatar-radius on <html>. */
export const AVATAR_SHAPES = [
  { id: "circle", label: "Circle", radius: "50%" },
  { id: "rounded", label: "Rounded", radius: "24%" },
  { id: "square", label: "Square", radius: "0px" },
] as const;

export type AvatarShape = (typeof AVATAR_SHAPES)[number]["id"];

/** Message avatar size in px (Bubbles layout; Book uses three quarters of it). */
export const AVATAR_SIZE = { min: 28, max: 96, default: 48 } as const;

const KEY = "st-avatar-radius";

export function applyAvatarShape(shape: string | undefined) {
  const radius = AVATAR_SHAPES.find((s) => s.id === shape)?.radius ?? AVATAR_SHAPES[0].radius;
  document.documentElement.style.setProperty("--avatar-radius", radius);
  try {
    localStorage.setItem(KEY, radius);
  } catch {}
}

export const AVATAR_BOOT_SCRIPT = `try{var r=localStorage.getItem("${KEY}");if(r)document.documentElement.style.setProperty("--avatar-radius",r)}catch(e){}`;
