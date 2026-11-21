import type { ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Clip } from "../components/Clip";
import { Backdrop, Caption, Sparkles, Sticker, fadeIn, useEnter } from "../components/Decor";
import { LogoMark } from "../components/Logo";
import { colors, mono, round, sans, type ClipName } from "../theme";

const DESKTOP = { width: 1600, height: 900 };
const PHONE = { width: 430, height: 932 };

/** The recording, shown at exactly its recorded size so text stays razor sharp and nothing wobbles. */
const Window = ({ children, left, top, width, height, radius = 22, delay = 0, body = colors.card }: { children: ReactNode; left: number; top: number; width: number; height: number; radius?: number; delay?: number; body?: string }) => {
  const t = useEnter(delay, 200);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        borderRadius: radius,
        overflow: "hidden",
        backgroundColor: body,
        boxShadow: `0 0 0 1px ${colors.border}, 0 30px 80px oklch(0 0 0 / 0.5), 0 0 120px oklch(0.72 0.15 245 / 0.12)`,
        opacity: Math.min(1, t * 1.4),
        transform: `translateY(${Math.round((1 - t) * 40)}px)`,
      }}
    >
      {children}
    </div>
  );
};

export const DesktopScene = ({ clip, kicker, title, kaomoji, sticker }: { clip: ClipName; kicker: string; title: string; kaomoji?: string; sticker?: string }) => (
  <AbsoluteFill>
    <Backdrop />
    <Sparkles count={14} seed={clip} />
    <Caption kicker={kicker} title={title} kaomoji={kaomoji} size={54} style={{ left: 160, top: 26 }} />
    <Window left={160} top={154} {...DESKTOP} delay={2}>
      <Clip name={clip} />
    </Window>
    {sticker && (
      <Sticker delay={22} rotate={5} tone="blush" style={{ right: 110, top: 118 }}>
        {sticker}
      </Sticker>
    )}
  </AbsoluteFill>
);

export const PhoneScene = ({ clip, kicker, title, kaomoji }: { clip: ClipName; kicker: string; title: string; kaomoji: string }) => {
  const bezel = 12;
  return (
    <AbsoluteFill>
      <Backdrop />
      <Sparkles count={20} seed={clip} />
      <Window left={330 - bezel} top={(1080 - PHONE.height) / 2 - bezel} width={PHONE.width + bezel * 2} height={PHONE.height + bezel * 2} radius={62} body="oklch(0.1 0.01 250)">
        <div style={{ position: "absolute", inset: bezel, borderRadius: 50, overflow: "hidden", backgroundColor: colors.bg }}>
          <div style={{ width: PHONE.width, height: PHONE.height }}>
            <Clip name={clip} />
          </div>
        </div>
      </Window>
      <Caption kicker={kicker} title={title} size={96} style={{ left: 900, right: 140, top: 330 }} />
      <Sticker delay={24} rotate={-6} style={{ left: 900, top: 680 }}>
        {kaomoji}
      </Sticker>
    </AbsoluteFill>
  );
};

/** Cycles through the app's own kaomoji, like the sidebar title does. */
const FACES = ["(˶ᵔ ᵕ ᵔ˶)", "(♡˙︶˙♡)", "(✿◠‿◠)", "(´｡• ᵕ •｡`) ♡", "ʕ•ᴥ•ʔ", "(=^･ω･^=)", "٩(◕‿◕)۶"];
const FaceCycle = ({ every, start }: { every: number; start: number }) => {
  const frame = useCurrentFrame();
  const i = Math.max(0, Math.floor((frame - start) / every));
  const local = (frame - start) % every;
  const pop = Math.min(1, local / 6);
  return (
    <span style={{ display: "inline-block", opacity: fadeIn(frame, start), transform: `translateY(${Math.round((1 - pop) * 8)}px)` }}>
      {FACES[i % FACES.length]}
    </span>
  );
};

export const Intro = () => {
  const { fps } = useVideoConfig();
  const logo = useEnter(0, 9);
  const title = useEnter(8, 200);
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop />
      <Sparkles count={30} seed="intro" />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
      <div style={{ transform: `scale(${logo >= 0.999 ? 1 : logo}) rotate(${Math.round((1 - logo) * -20)}deg)` }}>
        <LogoMark size={190} />
      </div>
      <div style={{ fontFamily: round, fontWeight: 900, fontSize: 132, letterSpacing: -3, color: colors.text, opacity: title, transform: `translateY(${Math.round((1 - title) * 30)}px)` }}>
        SimpleTavern
      </div>
      <div style={{ fontFamily: round, fontWeight: 800, fontSize: 46, color: colors.brandSoft, display: "flex", gap: 18, alignItems: "center" }}>
        <span style={{ opacity: fadeIn(frame, Math.round(fps * 0.5)) }}>cozy roleplay with any AI</span>
        <span style={{ color: colors.blush, minWidth: 260 }}>
          <FaceCycle every={Math.round(fps * 0.45)} start={Math.round(fps * 0.7)} />
        </span>
      </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const TILE = { w: 672, h: 378 };
const MORE: { clip: ClipName; label: string }[] = [
  { clip: "lorebooks", label: "lorebooks ✦" },
  { clip: "sidebar", label: "drag & drop ♡" },
  { clip: "persona", label: "personas (◕‿◕)" },
  { clip: "templates", label: "full prompt control ✧" },
];

export const More = () => {
  const gap = 44;
  const left = (1920 - (TILE.w * 2 + gap)) / 2;
  return (
    <AbsoluteFill>
      <Backdrop />
      <Sparkles count={18} seed="more" />
      <Caption kicker="And so much more" title="Everything, tuned just right" kaomoji="٩(◕‿◕)۶" size={58} style={{ left, top: 34 }} />
      {MORE.map((m, i) => {
        const x = left + (i % 2) * (TILE.w + gap);
        const y = 196 + Math.floor(i / 2) * (TILE.h + 52);
        return (
          <div key={m.clip}>
            <Window left={x} top={y} width={TILE.w} height={TILE.h} radius={18} delay={6 + i * 5}>
              <div style={{ width: DESKTOP.width, height: DESKTOP.height, transform: `scale(${TILE.w / DESKTOP.width})`, transformOrigin: "0 0" }}>
                <Clip name={m.clip} keycaps={false} />
              </div>
            </Window>
            <Sticker delay={16 + i * 5} rotate={i % 2 ? 3 : -3} tone={i % 2 ? "blush" : "brand"} style={{ left: x + 18, top: y + TILE.h - 26, fontSize: 28, padding: "6px 18px" }}>
              {m.label}
            </Sticker>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const Outro = () => {
  const t = useEnter(0, 12);
  const sub = useEnter(10, 200);
  return (
    <AbsoluteFill>
      <Backdrop />
      <Sparkles count={36} seed="outro" />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 34, transform: `scale(${t >= 0.999 ? 1 : 0.85 + t * 0.15})`, opacity: Math.min(1, t * 1.5) }}>
        <LogoMark size={150} />
        <span style={{ fontFamily: round, fontWeight: 900, fontSize: 116, letterSpacing: -3, color: colors.text }}>SimpleTavern</span>
      </div>
      <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 40, color: colors.muted, opacity: sub, transform: `translateY(${Math.round((1 - sub) * 16)}px)` }}>
        your characters, your models, your server <span style={{ color: colors.blush }}>♡</span>
      </div>
      <Sticker delay={22} rotate={-5} style={{ position: "relative", marginTop: 10 }}>
        (｡•̀ᴗ-)✧
      </Sticker>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const SETUP_LINES = [
  { prompt: true, text: "copy .env.example .env" },
  { prompt: true, text: "docker compose --profile app up -d --build" },
  { prompt: false, text: "✓ SimpleTavern is up on http://localhost:3000 ♡" },
];

/** Typewriter terminal: each line types out after the previous one. */
const Terminal = ({ start }: { start: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const perChar = 1.1; // frames per character
  let t = start;
  const lines = SETUP_LINES.map((l) => {
    const begin = t;
    const len = l.prompt ? l.text.length : 1; // output lines appear at once
    t += len * perChar + fps * 0.35;
    const shown = l.prompt ? l.text.slice(0, Math.max(0, Math.floor((frame - begin) / perChar))) : frame >= begin ? l.text : "";
    return { ...l, shown, visible: frame >= begin, typing: frame >= begin && shown.length < l.text.length };
  });
  const caretOn = Math.floor(frame / (fps * 0.5)) % 2 === 0;
  return (
    <div style={{ padding: "26px 32px", fontFamily: mono, fontSize: 27, lineHeight: 1.75, color: colors.text }}>
      {lines.map((l, i) =>
        l.visible ? (
          <div key={i} style={{ color: l.prompt ? colors.text : colors.blush, whiteSpace: "pre" }}>
            {l.prompt && <span style={{ color: colors.brand }}>❯ </span>}
            {l.shown}
            {l.typing && caretOn && <span style={{ color: colors.brand }}>▍</span>}
          </div>
        ) : null,
      )}
    </div>
  );
};

const Need = ({ title, note, delay }: { title: string; note: string; delay: number }) => {
  const t = useEnter(delay, 200);
  const tick = useEnter(delay + 10, 10);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 22,
        padding: "22px 28px",
        borderRadius: 24,
        backgroundColor: colors.card,
        boxShadow: `0 0 0 1px ${colors.border}`,
        opacity: t,
        transform: `translateY(${Math.round((1 - t) * 24)}px)`,
      }}
    >
      <span
        style={{
          width: 52,
          height: 52,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          backgroundColor: colors.brand,
          color: colors.brandInk,
          fontFamily: round,
          fontWeight: 900,
          fontSize: 30,
          transform: `scale(${tick >= 0.999 ? 1 : tick})`,
        }}
      >
        ✓
      </span>
      <div>
        <div style={{ fontFamily: round, fontWeight: 900, fontSize: 40, color: colors.text }}>{title}</div>
        <div style={{ fontFamily: sans, fontSize: 24, color: colors.muted }}>{note}</div>
      </div>
    </div>
  );
};

export const Setup = () => {
  const { fps } = useVideoConfig();
  const host = useEnter(Math.round(fps * 3.6), 200);
  return (
    <AbsoluteFill>
      <Backdrop />
      <Sparkles count={18} seed="setup" />
      <Caption kicker="Run it yourself" title="Running it locally is easy" kaomoji="(๑˃ᴗ˂)ﻭ" size={72} style={{ left: 160, top: 70 }} />

      <div style={{ position: "absolute", left: 160, top: 300, width: 600, display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ fontFamily: round, fontWeight: 800, fontSize: 30, color: colors.brandSoft }}>all you need ♡</div>
        <Need title="Your OpenRouter key" note="every model, pay as you go" delay={14} />
        <Need title="Docker" note="Postgres and the app in one command" delay={24} />
      </div>

      <Window left={830} top={300} width={930} height={330} radius={22} delay={20}>
        <div style={{ display: "flex", gap: 10, padding: "18px 22px 0" }}>
          {["oklch(0.7 0.17 25)", "oklch(0.8 0.15 85)", "oklch(0.75 0.15 150)"].map((c) => (
            <span key={c} style={{ width: 14, height: 14, borderRadius: 99, backgroundColor: c }} />
          ))}
        </div>
        <Terminal start={Math.round(fps * 1.0)} />
      </Window>

      <div
        style={{
          position: "absolute",
          left: 160,
          right: 160,
          top: 700,
          padding: "30px 40px",
          borderRadius: 28,
          display: "flex",
          alignItems: "center",
          gap: 28,
          background: `linear-gradient(100deg, oklch(0.72 0.15 245 / 0.18), oklch(0.82 0.11 350 / 0.12))`,
          boxShadow: `0 0 0 1px ${colors.border}`,
          opacity: host,
          transform: `translateY(${Math.round((1 - host) * 30)}px)`,
        }}
      >
        <span style={{ fontSize: 56, color: colors.brandSoft }}>☁︎</span>
        <div>
          <div style={{ fontFamily: round, fontWeight: 900, fontSize: 40, color: colors.text }}>Want it online, too?</div>
          <div style={{ fontFamily: sans, fontSize: 28, color: colors.muted }}>
            Host it on a VPS with a remote database. More in the <span style={{ color: colors.brandSoft, fontWeight: 600 }}>README</span> ✧
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
