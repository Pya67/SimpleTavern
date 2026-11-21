"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { download } from "@/lib/client/download";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Drawer } from "vaul";
import { cn } from "cn";
import { AVATAR_SIZE } from "@/lib/avatar-shape";
import { toast } from "sonner";
import {
  Archive,
  Bookmark,
  BookOpen,
  Brain,
  Download,
  FastForward,
  GitBranch,
  HeartPulse,
  Info,
  Layers,
  Loader2,
  MoreVertical,
  Settings,
  RefreshCw,
  ScanSearch,
  SlidersHorizontal,
  Square,
  Trash2,
  UserRound,
  Users,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { EntityAvatar } from "@/components/common/avatar";
import { confirmDialog } from "@/components/common/confirm";
import { SidebarToggle } from "@/components/app/app-shell";
import { BookmarksDialog } from "@/components/chat/bookmarks-dialog";
import { ChatStatsPill } from "@/components/chat/chat-stats-pill";
import { Conversation, ConversationSkeleton } from "@/components/chat/conversation";
import { Composer, type ComposerHandle } from "@/components/chat/composer";
import type { MessageCtx } from "@/components/chat/message-item";
import { generate, jumpToMessage, loadChat, selectSibling, setOnChatChanged, stop, useChat } from "@/components/chat/chat-store";
import { latestEmotion } from "@/lib/emotion/engine";
import { GenerationPanel } from "@/components/panels/generation-panel";
import { MemoryPanel, useMemory } from "@/components/panels/memory-panel";
import { InspectorPanel } from "@/components/panels/inspector-panel";
import { EmotionPanel } from "@/components/panels/emotion-panel";
import { CharacterPanel, LorePanel, PersonaPanel } from "@/components/panels/simple-panels";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useIsMobile } from "@/hooks/use-media";
import { qk, useModels, usePersonas, usePresets, useRpcQuery, useSettings, type ChatListItem, type MessageV } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import { useUi } from "@/stores/ui";
import { useCommands } from "@/stores/commands";

const TABS = [
  { id: "character", label: "Character", icon: Users },
  { id: "persona", label: "Persona", icon: UserRound },
  { id: "generation", label: "LLM", icon: SlidersHorizontal },
  { id: "memory", label: "Memory", icon: Layers },
  { id: "emotion", label: "Emotion", icon: HeartPulse },
  { id: "lore", label: "Lore", icon: BookOpen },
  { id: "inspector", label: "Context", icon: ScanSearch },
] as const;

const WIDTHS = { narrow: "680px", normal: "820px", wide: "1040px" } as const;

export function ChatView({ chatId }: { chatId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const composerRef = useRef<ComposerHandle>(null);

  const info = useRpcQuery(qk.chat(chatId), "chats.get", { id: chatId }, { refetchInterval: (q) => (q.state.data?.compacting ? 2000 : false) });
  const { data: personas } = usePersonas();
  const { data: settings } = useSettings();
  const { data: presets } = usePresets();
  const { data: models } = useModels();
  const memory = useMemory(chatId);

  const desktopPanelOpen = useUi((s) => s.panelOpen);
  const mobilePanelOpen = useUi((s) => s.mobilePanelOpen);
  const panelTab = useUi((s) => s.panelTab);
  const panelWidth = useUi((s) => s.panelWidth);
  const setUi = useUi((s) => s.set);
  const generating = useChat((s) => s.generating);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [factDraft, setFactDraft] = useState<{ text: string; sourceId?: string } | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);

  const chat = info.data?.chat;
  const mood = useChat((s) => (chat?.emotionEnabled ? latestEmotion(s.messages) : null));
  const character = info.data?.character;
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const personaId = info.data?.effectivePersonaId ?? personas?.[0]?.id ?? null;
  const preset = presets?.find((p) => p.id === info.data?.effectivePresetId);
  const model = models?.find((m) => m.id === preset?.modelId);
  // The composer's model chip edits the chat's active preset (same as the Generation panel).
  const setModel = (id: string) => {
    if (!preset) return;
    qc.setQueryData<typeof presets>(qk.presets, (old) => old?.map((p) => (p.id === preset.id ? { ...p, modelId: id } : p)));
    void rpc("presets.update", { id: preset.id, modelId: id });
  };

  // Load messages for this chat (and reload if the store was reset, e.g. by a hot reload).
  const storeReady = useChat((s) => s.chatId === chatId);
  useEffect(() => {
    if (storeReady) return;
    void loadChat(chatId, params.get("m"));
    rpc("settings.update", { lastChatId: chatId }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, storeReady]);

  // After any change: refresh sidebar ordering, chat info and memory.
  useEffect(() => {
    setOnChatChanged(() => {
      qc.invalidateQueries({ queryKey: qk.chats });
      qc.invalidateQueries({ queryKey: qk.chat(chatId) });
      qc.invalidateQueries({ queryKey: qk.memory(chatId) });
      qc.invalidateQueries({ queryKey: ["inspect", chatId] });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: qk.chats });
        qc.invalidateQueries({ queryKey: qk.memory(chatId) });
      }, 2500);
    });
    return () => setOnChatChanged(null);
  }, [chatId, qc]);

  const setPersona = useCallback(
    async (id: string) => {
      qc.setQueryData(qk.chat(chatId), (old: typeof info.data) => (old ? { ...old, effectivePersonaId: id, chat: { ...old.chat, personaId: id } } : old));
      await rpc("chats.update", { id: chatId, personaId: id });
      const p = personas?.find((x) => x.id === id);
      if (p) toast.info(`Now speaking as ${p.name}`, { duration: 1500 });
    },
    [chatId, personas, qc, info.data],
  );

  const cyclePersona = () => {
    if (!personas?.length) return;
    const i = personas.findIndex((p) => p.id === personaId);
    void setPersona(personas[(i + 1) % personas.length].id);
  };

  const lastAssistant = (): MessageV | undefined => {
    const ms = useChat.getState().messages;
    const last = ms[ms.length - 1];
    return last?.role === "assistant" ? last : undefined;
  };

  const panelOpen = isMobile ? mobilePanelOpen : desktopPanelOpen;
  const setPanelOpen = (o: boolean) => setUi(isMobile ? { mobilePanelOpen: o } : { panelOpen: o });
  const openPanel = (tab: string) => setUi(isMobile ? { mobilePanelOpen: true, panelTab: tab } : { panelOpen: true, panelTab: tab });

  const fork = async (messageId: string) => {
    const r = await rpc("chats.fork", { id: chatId, messageId });
    qc.invalidateQueries({ queryKey: qk.chats });
    toast.success("Forked into a new chat");
    router.push(`/chats/${r.chatId}`);
  };

  const exportChat = (format: "md" | "json" | "html") => {
    download(`/api/chats/${chatId}/export?format=${format}`);
  };

  const onSlash = (cmd: string, arg: string): boolean | void => {
    switch (cmd) {
      case "regen":
      case "regenerate": {
        const a = lastAssistant();
        if (a?.parentId) void generate({ mode: "regenerate", targetId: a.id });
        else toast.info("Nothing to regenerate");
        return;
      }
      case "continue": {
        const a = lastAssistant();
        if (a) void generate({ mode: "continue", targetId: a.id });
        else toast.info("The last message isn't from the character");
        return;
      }
      case "impersonate":
        void generate({ mode: "impersonate", personaId });
        return;
      case "as": {
        const p = personas?.find((x) => x.name.toLowerCase().startsWith(arg.toLowerCase()));
        if (p) void setPersona(p.id);
        else {
          toast.error(arg ? `No persona named “${arg}”` : "Usage: /as Name");
          return false;
        }
        return;
      }
      case "sys":
      case "narrator":
        if (!arg) return false;
        void generate({ mode: "send", content: arg, role: "system" });
        return;
      case "note":
        if (arg) {
          void rpc("chats.update", { id: chatId, authorsNote: arg }).then(() => {
            qc.invalidateQueries({ queryKey: qk.chat(chatId) });
            toast.success("Author's note set");
          });
        } else setNoteOpen(true);
        return;
      case "pin":
        if (arg) {
          void rpc("facts.create", { chatId, content: arg }).then(() => {
            qc.invalidateQueries({ queryKey: qk.memory(chatId) });
            toast.success("Fact pinned");
          });
        } else setFactDraft({ text: "" });
        return;
      case "compact":
        void rpc("memory.compactNow", { chatId }).then(() => {
          toast.info("Compacting memory…");
          openPanel("memory");
        });
        return;
      case "model":
      case "preset":
        openPanel("generation");
        return;
      case "inspect":
        setInspectId(null);
        openPanel("inspector");
        return;
      default:
        return false;
    }
  };

  useHotkeys({
    "mod+/": () => composerRef.current?.focus(),
    "mod+.": () => stop(),
    "alt+i": () => setPanelOpen(!panelOpen),
    "alt+p": () => cyclePersona(),
    "alt+c": () => onSlash("continue", ""),
    escape: () => {
      if (useChat.getState().generating) stop();
      else if (useChat.getState().editingId) useChat.setState({ editingId: null });
    },
    arrowleft: () => {
      const a = lastAssistant();
      if (a) void selectSibling(a, -1);
    },
    arrowright: () => {
      const a = lastAssistant();
      if (a) void selectSibling(a, 1);
    },
  });

  // Bookmarks are offered in the palette while it is open.
  const paletteOpen = useUi((s) => s.paletteOpen);
  const bookmarks = useQuery({ queryKey: ["bookmarks", chatId], queryFn: () => rpc("chats.bookmarks", { id: chatId }), enabled: paletteOpen });
  const register = useCommands((s) => s.register);
  const unregister = useCommands((s) => s.unregister);
  useEffect(() => {
    register(
      "bookmarks",
      (bookmarks.data ?? []).map((b) => ({
        id: `bm-${b.id}`,
        group: "Bookmarks in this chat",
        label: `#${b.depth + 1} · ${b.snippet.replace(/\s+/g, " ").slice(0, 90)}`,
        icon: Bookmark,
        keywords: ["bookmark"],
        run: () => void jumpToMessage(b.id),
      })),
    );
    return () => unregister("bookmarks");
  }, [bookmarks.data, register, unregister]);

  // Jump when navigated with ?m=<message id> (e.g. from search results).
  const focusParam = params.get("m");
  useEffect(() => {
    if (focusParam && storeReady) void jumpToMessage(focusParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam]);

  // Contribute chat commands to the palette.
  useEffect(() => {
    register("chat", [
      { id: "regen", group: "This chat", label: "Regenerate last reply", icon: RefreshCw, run: () => onSlash("regen", "") },
      { id: "continue", group: "This chat", label: "Continue last reply", icon: FastForward, shortcut: "Alt C", run: () => onSlash("continue", "") },
      { id: "impersonate", group: "This chat", label: "Impersonate (write my next message)", icon: Wand2, run: () => onSlash("impersonate", "") },
      { id: "persona", group: "This chat", label: "Switch persona", icon: UserRound, shortcut: "Alt P", run: () => openPanel("persona") },
      { id: "model", group: "This chat", label: "Change model / preset", icon: SlidersHorizontal, run: () => openPanel("generation") },
      { id: "memory", group: "This chat", label: "Open memory", icon: Layers, run: () => openPanel("memory") },
      { id: "emotion", group: "This chat", label: "Open emotion engine", icon: HeartPulse, run: () => openPanel("emotion") },
      { id: "compact", group: "This chat", label: "Compact memory now", icon: Brain, run: () => onSlash("compact", "") },
      { id: "inspect", group: "This chat", label: "Inspect next prompt", icon: ScanSearch, run: () => onSlash("inspect", "") },
      { id: "export-md", group: "This chat", label: "Export chat as Markdown", icon: Download, run: () => exportChat("md") },
      { id: "export-json", group: "This chat", label: "Export chat as JSON", icon: Download, run: () => exportChat("json") },
    ]);
    return () => unregister("chat");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, personaId, personas]);

  const personaMap = useMemo(() => Object.fromEntries((personas ?? []).map((p) => [p.id, p])), [personas]);
  const ui = settings?.ui;
  // Applied imperatively: the server renders without settings, and React won't patch a
  // mismatched style attribute after hydration, so inline style values would stay stuck on defaults.
  const rootRef = useRef<HTMLDivElement>(null);
  const chatWidth = WIDTHS[ui?.chatWidth ?? "normal"];
  const fontSize = ui?.fontSize ?? 15;
  const textOpacity = ui?.textOpacity ?? 1;
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty("--chat-width", chatWidth);
    el.style.setProperty("--chat-font-size", `${fontSize}px`);
    el.style.setProperty("--chat-text-opacity", String(textOpacity));
  }, [chatWidth, fontSize, textOpacity]);
  const msgCtx: MessageCtx | null = useMemo(
    () =>
      character
        ? {
            character: { id: character.id, name: character.name, avatar: character.avatar, color: character.color },
            personas: personaMap,
            currentPersonaId: personaId,
            layout: ui?.layout ?? "bubbles",
            avatarSize: ui?.avatarSize ?? AVATAR_SIZE.default,
            showStats: ui?.showStats ?? true,
            smoothing: ui?.streamSmoothing ?? true,
            onInspect: (id) => {
              setInspectId(id);
              openPanel("inspector");
            },
            onFork: fork,
            onPinFact: (m) => setFactDraft({ text: m.content.slice(0, 280), sourceId: m.id }),
            emotionEnabled: !!chat?.emotionEnabled,
            onOpenEmotion: () => openPanel("emotion"),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [character, personaMap, personaId, ui, chat?.emotionEnabled],
  );

  if (info.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-muted-foreground">This chat doesn&apos;t exist anymore.</p>
        <Button onClick={() => router.push("/")}>Go home</Button>
      </div>
    );
  }

  const panelBody = info.data && (
    <div className="space-y-4">
      {panelTab === "character" && <CharacterPanel info={info.data} userName={personas?.find((p) => p.id === personaId)?.name ?? "You"} />}
      {panelTab === "persona" && personas && <PersonaPanel personas={personas} currentId={personaId} onSelect={setPersona} />}
      {panelTab === "generation" && <GenerationPanel info={info.data} />}
      {panelTab === "memory" && <MemoryPanel chatId={chatId} />}
      {panelTab === "emotion" && <EmotionPanel info={info.data} />}
      {panelTab === "lore" && <LorePanel info={info.data} />}
      {panelTab === "inspector" && <InspectorPanel chatId={chatId} messageId={inspectId} personaId={personaId} onClear={() => setInspectId(null)} />}
    </div>
  );

  const tabs = (
    <div className="grid grid-cols-7 gap-0.5 px-2 pb-1 pt-2">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => setUi({ panelTab: t.id })}
          className={cn(
            "relative flex min-w-0 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground",
            panelTab === t.id && "text-foreground",
          )}
        >
          {panelTab === t.id && <motion.span layoutId="panel-tab" className="absolute inset-0 -z-0 rounded-md bg-accent" transition={{ type: "spring", stiffness: 600, damping: 40 }} />}
          <t.icon className="relative size-4" />
          <span className="relative max-w-full truncate">{t.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div
      className={cn("flex h-full min-h-0", ui?.layout === "book" && "layout-book")}
      ref={rootRef}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {/* A size container: with both sidebars open the header can be narrow even on a wide screen,
            so its extras respond to the header's own width rather than the viewport's. */}
        <header className="@container z-20 flex h-14 shrink-0 items-center gap-2 overflow-hidden border-b bg-background/80 px-3 backdrop-blur-md md:px-4">
          <SidebarToggle />
          {character ? (
            <button onClick={() => openPanel("character")} className="flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-accent">
              <span className="shrink-0">
                <EntityAvatar name={character.name} src={character.avatar} color={character.color} size={32} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                  <span className="truncate">{character.name}</span>
                  {mood && (
                    <span className="shrink-0 whitespace-nowrap text-xs font-normal text-muted-foreground" title={`Mood: ${mood.label}`}>
                      {mood.kaomoji}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">{chat?.title}</div>
              </div>
            </button>
          ) : (
            <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
          )}
          <div className="flex-1" />
          <AnimatePresence>
            {(info.data?.compacting || memory.data?.compacting) && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={() => openPanel("memory")}
                className="hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground @2xl:flex"
              >
                <Loader2 className="size-3 animate-spin text-brand" /> Updating memory
              </motion.button>
            )}
          </AnimatePresence>
          {preset && (
            <ChatStatsPill modelId={preset.modelId} model={model} contextSize={preset.contextSize} totalCost={chat?.totalCost ?? 0} onClick={() => openPanel("generation")} />
          )}
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon-sm" onClick={() => setUi({ helpOpen: true, helpTab: "features" })} aria-label="Features and quick actions" className="text-foreground @max-xs:hidden" />}
            >
              <Info />
            </TooltipTrigger>
            <TooltipContent>Features &amp; quick actions</TooltipContent>
          </Tooltip>
          {generating && (
            <Button variant="outline" size="sm" onClick={stop} className="gap-1.5 max-md:hidden">
              <Square className="size-3 fill-current" /> Stop
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => setBookmarksOpen(true)} aria-label="Bookmarks" className={cn(bookmarksOpen && "bg-accent")} />}>
              <BookOpen />
            </TooltipTrigger>
            <TooltipContent>Bookmarks</TooltipContent>
          </Tooltip>
          <BookmarksDialog chatId={chatId} character={character} personas={personas} open={bookmarksOpen} onOpenChange={setBookmarksOpen} />
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => setPanelOpen(!panelOpen)} aria-label="Toggle panel" className={cn(panelOpen && "bg-accent")} />}>
              <Settings />
            </TooltipTrigger>
            <TooltipContent>Context panel · Alt+I</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Chat menu" />}>
              <MoreVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent appearance="grain" align="end" sideOffset={8} className="w-52">
              <DropdownMenuItem onClick={() => fork(useChat.getState().messages.at(-1)?.id ?? "")}>
                <GitBranch /> Fork chat
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportChat("md")}>
                <Download /> Export Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportChat("html")}>
                <Download /> Export HTML
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportChat("json")}>
                <Download /> Export JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await rpc("chats.update", { id: chatId, archived: true });
                  qc.invalidateQueries({ queryKey: qk.chats });
                  toast.success("Chat archived");
                  router.push("/");
                }}
              >
                <Archive /> Archive
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={async () => {
                  const ok = await confirmDialog({ title: "Delete this chat?", description: "All messages, branches and memories will be permanently deleted.", confirmLabel: "Delete chat", destructive: true });
                  if (!ok) return;
                  qc.setQueryData<ChatListItem[]>(qk.chats, (old) => old?.filter((c) => c.id !== chatId));
                  await rpc("chats.delete", { id: chatId });
                  router.push("/");
                }}
              >
                <Trash2 /> Delete chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {msgCtx ? (
          <Conversation ctx={msgCtx} lastCoveredDepth={memory.data?.lastCoveredDepth ?? -1} tagline={character?.tagline} />
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <ConversationSkeleton />
          </div>
        )}

        {personas && character && (
          <Composer
            ref={composerRef}
            chatId={chatId}
            personas={personas}
            personaId={personaId}
            onPersona={setPersona}
            onSlash={onSlash}
            enterToSend={ui?.enterToSend ?? true}
            characterName={character.name}
            modelId={preset?.modelId}
            onModel={setModel}
          />
        )}
      </div>

      {/* Context panel */}
      {!isMobile && (
        <motion.aside
          initial={false}
          animate={{ width: panelOpen ? panelWidth : 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 42 }}
          className="relative shrink-0 overflow-hidden bg-sidebar"
        >
          <PanelResizer />
          <div style={{ width: panelWidth }} className="flex h-full flex-col">
            {tabs}
            <div className="borderless-controls min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3">{panelBody}</div>
          </div>
        </motion.aside>
      )}
      {isMobile && (
        <Drawer.Root open={panelOpen} onOpenChange={setPanelOpen}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Drawer.Content className="grain fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-2xl bg-sidebar outline-none" aria-describedby={undefined}>
              <Drawer.Title className="sr-only">Chat context</Drawer.Title>
              <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
              {tabs}
              <div className="borderless-controls min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{panelBody}</div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}

      {/* Pin fact dialog */}
      <Dialog open={!!factDraft} onOpenChange={(o) => !o && setFactDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pin a fact</DialogTitle>
          </DialogHeader>
          <p className="-mt-2 text-sm text-muted-foreground">Pinned facts are always sent to the model and are never summarized away. Keep them short.</p>
          <Textarea autoFocus value={factDraft?.text ?? ""} onChange={(e) => setFactDraft((f) => (f ? { ...f, text: e.target.value } : f))} className="min-h-24" placeholder="e.g. Mira owes {{user}} a favor after the mill incident." />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFactDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={!factDraft?.text.trim()}
              onClick={async () => {
                if (!factDraft) return;
                await rpc("facts.create", { chatId, content: factDraft.text.trim(), sourceMessageId: factDraft.sourceId });
                setFactDraft(null);
                qc.invalidateQueries({ queryKey: qk.memory(chatId) });
                toast.success("Fact pinned", { action: { label: "View", onClick: () => openPanel("memory") } });
              }}
            >
              Pin fact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Author's note dialog */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Author&apos;s note</DialogTitle>
          </DialogHeader>
          <AuthorsNoteEditor
            initial={chat?.authorsNote ?? ""}
            onSave={async (v) => {
              await rpc("chats.update", { id: chatId, authorsNote: v });
              qc.invalidateQueries({ queryKey: qk.chat(chatId) });
              setNoteOpen(false);
              toast.success(v ? "Author's note set" : "Author's note cleared");
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuthorsNoteEditor({ initial, onSave }: { initial: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <p className="-mt-2 text-sm text-muted-foreground">Injected near the end of the context to steer the story. Leave empty to disable.</p>
      <Textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} className="min-h-28" placeholder="e.g. Keep it tense. A stranger is watching from the corner." />
      <DialogFooter>
        <Button onClick={() => onSave(v.trim())}>Save</Button>
      </DialogFooter>
    </>
  );
}

function PanelResizer() {
  const set = useUi((s) => s.set);
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = useUi.getState().panelWidth;
    const move = (ev: PointerEvent) => set({ panelWidth: Math.min(640, Math.max(300, startW - (ev.clientX - startX))) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div onPointerDown={onDown} className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-brand/30" aria-label="Resize panel" />;
}
