import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { getStaticFiles } from "@remotion/studio";
import { clips, colors, LEAD, round, type ClipInfo, type ClipName } from "../theme";

const fileFor = (name: ClipName) => `clips/${name}.mp4`;
const videoStyle = { width: "100%", height: "100%", display: "block" } as const;

/**
 * Plays a recorded clip at 1:1 size. It holds the first frame for `delay` frames (while the scene
 * fades in), plays the kept segments back to back with the waiting cut out, then holds the last frame.
 */
export const Clip = ({ name, keycaps = true, delay = LEAD }: { name: ClipName; keycaps?: boolean; delay?: number }) => {
  const { fps } = useVideoConfig();
  const info = clips[name];
  const exists = getStaticFiles().some((f) => f.name === fileFor(name));
  if (!info || !exists) return <Missing name={name} />;

  const src = staticFile(fileFor(name));
  let at = 0;
  const parts = info.segments.map(([a, b], i) => {
    const from = Math.round(a * fps);
    const len = Math.max(1, Math.round((b - a) * fps));
    const el = (
      <Sequence key={i} from={at} durationInFrames={len} layout="none">
        <OffthreadVideo src={src} muted trimBefore={from} durationInFrames={len} style={videoStyle} />
      </Sequence>
    );
    at += len;
    return el;
  });
  const firstFrame = Math.round(info.segments[0][0] * fps);
  const lastFrame = Math.max(0, Math.round(info.segments.at(-1)![1] * fps) - 2);

  return (
    <AbsoluteFill>
      <Sequence durationInFrames={delay} layout="none">
        <Freeze frame={firstFrame}>
          <OffthreadVideo src={src} muted style={videoStyle} />
        </Freeze>
      </Sequence>
      <Sequence from={delay} layout="none">
        {parts}
        <Sequence from={at} layout="none">
          <Freeze frame={lastFrame}>
            <OffthreadVideo src={src} muted style={videoStyle} />
          </Freeze>
        </Sequence>
        {keycaps && <Keycaps info={info} />}
      </Sequence>
    </AbsoluteFill>
  );
};

/** Map a time in the recorded file to a frame in the edited (cut) clip. */
function toEditedFrame(info: ClipInfo, t: number, fps: number) {
  let acc = 0;
  for (const [a, b] of info.segments) {
    if (t >= a && t <= b) return Math.round((acc + t - a) * fps);
    acc += b - a;
  }
  return null;
}

/** Pops up a keycap whenever a keyboard shortcut was pressed while recording. */
const Keycaps = ({ info }: { info: ClipInfo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hold = Math.round(fps * 1.1);
  const current = info.keys
    .map((k) => ({ ...k, at: toEditedFrame(info, k.t, fps) }))
    .filter((k): k is typeof k & { at: number } => k.at !== null && frame >= k.at && frame < k.at + hold)
    .at(-1);
  if (!current) return null;
  const local = frame - current.at;
  const t = spring({ frame: local, fps, config: { damping: 12, stiffness: 220 } });
  const out = Math.min(1, Math.max(0, (hold - local) / 8));
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 150 }}>
      <div style={{ display: "flex", gap: 10, opacity: Math.min(t * 1.5, out), transform: `translateY(${Math.round((1 - t) * 20)}px)` }}>
        {current.keys.split(" + ").map((k) => (
          <span
            key={k}
            style={{
              minWidth: 64,
              padding: "10px 20px",
              textAlign: "center",
              borderRadius: 16,
              fontFamily: round,
              fontWeight: 900,
              fontSize: 36,
              color: colors.brandInk,
              backgroundColor: colors.brandSoft,
              boxShadow: `0 6px 0 ${colors.brand}, 0 16px 30px oklch(0 0 0 / 0.45)`,
            }}
          >
            {k}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Missing = ({ name }: { name: ClipName }) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: colors.card, color: colors.muted, fontFamily: round, textAlign: "center" }}>
    <div style={{ fontSize: 56 }}>(・_・;)</div>
    <div style={{ fontSize: 26 }}>
      no clip yet: public/{fileFor(name)}
      <br />
      run <b>npm run capture -- {name}</b>
    </div>
  </AbsoluteFill>
);
