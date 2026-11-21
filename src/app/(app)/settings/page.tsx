"use client";
import { useEffect, useRef, useState } from "react";
import { download } from "@/lib/client/download";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { cn } from "cn";
import { ArchiveRestore, Check, ChevronDown, CircleDot, Database, Download, FlaskConical, HardDrive, KeyRound, Loader2, LogOut, MessageSquare, Monitor, Moon, Palette, Plus, Sun, Upload, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColorPicker } from "@/components/ui/color-picker";
import { applyFonts, CHAT_FONT_AUTO, fontStack, FONTS } from "@/lib/fonts";
import { applyAvatarShape, AVATAR_SHAPES, AVATAR_SIZE, type AvatarShape } from "@/lib/avatar-shape";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { listProviders, RECOMMENDED_PROVIDERS, useProviderFilter, type ProviderInfo } from "@/lib/client/model-providers";
import { ProviderIcon } from "@/components/common/provider-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ACCENTS, applyAccent, CUSTOM_ACCENT, DEFAULT_CUSTOM_ACCENT, hexToOklch } from "@/lib/themes";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/app/page-header";
import { ModelPicker } from "@/components/common/model-picker";
import { EntityAvatar } from "@/components/common/avatar";
import { confirmDialog } from "@/components/common/confirm";
import { FieldLabel, SaveIndicator } from "@/components/editors/field";
import { useAutosave } from "@/hooks/use-autosave";
import { qk, useModels, usePersonas, usePresets, useSettings, useTemplates } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import { relativeTime } from "@/lib/format";
import type { CompactionSettings, UiPrefs } from "@/lib/types";

const SECTIONS = [
  { id: "connection", label: "Connection", icon: KeyRound },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "memory", label: "Memory", icon: Database },
  { id: "data", label: "Data & account", icon: HardDrive },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

function Card({
  id,
  title,
  description,
  action,
  children,
}: {
  id: SectionId;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 md:scroll-mt-20">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="surface-grain space-y-5 rounded-2xl p-5">{children}</div>
    </section>
  );
}

function Row({ label, hint, children, stack }: { label: string; hint?: string; children: React.ReactNode; /** Put the control under the label on phones (wide controls). */ stack?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-4", stack && "max-sm:flex-col max-sm:items-start max-sm:gap-2")}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SliderRow({ label, value, children, hint }: { label: string; value: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{value}</span>
      </div>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Collapsed group for settings most people never touch. */
function More({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="surface-well rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {label}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-5 px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

/** Highlights the section at the top of the scroll area; a nav click pins its target until scrolling settles. */
function useScrollSpy(rootRef: React.RefObject<HTMLDivElement | null>) {
  const [active, setActive] = useState<SectionId>(SECTIONS[0].id);
  const pinned = useRef<SectionId | null>(null);
  const unpin = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      if (pinned.current) return;
      const line = root.getBoundingClientRect().top + root.clientHeight * 0.3;
      const present = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
      let current = present[0]?.id as SectionId | undefined;
      for (const el of present) if (el.getBoundingClientRect().top <= line) current = el.id as SectionId;
      // At the very bottom the last sections can't reach the line; treat the last one as current.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4 && present.length) current = present[present.length - 1].id as SectionId;
      if (current) setActive(current);
    };
    const settle = () => {
      if (unpin.current) clearTimeout(unpin.current);
      unpin.current = setTimeout(() => {
        pinned.current = null;
      }, 150);
    };
    const onScroll = () => {
      if (pinned.current) settle();
      else update();
    };
    update();
    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      if (unpin.current) clearTimeout(unpin.current);
    };
  }, [rootRef]);

  const go = (id: SectionId) => {
    pinned.current = id;
    setActive(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    // If the page can't scroll (already in place), release the pin anyway.
    if (unpin.current) clearTimeout(unpin.current);
    unpin.current = setTimeout(() => {
      pinned.current = null;
    }, 1000);
  };
  return { active, go };
}

function SettingsNav({ active, onSelect, sections }: { active: SectionId; onSelect: (id: SectionId) => void; sections: readonly (typeof SECTIONS)[number][] }) {
  return (
    <>
      {/* Desktop: vertical list beside the content. */}
      <nav aria-label="Settings sections" className="sticky top-20 hidden w-48 shrink-0 self-start md:block">
        <ul className="space-y-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={active === s.id ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onSelect(s.id);
                }}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active === s.id ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <s.icon className={cn("size-4", active === s.id && "text-brand")} />
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function MobileNav({ active, onSelect, sections }: { active: SectionId; onSelect: (id: SectionId) => void; sections: readonly (typeof SECTIONS)[number][] }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-id="${active}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  return (
    <nav aria-label="Settings sections" className="bg-background/85 backdrop-blur-md md:hidden">
      <div ref={listRef} className="flex gap-1.5 overflow-x-auto px-4 py-2 [scrollbar-width:none]">
        {sections.map((s) => (
          <a
            key={s.id}
            data-id={s.id}
            href={`#${s.id}`}
            aria-current={active === s.id ? "true" : undefined}
            onClick={(e) => {
              e.preventDefault();
              onSelect(s.id);
            }}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs transition-colors",
              active === s.id ? "bg-brand/15 font-medium text-foreground" : "surface-well text-muted-foreground",
            )}
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

export default function SettingsPage() {
  const { data: s } = useSettings();
  if (!s) return <div className="h-full" />;
  return <SettingsBody s={s} />;
}

function SettingsBody({ s }: { s: NonNullable<ReturnType<typeof useSettings>["data"]> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { active, go } = useScrollSpy(rootRef);
  const prefs = useUiPrefs(s.ui);
  return (
    <div ref={rootRef} className="h-full overflow-y-auto">
      <div className="sticky top-0 z-20">
        <PageHeader title="Settings" actions={<SaveIndicator state={prefs.state} />} />
        <MobileNav active={active} onSelect={go} sections={SECTIONS} />
      </div>
      <div className="mx-auto flex max-w-5xl gap-8 px-4 py-6 md:px-6">
        <SettingsNav active={active} onSelect={go} sections={SECTIONS} />
        <div className="borderless-controls min-w-0 flex-1 space-y-10 pb-16">
          <OpenRouterCard mock={s.mock} hasKey={s.hasKey} fromEnv={s.keyFromEnv} />
          <AppearanceCard prefs={prefs} />
          <ChatCard prefs={prefs} defaults={{ preset: s.defaultPresetId, persona: s.defaultPersonaId, template: s.defaultTemplateId }} />
          <CompactionCard initial={s.compaction} />
          <DataCard />
        </div>
      </div>
    </div>
  );
}

/** Appearance and chat preferences share one saved object, edited from two sections. */
function useUiPrefs(initial: UiPrefs) {
  const qc = useQueryClient();
  const [ui, setUi] = useState(initial);
  const state = useAutosave(ui, async (v) => {
    // The provider filter is edited in the Connection section; never write back this stale copy.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { modelProviders, ...rest } = v;
    await rpc("settings.update", { ui: rest as unknown as Record<string, unknown> });
    qc.invalidateQueries({ queryKey: qk.settings });
  });
  const set = <K extends keyof UiPrefs>(k: K, v: UiPrefs[K]) => setUi((u) => ({ ...u, [k]: v }));
  return { ui, setUi, set, state };
}
type Prefs = ReturnType<typeof useUiPrefs>;

function OpenRouterCard({ mock, hasKey, fromEnv }: { mock: boolean; hasKey: boolean; fromEnv: boolean }) {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const credits = useQuery({ queryKey: ["credits"], queryFn: () => rpc("settings.checkKey", {}), enabled: hasKey || mock, staleTime: 60_000 });
  const c = credits.data?.ok ? credits.data : null;
  const money = (n: number) => `$${n.toFixed(2)}`;
  const showForm = !hasKey || editing;
  const cancel = () => {
    setEditing(false);
    setKey("");
  };
  return (
    <Card id="connection" title="Connection">
      {mock && (
        <div className="flex items-start gap-2.5 rounded-xl bg-brand/10 p-3 text-sm">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-brand" />
          <p>
            <span className="font-medium">Mock mode.</span> Replies come from a local simulator, so nothing is sent or billed. Set <code className="font-mono text-xs">OPENROUTER_MOCK=false</code> to use real models.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className={cn("size-2 shrink-0 rounded-full", c ? "bg-emerald-500" : hasKey ? "bg-muted-foreground/50" : "bg-destructive")} aria-hidden />
            {c ? "OpenRouter connected" : hasKey ? "OpenRouter key saved" : "No OpenRouter key"}
          </div>
          <div className="mt-0.5 text-xs tabular-nums text-pretty text-muted-foreground">
            {c
              ? `${c.label || "Key"} · ${money(c.usage)} used · ${c.remaining == null ? "no limit" : `${money(c.remaining)} left`}`
              : hasKey
                ? fromEnv
                  ? "Set in your environment file."
                  : "Checking…"
                : "Add a key to start generating replies."}
          </div>
        </div>
        {hasKey && !editing && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
            {fromEnv ? "Use another key" : "Change key"}
          </Button>
        )}
      </div>
      {showForm && (
        <div className="space-y-2">
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await rpc("settings.setKey", { key });
                setKey("");
                setEditing(false);
                toast.success("API key saved and verified");
                qc.invalidateQueries({ queryKey: qk.settings });
                qc.invalidateQueries({ queryKey: ["credits"] });
                qc.invalidateQueries({ queryKey: qk.models });
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <input
              type="password"
              autoComplete="off"
              aria-label="OpenRouter API key"
              autoFocus={editing}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-or-v1-…"
              className="h-9 min-w-0 flex-1 surface-well rounded-lg px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            />
            <Button type="submit" disabled={busy || key.length < 8}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Save
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            )}
          </form>
          <p className="text-xs text-muted-foreground">Encrypted at rest and only ever sent to OpenRouter.</p>
        </div>
      )}
      <ProviderFilterField />
      {hasKey && !fromEnv && (
        <button
          className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-destructive hover:underline"
          onClick={async () => {
            const ok = await confirmDialog({ title: "Remove saved key?", description: "Replies stop working until you add a key again.", confirmLabel: "Remove key", destructive: true });
            if (!ok) return;
            await rpc("settings.clearKey", {});
            qc.invalidateQueries({ queryKey: qk.settings });
          }}
        >
          Remove saved key
        </button>
      )}
    </Card>
  );
}

/** Pick which providers' models appear in every model picker. None selected = all. */
function ProviderFilterField() {
  const { data: models } = useModels();
  const { selected, setSelected } = useProviderFilter();
  const [open, setOpen] = useState(false);
  const providers = listProviders(models ?? []);
  const recommended = RECOMMENDED_PROVIDERS.map((id) => providers.find((p) => p.id === id)).filter((p): p is ProviderInfo => !!p);
  const others = providers.filter((p) => !RECOMMENDED_PROVIDERS.includes(p.id));
  const label = (id: string) => providers.find((p) => p.id === id)?.label ?? id;
  const toggle = (id: string) => void setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const shown = selected.length ? providers.filter((p) => selected.includes(p.id)).reduce((a, p) => a + p.count, 0) : (models?.length ?? 0);
  return (
    <div className="space-y-2.5 pt-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Model providers</div>
          <div className="text-xs tabular-nums text-muted-foreground">
            {selected.length ? `Pickers show ${shown} of ${models?.length ?? "…"} models.` : "Pickers show every provider."}
          </div>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button variant="outline" size="sm" className="shrink-0" />}>
            <Plus /> Choose
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0">
            <Command>
              <CommandInput placeholder="Search providers…" />
              <CommandList className="max-h-72">
                <CommandEmpty>No providers found.</CommandEmpty>
                {[
                  ["Recommended", recommended],
                  ["All providers", others],
                ].map(([heading, list]) =>
                  (list as ProviderInfo[]).length ? (
                    <CommandGroup key={heading as string} heading={heading as string}>
                      {(list as ProviderInfo[]).map((p) => {
                        const on = selected.includes(p.id);
                        return (
                          <CommandItem key={p.id} value={`${p.label} ${p.id}`} onSelect={() => toggle(p.id)}>
                            <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on && "border-brand bg-brand text-brand-foreground")}>{on && <Check className="size-3" />}</span>
                            <ProviderIcon provider={p.id} label={p.label} />
                            <span className="flex-1 truncate">{p.label}</span>
                            <span className="text-[11px] tabular-nums text-muted-foreground">{p.count}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ) : null,
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((id) => (
            <span key={id} className="flex items-center gap-1.5 rounded-full bg-brand/12 py-0.5 pl-2 pr-1 text-xs">
              <ProviderIcon provider={id} label={label(id)} className="size-3.5" />
              {label(id)}
              <button onClick={() => toggle(id)} aria-label={`Remove ${label(id)}`} className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="size-3" />
              </button>
            </span>
          ))}
          <button onClick={() => void setSelected([])} className="px-1 text-xs text-muted-foreground hover:text-foreground">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="surface-well flex rounded-lg p-0.5">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors", value === o.v ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const CUSTOM_PRESETS = ["#e05d9f", "#ff6b4a", "#f5b13d", "#3ccf91", "#2bb3c0", "#2f6bff", "#8b5cf6", "#94a3b8"];

/** Rainbow swatch that opens the colour picker; shows the chosen colour once it's the active accent. */
function CustomAccentSwatch({ active, value, onChange }: { active: boolean; value: string; onChange: (hex: string) => void }) {
  const light = hexToOklch(value).l > 0.62;
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label="Custom accent"
              aria-pressed={active}
              className={cn(
                "relative flex size-8 items-center justify-center rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring",
                active && "ring-2 ring-foreground/80 ring-offset-2 ring-offset-card",
              )}
              style={{ background: active ? value : "conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #14b8a6, #3b82f6, #8b5cf6, #ec4899, #f43f5e)" }}
            />
          }
        >
          {active ? <Check className={cn("size-4", light ? "text-black/70" : "text-white")} strokeWidth={3} /> : <Plus className="size-4 text-white drop-shadow" strokeWidth={3} />}
        </TooltipTrigger>
        <TooltipContent>Custom color</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-64">
        <ColorPicker value={value} onChange={onChange} presets={CUSTOM_PRESETS} />
      </PopoverContent>
    </Popover>
  );
}

/** A short exchange rendered with the real chat styles, so theme, accent, size and opacity changes show live. */
function ChatPreview({ ui }: { ui: UiPrefs }) {
  const charName = "Reze";
  const myName = "Denji";
  const book = ui.layout === "book";
  const size = ui.avatarSize ?? AVATAR_SIZE.default;
  const avatarPx = book ? Math.round(size * 0.75) : size;
  const row = (isUser: boolean, name: string, avatar: React.ReactNode, body: React.ReactNode) => (
    <div className={cn("flex gap-3", isUser && !book && "flex-row-reverse")}>
      <div className="shrink-0">{avatar}</div>
      <div className={cn("flex min-w-0 flex-1 flex-col", isUser && !book && "items-end")}>
        <span className={cn("mb-1 font-semibold leading-tight", book ? "text-sm" : "text-[15px]")}>{name}</span>
        <div className={cn("min-w-0", !book && isUser ? "grain bubble-user max-w-[85%] rounded-2xl rounded-tr-md bg-bubble-user px-4 py-2.5" : "w-full", isUser && "user-msg")}>
          <div className="rp-prose">{body}</div>
        </div>
      </div>
    </div>
  );
  return (
    <div
      aria-label="Chat preview"
      className={cn("space-y-4 rounded-xl bg-background p-4", book && "layout-book")}
      style={{ ["--chat-font-size" as string]: `${ui.fontSize}px`, ["--chat-text-opacity" as string]: String(ui.textOpacity ?? 1) }}
    >
      {row(
        false,
        charName,
        <EntityAvatar name={charName} src="/preview/reze.webp" color="#6b7280" size={avatarPx} />,
        <p>
          <em>Reze looks at Denji with a dumbfounded expression.</em>{" "}
          <q>&ldquo;Denji, you idiot, stop eating crayons.&rdquo;</q>
        </p>,
      )}
      {row(
        true,
        myName,
        <EntityAvatar name={myName} src="/preview/denji.webp" color="#f59e0b" size={avatarPx} />,
        <p>
          <em>Responds with mouth full.</em> <q>&ldquo;Bro, they are tasty af, you should try &apos;em.&rdquo;</q>
        </p>,
      )}
    </div>
  );
}

/** Font dropdown; every option previews itself in its own typeface. */
function FontSelect({ label, value, onChange, auto }: { label: string; value: string; onChange: (id: string) => void; auto?: boolean }) {
  const name = (id: string) => (id === CHAT_FONT_AUTO ? "Auto" : (FONTS.find((f) => f.id === id)?.label ?? "Inter"));
  const family = (id: string) => fontStack(id) ?? undefined;
  return (
    <Select value={value} onValueChange={(v) => onChange(v as string)}>
      <SelectTrigger aria-label={label} className="w-48">
        <SelectValue>{(v: string) => <span style={{ fontFamily: family(v) }}>{name(v)}</span>}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {auto && <SelectItem value={CHAT_FONT_AUTO}>Auto</SelectItem>}
        {(["Sans", "Serif", "Mono"] as const).map((g) => (
          <SelectGroup key={g}>
            <SelectLabel>{g}</SelectLabel>
            {FONTS.filter((f) => f.group === g).map((f) => (
              <SelectItem key={f.id} value={f.id}>
                <span style={{ fontFamily: family(f.id) }}>{f.label}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function AppearanceCard({ prefs }: { prefs: Prefs }) {
  const { ui, set, setUi } = prefs;
  const { theme, setTheme } = useTheme();
  return (
    <Card id="appearance" title="Appearance">
      <ChatPreview ui={ui} />
      <Row label="Theme" stack>
        <Seg
          value={(theme ?? "system") as "light" | "dark" | "black" | "system"}
          onChange={setTheme}
          options={[
            { v: "light", label: <><Sun className="size-3.5" /> Light</> },
            { v: "dark", label: <><Moon className="size-3.5" /> Dark</> },
            { v: "black", label: <><CircleDot className="size-3.5" /> Black</> },
            { v: "system", label: <><Monitor className="size-3.5" /> Auto</> },
          ]}
        />
      </Row>
      <div>
        <div className="mb-2.5 text-sm font-medium">Accent color</div>
        <div className="flex flex-wrap gap-2.5">
          {ACCENTS.map((a) => {
            const active = (ui.accent || "amber") === a.id;
            return (
              <Tooltip key={a.id}>
                <TooltipTrigger
                  render={
                    <button
                      onClick={() => {
                        applyAccent(a.id);
                        set("accent", a.id);
                      }}
                      aria-label={`${a.label} accent`}
                      aria-pressed={active}
                      className={cn(
                        "relative flex size-8 items-center justify-center rounded-full transition-transform hover:scale-110",
                        a.id === "white" && "border border-foreground/20",
                        active && "ring-2 ring-foreground/80 ring-offset-2 ring-offset-card",
                      )}
                      style={{ background: a.id === "white" ? "oklch(0.98 0 0)" : `oklch(0.75 ${a.c} ${a.h})` }}
                    />
                  }
                >
                  {active && <Check className="size-4 text-black/70" strokeWidth={3} />}
                </TooltipTrigger>
                <TooltipContent>{a.label}</TooltipContent>
              </Tooltip>
            );
          })}
          <CustomAccentSwatch
            active={ui.accent === CUSTOM_ACCENT}
            value={ui.customAccent ?? DEFAULT_CUSTOM_ACCENT}
            onChange={(hex) => {
              applyAccent(CUSTOM_ACCENT, hex);
              setUi((u) => ({ ...u, accent: CUSTOM_ACCENT, customAccent: hex }));
            }}
          />
        </div>
      </div>
      <Row label="Message layout">
        <Seg value={ui.layout} onChange={(v) => set("layout", v)} options={[{ v: "bubbles", label: "Bubbles" }, { v: "book", label: "Book" }]} />
      </Row>
      <SliderRow label="Text size" value={`${ui.fontSize}px`}>
        <Slider min={13} max={20} step={0.5} value={[ui.fontSize]} onValueChange={(v) => set("fontSize", Array.isArray(v) ? v[0] : (v as number))} aria-label="Text size" />
      </SliderRow>
      <More label="More appearance options">
        <Row label="Chat font" hint="Auto: interface font in Bubbles, serif in Book.">
          <FontSelect
            label="Chat font"
            value={ui.chatFont ?? CHAT_FONT_AUTO}
            auto
            onChange={(v) => {
              applyFonts(ui.appFont, v);
              set("chatFont", v);
            }}
          />
        </Row>
        <Row label="Interface font">
          <FontSelect
            label="Interface font"
            value={ui.appFont ?? "inter"}
            onChange={(v) => {
              applyFonts(v, ui.chatFont);
              set("appFont", v);
            }}
          />
        </Row>
        <Row label="Chat width">
          <Seg value={ui.chatWidth} onChange={(v) => set("chatWidth", v)} options={[{ v: "narrow", label: "Narrow" }, { v: "normal", label: "Normal" }, { v: "wide", label: "Wide" }]} />
        </Row>
        <SliderRow label="Text opacity" value={`${Math.round((ui.textOpacity ?? 1) * 100)}%`} hint="Lower it to soften bright message text.">
          <Slider
            min={30}
            max={100}
            step={5}
            value={[Math.round((ui.textOpacity ?? 1) * 100)]}
            onValueChange={(v) => set("textOpacity", (Array.isArray(v) ? v[0] : (v as number)) / 100)}
            aria-label="Chat text opacity"
          />
        </SliderRow>
        <Row label="Profile picture shape">
          <Seg
            value={(ui.avatarShape ?? "circle") as AvatarShape}
            onChange={(v) => {
              applyAvatarShape(v);
              set("avatarShape", v);
            }}
            options={AVATAR_SHAPES.map((a) => ({ v: a.id, label: a.label }))}
          />
        </Row>
        <SliderRow label="Profile picture size" value={`${ui.avatarSize ?? AVATAR_SIZE.default}px`} hint="Next to chat messages.">
          <Slider
            min={AVATAR_SIZE.min}
            max={AVATAR_SIZE.max}
            step={2}
            value={[ui.avatarSize ?? AVATAR_SIZE.default]}
            onValueChange={(v) => set("avatarSize", Array.isArray(v) ? v[0] : (v as number))}
            aria-label="Profile picture size"
          />
        </SliderRow>
      </More>
    </Card>
  );
}

function ChatCard({ prefs, defaults }: { prefs: Prefs; defaults: { preset: string | null; persona: string | null; template: string | null } }) {
  const { ui, set } = prefs;
  const qc = useQueryClient();
  const { data: presets } = usePresets();
  const { data: personas } = usePersonas();
  const { data: templates } = useTemplates();
  const upd = async (patch: { defaultPresetId?: string; defaultPersonaId?: string; defaultTemplateId?: string }) => {
    await rpc("settings.update", patch);
    qc.invalidateQueries({ queryKey: qk.settings });
    toast.success("Default updated");
  };
  const sel = (label: string, value: string | null, items: { id: string; name: string }[] | undefined, onChange: (v: string) => void) => (
    <div>
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      <Select value={value ?? ""} onValueChange={(v) => onChange(v as string)}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue>{(v: string) => items?.find((i) => i.id === v)?.name ?? "—"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items?.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <Card id="chat" title="Chat">
      <div>
        <p className="mb-3 text-xs text-muted-foreground">New chats start with</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {sel("Persona", defaults.persona, personas, (v) => upd({ defaultPersonaId: v }))}
          {sel("Preset", defaults.preset, presets, (v) => upd({ defaultPresetId: v }))}
          {sel("Prompt template", defaults.template, templates, (v) => upd({ defaultTemplateId: v }))}
        </div>
      </div>
      <Row label="Enter sends" hint="When off, use Ctrl+Enter to send.">
        <Switch checked={ui.enterToSend} onCheckedChange={(c) => set("enterToSend", c)} aria-label="Enter sends" />
      </Row>
      <Row label="Smooth streaming">
        <Switch checked={ui.streamSmoothing} onCheckedChange={(c) => set("streamSmoothing", c)} aria-label="Smooth streaming" />
      </Row>
      <Row label="Generation stats" hint="Model, speed and cost under each reply.">
        <Switch checked={ui.showStats} onCheckedChange={(c) => set("showStats", c)} aria-label="Show generation stats" />
      </Row>
    </Card>
  );
}

function CompactionCard({ initial }: { initial: CompactionSettings }) {
  const qc = useQueryClient();
  const [c, setC] = useState(initial);
  const state = useAutosave(c, async (v) => {
    await rpc("settings.update", { compaction: v as unknown as Record<string, unknown> });
    qc.invalidateQueries({ queryKey: qk.settings });
  });
  const set = <K extends keyof CompactionSettings>(k: K, v: CompactionSettings[K]) => setC((x) => ({ ...x, [k]: v }));
  const num = (k: "keepRecent" | "chunkTokens" | "mergeAfter", label: string, hint: string) => (
    <div>
      <FieldLabel label={label} hint={hint} />
      <input type="number" aria-label={label} value={c[k]} onChange={(e) => set(k, Math.max(1, parseInt(e.target.value || "1", 10)))} className="h-9 w-full surface-well rounded-lg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60" />
    </div>
  );
  return (
    <Card id="memory" title="Memory" description="Summarizes older messages so long chats keep their story." action={<SaveIndicator state={state} />}>
      <Row label="Auto-compaction">
        <Switch checked={c.enabled} onCheckedChange={(v) => set("enabled", v)} aria-label="Auto-compaction" />
      </Row>
      {c.enabled && (
        <>
          <div>
            <FieldLabel label="Summarization model" hint="A cheap, fast model works well." />
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">{c.modelId ? <ModelPicker value={c.modelId} onChange={(v) => set("modelId", v)} /> : <div className="surface-well flex h-9 items-center rounded-lg px-3 text-sm text-muted-foreground">Same as chat model</div>}</div>
              {c.modelId ? (
                <Button variant="outline" onClick={() => set("modelId", "")}>
                  Use chat model
                </Button>
              ) : (
                <Button variant="outline" onClick={() => set("modelId", "mock/tavern-flash")}>
                  Pick model
                </Button>
              )}
            </div>
          </div>
          <More label="Advanced">
            <SliderRow label="Compact when history exceeds" value={`${Math.round(c.thresholdPct * 100)}% of budget`}>
              <Slider min={0.2} max={0.95} step={0.05} value={[c.thresholdPct]} onValueChange={(v) => set("thresholdPct", Array.isArray(v) ? v[0] : (v as number))} aria-label="Compaction threshold" />
            </SliderRow>
            <div className="grid gap-4 sm:grid-cols-3">
              {num("keepRecent", "Keep recent", "Keep up to this many latest messages verbatim (fewer if they would not fit the context).")}
              {num("chunkTokens", "Chunk size (tokens)", "How much history goes into each summary.")}
              {num("mergeAfter", "Merge after", "Merge summaries into a higher-level recap once there are this many.")}
            </div>
            <div className="space-y-3">
              <FieldLabel label="Summarization prompts" />
              <textarea aria-label="Summary prompt" value={c.prompt} onChange={(e) => set("prompt", e.target.value)} rows={6} className="field-sizing-content w-full surface-well rounded-lg px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60" />
              <textarea aria-label="Merge prompt" value={c.mergePrompt} onChange={(e) => set("mergePrompt", e.target.value)} rows={4} className="field-sizing-content w-full surface-well rounded-lg px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60" />
            </div>
          </More>
        </>
      )}
    </Card>
  );
}

function DataCard() {
  const restoreRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <Card id="data" title="Data & account" description="A backup also runs every night into data/backups.">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => download("/api/backup")}>
          <Download /> Download backup
        </Button>
        <Button variant="outline" onClick={() => restoreRef.current?.click()}>
          <Upload /> Restore backup…
        </Button>
        <Button variant="outline" onClick={() => chatRef.current?.click()}>
          <Upload /> Import chat
        </Button>
      </div>
      <input
        ref={restoreRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const ok = await confirmDialog({ title: "Restore this backup?", description: "Everything currently in the tavern will be replaced by the backup. Download a backup first if unsure.", confirmLabel: "Replace everything", destructive: true });
          if (!ok) return;
          const t = toast.loading("Restoring…");
          const fd = new FormData();
          fd.append("file", f);
          const res = await fetch("/api/backup", { method: "POST", body: fd });
          toast.dismiss(t);
          if (res.ok) {
            toast.success("Backup restored");
            qc.invalidateQueries();
            router.push("/");
          } else toast.error((await res.json()).error ?? "Restore failed");
        }}
      />
      <input
        ref={chatRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const fd = new FormData();
          fd.append("file", f);
          const res = await fetch("/api/chats/import", { method: "POST", body: fd });
          const j = await res.json();
          if (res.ok) {
            qc.invalidateQueries({ queryKey: qk.chats });
            toast.success("Chat imported", { action: { label: "Open", onClick: () => router.push(`/chats/${j.id}`) } });
          } else toast.error(j.error ?? "Import failed");
        }}
      />
      <ArchivedList />
      <SessionRow />
    </Card>
  );
}

function ArchivedList() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["chats", "archived"], queryFn: () => rpc("chats.list", { archived: true }) });
  if (!data?.length) return null;
  return (
    <More label={`Archived chats (${data.length})`}>
      <div className="-my-2 divide-y">
        {data.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-2">
            <EntityAvatar name={c.characterName} src={c.characterAvatar} color={c.characterColor} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{c.title}</div>
              <div className="text-xs text-muted-foreground">
                {c.characterName} · {relativeTime(c.lastMessageAt)}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await rpc("chats.update", { id: c.id, archived: false });
                qc.invalidateQueries({ queryKey: ["chats"] });
              }}
            >
              <ArchiveRestore /> Restore
            </Button>
          </div>
        ))}
      </div>
    </More>
  );
}

function SessionRow() {
  const router = useRouter();
  const [bypass, setBypass] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((j) => setBypass(!!j.bypass))
      .catch(() => {});
  }, []);
  if (bypass === null) return null;
  return (
    <div className="pt-2">
      {bypass ? (
        <p className="text-sm text-muted-foreground">
          Sign-in is turned off (<code className="font-mono text-xs">AUTH_BYPASS=true</code>). Set a password hash and turn it back on to protect the tavern.
        </p>
      ) : (
        <Row label="Session">
          <Button
            variant="outline"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.replace("/login");
            }}
          >
            <LogOut /> Sign out
          </Button>
        </Row>
      )}
    </div>
  );
}
