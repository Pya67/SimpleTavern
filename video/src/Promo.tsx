import { Fragment } from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { softRise } from "./components/softRise";
import { colors, SCENES, TRANSITION } from "./theme";
import { DesktopScene, Intro, More, Outro, PhoneScene, Setup } from "./scenes/Scenes";

const T = TransitionSeries;
const timing = linearTiming({ durationInFrames: TRANSITION });

// Each entry is one scene; a soft crossfade sits between every pair.
const scenes: { key: keyof typeof SCENES; el: React.ReactNode }[] = [
  { key: "intro", el: <Intro /> },
  {
    key: "chat",
    el: <DesktopScene clip="chat" kicker="Chat" title="Every word, streamed smooth" kaomoji="(˶ᵔ ᵕ ᵔ˶)" sticker="Ctrl+B · Ctrl+I ✧" />,
  },
  {
    key: "actions",
    el: <DesktopScene clip="actions" kicker="Every reply, your way" title="Swipe, edit & branch" kaomoji="ヾ(＾∇＾)" sticker="keyboard-first ♡" />,
  },
  { key: "mobile", el: <PhoneScene clip="mobile" kicker="On the go" title="Swipe to retry, swipe to edit" kaomoji="(っ˘ω˘ς )" /> },
  {
    key: "theme",
    el: <DesktopScene clip="theme" kicker="Make it yours" title="Light, Dark, Black & every accent" kaomoji="✧˖°" sticker="pick your vibe ♡" />,
  },
  { key: "characters", el: <DesktopScene clip="characters" kicker="Characters" title="Bring your faves along" kaomoji="(ﾉ◕ヮ◕)ﾉ*:・ﾟ✧" /> },
  { key: "more", el: <More /> },
  { key: "setup", el: <Setup /> },
  { key: "outro", el: <Outro /> },
];

export const Promo = () => (
  <AbsoluteFill style={{ backgroundColor: colors.bg }}>
    <T>
      {scenes.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 && <T.Transition presentation={softRise()} timing={timing} />}
          <T.Sequence durationInFrames={SCENES[s.key]}>{s.el}</T.Sequence>
        </Fragment>
      ))}
    </T>
    {/* Music: put a track at public/music.mp3, import Audio/staticFile/interpolate from "remotion", and add:
        <Audio src={staticFile("music.mp3")} volume={(f) => interpolate(f, [0, 30, TOTAL_FRAMES - 60, TOTAL_FRAMES], [0, 0.5, 0.5, 0], { extrapolateRight: "clamp" })} /> */}
  </AbsoluteFill>
);
