"use client";
import { useId, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "cn";

export type TagSuggestion = { tag: string; count: number };

const MAX_SUGGESTIONS = 8;

/** Collapse whitespace and stray commas. */
const clean = (s: string) => s.replace(/,/g, " ").replace(/\s+/g, " ").trim();

/**
 * Chips in a single field. With `suggestions`, typing shows matching existing tags (prefix matches first),
 * and a tag that matches an existing one ignoring case reuses its spelling, so "Fantasy" never sits next to "fantasy".
 *
 * Keys: Enter / Tab pick the highlighted suggestion (or add what you typed), "," adds what you typed,
 * ↑ ↓ move, Esc closes the list, Backspace on an empty field removes the last chip.
 */
export function TagInput({
  value,
  onChange,
  suggestions,
  placeholder,
  label,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions?: TagSuggestion[];
  placeholder?: string;
  /** Accessible name for the text field. */
  label: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const q = clean(text).toLowerCase();
  const taken = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);

  const matches = useMemo(() => {
    if (!suggestions) return [];
    const free = suggestions.filter((s) => !taken.has(s.tag.toLowerCase()));
    if (!q) return [...free].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, MAX_SUGGESTIONS);
    return free
      .filter((s) => s.tag.toLowerCase().includes(q))
      .sort((a, b) => Number(!b.tag.toLowerCase().startsWith(q)) - Number(!a.tag.toLowerCase().startsWith(q)) || b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, MAX_SUGGESTIONS);
  }, [suggestions, taken, q]);

  const exact = matches.some((m) => m.tag.toLowerCase() === q);
  const canCreate = !!q && !exact && !taken.has(q);
  // Options: matching tags plus "Create …". Create leads unless an existing tag starts with what you typed,
  // so Enter on "magic" makes "magic" rather than snapping to "magical girl".
  const tagOptions = matches.map((m) => ({ kind: "tag" as const, tag: m.tag, count: m.count }));
  const createOption = canCreate ? [{ kind: "create" as const, tag: clean(text), count: undefined }] : [];
  const prefixHit = matches.some((m) => m.tag.toLowerCase().startsWith(q));
  const options: { kind: "tag" | "create"; tag: string; count?: number }[] = prefixHit ? [...tagOptions, ...createOption] : [...createOption, ...tagOptions];
  const showList = open && !!suggestions && options.length > 0;
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  const add = (raw: string) => {
    const v = clean(raw);
    if (!v) return;
    // Reuse the existing spelling when only the case differs.
    const existing = suggestions?.find((s) => s.tag.toLowerCase() === v.toLowerCase())?.tag ?? v;
    if (!taken.has(existing.toLowerCase())) onChange([...value, existing]);
    setText("");
    setActive(0);
  };
  const remove = (tag: string) => onChange(value.filter((x) => x !== tag));

  const pick = (i: number) => {
    const o = options[i];
    if (o) add(o.tag);
    else add(text);
  };

  return (
    <div className="relative">
      <div
        onMouseDown={(e) => {
          // Clicking the field's padding focuses the text box instead of doing nothing.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
        className="surface-well flex min-h-9 cursor-text flex-wrap items-center gap-1.5 rounded-lg px-2 py-1.5 transition-shadow focus-within:ring-2 focus-within:ring-ring/60"
      >
        {value.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-md bg-foreground/10 py-0.5 pl-2 pr-1 text-xs font-medium">
            {tag}
            <button
              type="button"
              onClick={() => remove(tag)}
              aria-label={`Remove ${tag}`}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          data-bare
          role={suggestions ? "combobox" : undefined}
          aria-label={label}
          aria-expanded={suggestions ? showList : undefined}
          aria-controls={suggestions ? listId : undefined}
          aria-autocomplete={suggestions ? "list" : undefined}
          aria-activedescendant={showList ? `${listId}-${activeIndex}` : undefined}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            // Pasting or typing "a, b, c" adds the finished parts right away.
            if (v.includes(",")) {
              const parts = v.split(",");
              const last = parts.pop() ?? "";
              let next = [...value];
              for (const p of parts) {
                const c = clean(p);
                if (!c) continue;
                const existing = suggestions?.find((s) => s.tag.toLowerCase() === c.toLowerCase())?.tag ?? c;
                if (!next.some((x) => x.toLowerCase() === existing.toLowerCase())) next = [...next, existing];
              }
              if (next.length !== value.length) onChange(next);
              setText(last.trimStart());
            } else setText(v);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            if (clean(text)) add(text);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && suggestions) {
              e.preventDefault();
              setOpen(true);
              setActive((i) => (options.length ? (i + 1) % options.length : 0));
            } else if (e.key === "ArrowUp" && suggestions) {
              e.preventDefault();
              setActive((i) => (options.length ? (i - 1 + options.length) % options.length : 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (showList) pick(activeIndex);
              else add(text);
            } else if (e.key === "Tab" && showList && text) {
              e.preventDefault();
              pick(activeIndex);
            } else if (e.key === "Escape" && showList) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === "Backspace" && !text && value.length) {
              remove(value[value.length - 1]);
            }
          }}
          placeholder={value.length ? "" : placeholder}
          className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-64 overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-xl ring-1 ring-foreground/10"
        >
          {!q && (
            <li role="presentation" className="px-2.5 pb-1 pt-1.5 text-xs text-muted-foreground">
              Your tags
            </li>
          )}
          {options.map((o, i) => (
            <li
              key={`${o.kind}:${o.tag}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              // Keep focus in the text box so picking doesn't blur (and commit) the half-typed text.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
              className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm", i === activeIndex && "bg-accent")}
            >
              {o.kind === "create" ? (
                <>
                  <Plus className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    Create <span className="font-medium">“{o.tag}”</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">
                    <Highlight text={o.tag} query={q} />
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.count}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Bolds the part of a suggestion that matches what you typed. */
function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="font-semibold text-brand">{text.slice(i, i + query.length)}</span>
      {text.slice(i + query.length)}
    </>
  );
}
