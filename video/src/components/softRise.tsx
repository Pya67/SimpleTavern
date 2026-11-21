import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import { AbsoluteFill, Easing, interpolate } from "remotion";

type Props = Record<string, never>;

const ease = Easing.bezier(0.33, 0, 0.2, 1);

/**
 * A gentle cross-dissolve: the old scene drifts up a touch while the new one rises into place over it.
 * Offsets are rounded to whole pixels so nothing shimmers on the way.
 */
const SoftRise = ({ children, presentationDirection, presentationProgress }: TransitionPresentationComponentProps<Props>) => {
  const p = ease(presentationProgress);
  const entering = presentationDirection === "entering";
  // The incoming scene (drawn on top, with its own opaque backdrop) dissolves in over a still-solid
  // outgoing scene, so there's no dark dip in the middle.
  const opacity = entering ? interpolate(p, [0, 0.9], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const y = entering ? Math.round((1 - p) * 36) : Math.round(-p * 18);
  return <AbsoluteFill style={{ opacity, transform: `translateY(${y}px)` }}>{children}</AbsoluteFill>;
};

export const softRise = (): TransitionPresentation<Props> => ({ component: SoftRise, props: {} });
