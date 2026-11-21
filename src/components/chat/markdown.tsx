"use client";
import { createContext, createElement, memo, useContext, useMemo } from "react";
import { Block, Streamdown, type BlockProps } from "streamdown";

/** Wrap "dialogue" and ((OOC)) in tags so they can be styled. Unterminated quotes are left alone. */
export function rpPreprocess(text: string, streaming = false) {
  let out = text.replace(/(^|[\s(*_—–-])("[^"\n]{1,3000}?"|“[^”\n]{1,3000}?”)/g, (_m, pre: string, q: string) => `${pre}<q>${q}</q>`);
  // While streaming, a quote that's still open at the very end is dialogue in progress: colour it
  // now, so it doesn't flip from plain to dialogue colour when the closing quote arrives.
  if (streaming) out = out.replace(/(^|[\s(*_—–-])("[^"\n]{0,3000}|“[^”\n]{0,3000})$/, (_m, pre: string, q: string) => `${pre}<q>${q}</q>`);
  out = out.replace(/\(\(([^)\n]{1,2000})\)\)/g, (_m, inner: string) => `<span class="rp-ooc">((${inner}))</span>`);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Passthrough({ node, children, ...props }: any) {
  return createElement(node?.tagName ?? "span", props, children);
}

/* ---------------------------------------------------------------------------------------------
 * Chunked blur-in for streamed text.
 *
 * Every word remembers when it first appeared. Words revealed together (one chunk from
 * useSmoothText) share that time, so a chunk blurs + fades in as a unit. The animation is applied
 * with a *negative* delay of the word's age, so re-renders (which recreate spans) continue the
 * animation instead of restarting or snapping it. With a ~5-beat duration, about five chunks are
 * mid-animation at any moment. Birth times are kept per message, so the hand-off from the
 * streaming view to the final view is seamless too.
 * ------------------------------------------------------------------------------------------- */
export const CHUNK_ANIM_MS = 900; // keep in sync with .rp-chunk in globals.css
const SKIP = new Set(["code", "pre", "svg", "math"]);

interface Births {
  /** Birth time per word, keyed by the word's position in the whole message (not per block). */
  t: Map<number, number>;
  /** Words per block from the latest render, to turn a block-local word index into a message position. */
  counts: number[];
  /**
   * Highest word position ever rendered. Anything below it has already been on screen, so it is
   * never animated again — even if the markdown gets re-split into blocks differently mid-stream.
   */
  frontier: number;
}
const birthsByMessage = new Map<string, Births>();

function birthsFor(key: string, create: boolean, existing: string) {
  let b = birthsByMessage.get(key);
  if (!b && create) {
    // "continue": text already on screen counts as old.
    const seeded = existing.trim() ? existing.trim().split(/\s+/).length : 0;
    b = { t: new Map(), counts: [], frontier: seeded };
    birthsByMessage.set(key, b);
    // Only the last few streamed messages can still be animating.
    if (birthsByMessage.size > 6) birthsByMessage.delete(birthsByMessage.keys().next().value!);
  }
  return b ?? null;
}

/** Forget animation state for a key (the optimistic "tmp-assistant" id is reused by every generation). */
export function resetChunkAnimation(key: string) {
  birthsByMessage.delete(key);
}

/** The optimistic id was swapped for the real one: keep the animation state so nothing replays. */
export function renameChunkAnimation(from: string, to: string) {
  const b = birthsByMessage.get(from);
  if (!b || from === to) return;
  birthsByMessage.delete(from);
  birthsByMessage.set(to, b);
}

interface HNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
}

function chunkRehype({ index, births }: { index: number; births: Births }) {
  return (tree: HNode) => {
    const now = performance.now();
    // Message position of this block's first word (earlier blocks rendered first in this pass, or
    // are unchanged since the last one, so their counts are current).
    let offset = 0;
    for (let i = 0; i < index; i++) offset += births.counts[i] ?? 0;
    let w = 0;
    const walk = (node: HNode) => {
      if (!node.children) return;
      const out: HNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && child.value) {
          for (const part of child.value.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) {
              out.push({ type: "text", value: part });
              continue;
            }
            const key = offset + w++;
            let born = births.t.get(key);
            // Unknown word below the frontier = already shown before (re-keyed): treat as old.
            if (born == null) births.t.set(key, (born = key < births.frontier ? -Infinity : now));
            const age = now - born;
            if (age >= CHUNK_ANIM_MS) out.push({ type: "text", value: part });
            else
              out.push({
                type: "element",
                tagName: "span",
                properties: { className: ["rp-chunk"], style: `animation-delay:${-Math.round(age)}ms` },
                children: [{ type: "text", value: part }],
              });
          }
        } else {
          if (child.type === "element" && !SKIP.has(child.tagName ?? "")) walk(child);
          out.push(child);
        }
      }
      node.children = out;
    };
    walk(tree);
    births.counts[index] = w;
    births.frontier = Math.max(births.frontier, offset + w);
  };
}

const BirthsCtx = createContext<Births | null>(null);

function ChunkBlock(props: BlockProps) {
  const births = useContext(BirthsCtx);
  const { rehypePlugins, index } = props;
  const plugins = useMemo(
    () => (births ? [...(rehypePlugins ?? []), [chunkRehype, { index, births }]] : rehypePlugins) as BlockProps["rehypePlugins"],
    [births, rehypePlugins, index],
  );
  return <Block {...props} rehypePlugins={plugins} />;
}

export const Markdown = memo(function Markdown({
  text,
  streaming = false,
  animate = true,
  animateKey,
  settled = "",
  variant = "rp",
}: {
  text: string;
  /** "plain" skips roleplay styling (dialogue colouring, OOC) — used for the model's reasoning. */
  variant?: "rp" | "plain";
  streaming?: boolean;
  animate?: boolean;
  /** Message id: enables chunk animation while streaming and lets the final render finish it. */
  animateKey?: string;
  /** Text that was already on screen before this stream began (continue): not re-animated. */
  settled?: string;
}) {
  const processed = useMemo(() => (variant === "plain" ? text : rpPreprocess(text, streaming)), [text, variant, streaming]);
  const births = useMemo(
    () => (animate && animateKey ? birthsFor(animateKey, streaming, settled ? rpPreprocess(settled) : "") : null),
    // Only (re)resolve when the key or mode changes, not on every new chunk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animate, animateKey, streaming],
  );
  return (
    <BirthsCtx.Provider value={births}>
      <Streamdown
        className={variant === "plain" ? "rp-prose rp-thinking" : "rp-prose"}
        // Static mode bypasses BlockComponent; keep block rendering while words may still be animating.
        mode={streaming || births ? "streaming" : "static"}
        isAnimating={streaming}
        animated={false}
        BlockComponent={ChunkBlock}
        parseIncompleteMarkdown
        controls={false}
        allowedTags={{ q: [], span: ["class", "className", "data-macro", "dataMacro"] }}
        fallbackComponent={Passthrough}
        linkSafety={{ enabled: false }}
      >
        {processed}
      </Streamdown>
    </BirthsCtx.Provider>
  );
});
