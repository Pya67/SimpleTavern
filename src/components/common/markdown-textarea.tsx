"use client";
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { cn } from "cn";

/**
 * A textarea that shows its markdown styled like a chat message while you type: *actions* in the
 * action colour and italic, **bold**, "dialogue" in the dialogue colour, ((OOC)) dimmed. The
 * markers themselves (**, *, _) stay visible but faint.
 *
 * How: the real <textarea> sits on top with transparent text (so caret, selection, undo, IME and
 * spellcheck are native), over a "backdrop" that renders the same text with styling. Both must
 * lay text out identically, so nothing in the backdrop may change character widths:
 * - italic is synthetic (Inter is loaded without an italic face, so the browser slants it),
 * - bold is a thicker stroke instead of a heavier weight.
 * Padding/typography go on `className` (applied to both layers); the box look goes on `boxClassName`.
 */
type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; boxClassName?: string };

export const MarkdownTextarea = forwardRef<HTMLTextAreaElement, Props>(function MarkdownTextarea({ value, className, boxClassName, onScroll, ...rest }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const back = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ta.current!);
  // Shared layout: wrapping rules must match exactly between the two layers.
  const layout = "m-0 block w-full whitespace-pre-wrap break-words [overflow-wrap:break-word] [word-break:normal] [tab-size:4]";
  return (
    <div className={cn("relative min-w-0", boxClassName)}>
      <div ref={back} aria-hidden className={cn(layout, "text-foreground", className, "pointer-events-none absolute inset-0 overflow-hidden border-0")}>
        {highlight(value)}
        {/* A trailing newline needs a character after it to take up a line, like in the textarea. */}
        {value.endsWith("\n") ? " " : null}
      </div>
      <textarea
        ref={ta}
        value={value}
        onScroll={(e) => {
          if (back.current) back.current.scrollTop = e.currentTarget.scrollTop;
          onScroll?.(e);
        }}
        className={cn(
          layout,
          className,
          "relative resize-none border-0 bg-transparent text-transparent caret-foreground outline-none [-webkit-text-fill-color:transparent] [scrollbar-width:none] placeholder:[-webkit-text-fill-color:color-mix(in_oklch,var(--muted-foreground)_60%,transparent)] [&::-webkit-scrollbar]:hidden",
        )}
        {...rest}
      />
    </div>
  );
});

/* ------------------------------------------------------------------------------------------- */

const PARA = "(?:(?!\\n\\n)[\\s\\S])"; // any char, but never across a blank line
const RULES: { kind: "bold" | "italic" | "quote" | "ooc"; re: RegExp; open: number; close: number }[] = [
  { kind: "bold", re: new RegExp(`\\*\\*(?=\\S)(${PARA}*?\\S)\\*\\*`), open: 2, close: 2 },
  { kind: "italic", re: new RegExp(`(?<!\\*)\\*(?=[^\\s*])(${PARA}*?[^\\s*])\\*(?!\\*)`), open: 1, close: 1 },
  { kind: "italic", re: new RegExp(`(?<![\\w_])_(?=\\S)(${PARA}*?\\S)_(?![\\w_])`), open: 1, close: 1 },
  { kind: "quote", re: /"[^"\n]+"|“[^”\n]+”/, open: 0, close: 0 },
  { kind: "ooc", re: /\(\([^)\n]+\)\)/, open: 0, close: 0 },
];

/** Turn markdown-ish text into styled spans, keeping every character (markers included). */
function highlight(text: string, depth = 0, skip?: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    // Earliest match wins; on a tie, the earlier rule (bold before italic).
    let best: { rule: (typeof RULES)[number]; m: RegExpExecArray } | null = null;
    for (const rule of RULES) {
      if (rule.kind === skip) continue;
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { rule, m };
    }
    if (!best || depth > 6) {
      out.push(rest);
      break;
    }
    const { rule, m } = best;
    if (m.index) out.push(rest.slice(0, m.index));
    const whole = m[0];
    const k = `${depth}-${key++}`;
    if (rule.kind === "quote" || rule.kind === "ooc") {
      out.push(
        <span key={k} className={rule.kind === "quote" ? "md-quote" : "md-ooc"}>
          {highlight(whole, depth + 1, rule.kind)}
        </span>,
      );
    } else {
      const inner = whole.slice(rule.open, whole.length - rule.close);
      out.push(
        <span key={k} className={rule.kind === "bold" ? "md-bold" : "md-italic"}>
          <span className="md-mark">{whole.slice(0, rule.open)}</span>
          {highlight(inner, depth + 1)}
          <span className="md-mark">{whole.slice(whole.length - rule.close)}</span>
        </span>,
      );
    }
    rest = rest.slice(m.index + whole.length);
  }
  return out;
}
