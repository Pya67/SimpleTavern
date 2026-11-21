import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, round } from "../theme";

/** Soft blue backdrop with a faint blush corner. Static on purpose: animated gradients band and flicker. */
export const Backdrop = () => (
  <AbsoluteFill
    style={{
      backgroundColor: colors.bg,
      backgroundImage: [
        `radial-gradient(ellipse 60% 50% at 18% 10%, oklch(0.72 0.15 245 / 0.16), transparent 70%)`,
        `radial-gradient(ellipse 50% 45% at 88% 95%, oklch(0.82 0.11 350 / 0.10), transparent 70%)`,
      ].join(","),
    }}
  />
);

const GLYPHS = ["✦", "♡", "✧", "⋆", "♡", "˚"];

/** Little sparkles and hearts drifting upwards. */
export const Sparkles = ({ count = 18, seed = "sparkles" }: { count?: number; seed?: string }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }).map((_, i) => {
        const r = (k: string) => random(`${seed}-${i}-${k}`);
        const speed = 0.25 + r("speed") * 0.45; // px per frame
        const y = (((r("y") * (height + 120) - frame * speed) % (height + 120)) + height + 120) % (height + 120) - 60;
        const x = r("x") * width + Math.sin((frame + r("phase") * 300) / 70) * 14;
        const glyph = GLYPHS[Math.floor(r("glyph") * GLYPHS.length)];
        const isHeart = glyph === "♡";
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              fontSize: 16 + r("size") * 22,
              color: isHeart ? colors.blush : colors.brandSoft,
              opacity: 0.18 + r("alpha") * 0.35,
            }}
          >
            {glyph}
          </span>
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * Entrance that springs in once and then sits perfectly still (no lingering sub-pixel motion).
 * Everything starts a beat late so it lands after the scene's crossfade, not during it.
 */
export const useEnter = (delay = 0, damping = 14) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay - Math.round(fps * 0.3), fps, config: { damping, stiffness: 160, mass: 0.8 } });
};

/** A rounded sticker label, e.g. a kaomoji. */
export const Sticker = ({
  children,
  delay = 0,
  rotate = -4,
  tone = "brand",
  style,
}: {
  children: ReactNode;
  delay?: number;
  rotate?: number;
  tone?: "brand" | "blush" | "card";
  style?: CSSProperties;
}) => {
  const t = useEnter(delay, 11);
  const bg = tone === "brand" ? colors.brand : tone === "blush" ? colors.blush : colors.card;
  const fg = tone === "card" ? colors.text : colors.brandInk;
  return (
    <div
      style={{
        position: "absolute",
        padding: "10px 22px",
        borderRadius: 999,
        backgroundColor: bg,
        color: fg,
        fontFamily: round,
        fontWeight: 800,
        fontSize: 34,
        whiteSpace: "nowrap",
        boxShadow: "0 12px 30px oklch(0 0 0 / 0.35)",
        border: tone === "card" ? `1px solid ${colors.border}` : undefined,
        opacity: Math.min(1, t * 1.5),
        transform: `rotate(${rotate}deg) scale(${t >= 0.999 ? 1 : t})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Headline with a small kicker above it. */
export const Caption = ({
  kicker,
  title,
  kaomoji,
  size = 64,
  align = "left",
  style,
}: {
  kicker: string;
  title: string;
  kaomoji?: string;
  size?: number;
  align?: "left" | "center";
  style?: CSSProperties;
}) => {
  const a = useEnter(4, 200);
  const b = useEnter(10, 200);
  const rise = (t: number) => `translateY(${Math.round((1 - t) * 18)}px)`;
  return (
    <div style={{ position: "absolute", display: "flex", flexDirection: "column", gap: 6, textAlign: align, ...style }}>
      <span
        style={{
          fontFamily: round,
          fontWeight: 800,
          fontSize: 24,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: colors.brand,
          opacity: a,
          transform: rise(a),
        }}
      >
        {kicker}
      </span>
      <span
        style={{
          fontFamily: round,
          fontWeight: 900,
          fontSize: size,
          lineHeight: 1.05,
          letterSpacing: -1,
          color: colors.text,
          opacity: b,
          transform: rise(b),
        }}
      >
        {title}
        {kaomoji && <span style={{ color: colors.blush, marginLeft: 18, fontWeight: 700 }}>{kaomoji}</span>}
      </span>
    </div>
  );
};

export const fadeIn = (frame: number, start: number, len = 12) =>
  interpolate(frame, [start, start + len], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
