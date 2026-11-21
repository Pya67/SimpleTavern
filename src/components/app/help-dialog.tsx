"use client";
import { ChevronDown, Keyboard, Layers, LayoutPanelLeft, MessageSquare, PenLine, Sparkles } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "cn";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useUi } from "@/stores/ui";

/**
 * Keyboard shortcuts. Each row: what it does, and one or more key combos (shown as alternatives);
 * a combo is a "+"-separated list of keys. `hint` is a short note under the label.
 */
const SHORTCUTS: {
  title: string;
  rows: { label: string; hint?: string; keys: string[] }[];
}[] = [
  {
    title: "Anywhere",
    rows: [
      { label: "Search & commands", keys: ["Ctrl+K"] },
      { label: "New chat", keys: ["Alt+N"] },
      { label: "Left sidebar", keys: ["Alt+B"] },
      { label: "Side panel", keys: ["Alt+I"] },
      { label: "This help", keys: ["?"] },
      { label: "Close", keys: ["Esc"] },
    ],
  },
  {
    title: "In a chat",
    rows: [
      { label: "Send", hint: "Shift+Enter for a new line", keys: ["Enter"] },
      { label: "Stop the reply", keys: ["Ctrl+.", "Esc"] },
      {
        label: "Other versions of the last reply",
        hint: "While the message box is empty",
        keys: ["←", "→"],
      },
      {
        label: "Edit your last message",
        hint: "While the message box is empty",
        keys: ["↑"],
      },
      { label: "Continue the last reply", keys: ["Alt+C"] },
      { label: "Switch persona", keys: ["Alt+P"] },
      { label: "Jump to the message box", keys: ["Ctrl+/"] },
    ],
  },
  {
    title: "While typing",
    rows: [
      { label: "Bold", keys: ["Ctrl+B"] },
      { label: "Italic", keys: ["Ctrl+I"] },
    ],
  },
];

/** Slash commands: type them in the message box. */
const SLASH: [string, string][] = [
  ["/regen", "New version of the last reply"],
  ["/continue", "Continue the last reply"],
  ["/impersonate", "AI writes your next message"],
  ["/as Name", "Switch persona"],
  ["/sys text", "Narrator line (no reply)"],
  ["/note text", "Set the author's note"],
  ["/pin text", "Pin a fact to memory"],
  ["/compact", "Summarize old messages now"],
  ["/model", "Change the model"],
];

const code = "rounded bg-muted px-1 font-mono text-[11px] text-foreground";

/** The four things everyone needs: shown first, always open. */
const BASICS: { title: string; text: React.ReactNode }[] = [
  {
    title: "Chat",
    text: "Type and press Enter. Send an empty message to let them keep talking.",
  },
  {
    title: "Try another reply",
    text: "Not happy with an answer? Use ‹ › under it to see or make another version.",
  },
  {
    title: "Change a message",
    text: "Hover a message to edit, copy, bookmark or delete it.",
  },
  {
    title: "Style your text",
    text: (
      // Shown as it renders in the chat, so the result is obvious.
      <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          <code className={code}>*waves*</code> → <em className="text-(--action)">waves</em>
        </span>
        <span>
          <code className={code}>**now**</code> → <strong className="font-semibold text-foreground">now</strong>
        </span>
        <span>
          <code className={code}>&quot;Hi!&quot;</code> → <span className="text-(--dialogue)">&quot;Hi!&quot;</span>
        </span>
      </span>
    ),
  },
];

/** Everything else, in closed sections. Plain words, one line each. */
const MORE: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: [string, string][];
}[] = [
  {
    title: "Buttons at the top",
    icon: LayoutPanelLeft,
    items: [
      ["Stats", "Model, number of messages, how full its memory is, and money spent. Click it to change settings."],
      ["Open book", "All your bookmarked messages. Click one to jump there."],
      ["Side panel", "Character info, your persona, settings, memory and lore."],
      ["⋮", "Copy the chat into a new one, download it, or archive it."],
    ],
  },
  {
    title: "More message options",
    icon: MessageSquare,
    items: [
      ["Continue", "Let a reply keep going where it stopped."],
      ["Pin as fact", "Make the story always remember something from this message."],
      ["Hide from context", "Keep the message, but the AI ignores it."],
      ["Branch", "When editing your message, “Save as branch & reply” keeps the old one too."],
    ],
  },
  {
    title: "More in the message box",
    icon: PenLine,
    items: [
      ["Your picture", "Switch who you're speaking as."],
      ["Model & brain", "Choose the AI, and how much it thinks before answering."],
      ["+", "Let the AI write your message, add a narrator line, or steer the story with an author's note."],
      ["/", "Type / to see quick commands."],
    ],
  },
  {
    title: "Memory",
    icon: Layers,
    items: [
      ["Long chats", "Old messages are summarized automatically, so chats can go on forever."],
      ["Pinned facts & lore", "Things the story should always know. Find them in the side panel."],
    ],
  },
];

export function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  const tab = useUi((s) => s.helpTab);
  const set = useUi((s) => s.set);
  return (
    <Dialog open={open} onOpenChange={(o) => set({ helpOpen: o })}>
      <DialogContent className="gap-0 p-0 shadow-2xl ring-transparent sm:max-w-2xl">
        <div className="grain rounded-xl">
          <DialogHeader className="space-y-3 px-5 pb-2 pt-4">
            <div>
              <DialogTitle>{tab === "features" ? "How it works" : "Keyboard shortcuts"}</DialogTitle>
              <DialogDescription className="text-xs">{tab === "features" ? "The basics first. Open a section below if you want more." : "Faster ways to do things."}</DialogDescription>
            </div>
            <div className="surface-well flex w-fit rounded-lg p-0.5" role="tablist">
              {(
                [
                  ["features", "Basics", Sparkles],
                  ["shortcuts", "Shortcuts", Keyboard],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => set({ helpTab: id })}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
                    tab === id ? "bg-popover font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
          </DialogHeader>
          <div className="max-h-[min(70vh,640px)] overflow-y-auto px-5 pb-5 pt-3">{tab === "features" ? <Features /> : <Shortcuts />}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const sectionTitle = "mb-2 px-1 text-sm font-semibold tracking-tight";
/** Recessed group on the grain dialog: rows separated by space, not rules. */
const listBox = "surface-well space-y-0.5 rounded-xl p-1";

function Features() {
  return (
    <div className="space-y-5">
      <div>
        <h3 className={sectionTitle}>The basics</h3>
        <div className={listBox}>
          {BASICS.map((b) => (
            <div key={b.title} className="px-3 py-2 text-sm leading-snug">
              <div className="font-medium">{b.title}</div>
              <div className="mt-0.5 text-muted-foreground">{b.text}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className={sectionTitle}>Want more?</h3>
        <div className={listBox}>
          {MORE.map((s) => (
            <Collapsible key={s.title} className="group/more">
              <CollapsibleTrigger className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-foreground/5">
                <s.icon className="size-4 text-muted-foreground" />
                <span className="flex-1">{s.title}</span>
                <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-data-[open]/more:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
                <dl className="space-y-1.5 px-3 pb-3 pl-9">
                  {s.items.map(([term, desc]) => (
                    <div key={term} className="text-sm leading-snug">
                      <dt className="inline font-medium">{term}: </dt>
                      <dd className="inline text-muted-foreground">{desc}</dd>
                    </div>
                  ))}
                </dl>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </div>
    </div>
  );
}

function Shortcuts() {
  return (
    <div className="space-y-5">
      {SHORTCUTS.map((s) => (
        <section key={s.title}>
          <h3 className={sectionTitle}>{s.title}</h3>
          <div className={listBox}>
            {s.rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-4 px-3 py-2">
                <div className="min-w-0 text-sm leading-snug">
                  <div>{r.label}</div>
                  {r.hint && <div className="text-xs text-muted-foreground">{r.hint}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  {r.keys.map((combo, i) => (
                    <span key={combo} className="flex items-center gap-1.5">
                      {i > 0 && <span>or</span>}
                      <KbdGroup>
                        {combo.split("+").map((k, j) => (
                          <span key={j} className="flex items-center gap-1">
                            {j > 0 && <span className="text-muted-foreground/60">+</span>}
                            <Kbd>{k}</Kbd>
                          </span>
                        ))}
                      </KbdGroup>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h3 className={sectionTitle}>Slash commands</h3>
        <p className="-mt-1 mb-2 px-1 text-xs text-muted-foreground">Type these in the message box and press Enter.</p>
        <div className={listBox}>
          {SLASH.map(([cmd, desc]) => (
            <div key={cmd} className="flex items-center gap-4 px-3 py-2 text-sm">
              <code className="w-28 shrink-0 whitespace-nowrap font-mono text-xs text-brand">{cmd}</code>
              <span className="min-w-0 text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
