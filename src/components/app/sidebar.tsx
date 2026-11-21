"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { KAOMOJIS } from "@/lib/kaomoji";
import { LogoMark } from "@/components/app/logo";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UNDO_DURATION, undoAction } from "@/lib/client/toast-actions";
import { useCallback, useEffect, useState } from "react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { DragDropProvider, DragOverlay, KeyboardSensor, PointerSensor, useDragOperation, useDraggable, useDroppable } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { confirmDialog } from "@/components/common/confirm";
import { cn } from "cn";
import {
  Archive,
  BookOpen,
  Check,
  ChevronRight,
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  FolderTree,
  ArrowRight,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Users,
  MessagesSquare,
  MessageSquarePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EntityAvatar } from "@/components/common/avatar";
import { qk, useChats, useDirectories, type ChatListItem, type DirectoryT } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import { relativeTime } from "@/lib/format";
import { useUi } from "@/stores/ui";

const TITLE_INTERVAL = 5000;
const directorySensors = [
  PointerSensor.configure({
    activationConstraints: (event, source) => {
      if (event.pointerType === "mouse") return [new PointerActivationConstraints.Distance({ value: 5 })];
      const defaults = PointerSensor.defaults.activationConstraints;
      return typeof defaults === "function" ? defaults(event, source) : defaults;
    },
  }),
  KeyboardSensor.configure({ preventActivation: (event) => event.code !== "Space" || !event.shiftKey }),
];

const APP_NAME = "SimpleTavern";
const letterPop = {
  hidden: { opacity: 0, y: 7, scale: 0.4, rotate: -8 },
  shown: { opacity: 1, y: 0, scale: 1, rotate: 0 },
};

/**
 * The sidebar title: a kaomoji that changes every few seconds with a blur fade.
 * While `showName` is set (the home link is hovered or focused), it spells out the app name,
 * each letter popping in a beat after the last.
 */
function KaomojiTitle({ showName }: { showName: boolean }) {
  // Start on a fixed face so the server and client render the same thing; shuffle after mount.
  const [index, setIndex] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    const t = setInterval(() => {
      setIndex((i) => {
        const next = Math.floor(Math.random() * (KAOMOJIS.length - 1));
        return next >= i ? next + 1 : next; // never the same face twice in a row
      });
    }, TITLE_INTERVAL);
    return () => clearInterval(t);
  }, []);
  const k = KAOMOJIS[index];
  return (
    <span aria-hidden className="relative block min-w-0 flex-1 truncate">
      <AnimatePresence mode="popLayout" initial={false}>
        {showName ? (
          <motion.span
            key="name"
            className="block truncate whitespace-nowrap"
            initial={reduce ? { opacity: 0 } : "hidden"}
            animate={reduce ? { opacity: 1 } : "shown"}
            exit={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(6px)", transition: { duration: 0.2, ease: "easeOut" } }}
            transition={reduce ? { duration: 0.15 } : { staggerChildren: 0.035 }}
          >
            {reduce
              ? APP_NAME
              : [...APP_NAME].map((ch, i) => (
                  <motion.span
                    key={i}
                    className="inline-block origin-bottom"
                    variants={letterPop}
                    transition={{ type: "spring", stiffness: 520, damping: 17, mass: 0.6 }}
                  >
                    {ch}
                  </motion.span>
                ))}
          </motion.span>
        ) : (
          <motion.span
            key={k}
            className="block truncate whitespace-nowrap"
            initial={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(8px)" }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, filter: "blur(0px)" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(8px)" }}
            transition={{ duration: reduce ? 0.15 : 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            {k}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

type NavItem = { href: string; label: string; icon: typeof Users; exact?: boolean };
/** Bottom navigation: your content first, then configuration below a divider. */
const NAV: NavItem[] = [
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/personas", label: "Personas", icon: UserRound },
  { href: "/lorebooks", label: "Lorebooks", icon: BookOpen },
];
const NAV_CONFIG: NavItem[] = [
  { href: "/presets", label: "Presets & prompts", icon: SlidersHorizontal },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Shared row look: chats, directories and nav links all sit on this. */
const rowBase = "flex items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-sidebar-accent";

/** Directory actions shared by every row in the sidebar. */
function useDirectoryActions() {
  const qc = useQueryClient();
  const moveChat = async (chatId: string, directoryId: string | null) => {
    qc.setQueryData<ChatListItem[]>(qk.chats, (old) => old?.map((c) => (c.id === chatId ? { ...c, directoryId } : c)));
    await rpc("chats.update", { id: chatId, directoryId });
    qc.invalidateQueries({ queryKey: qk.chats });
  };
  const createDirectory = async (name: string, chatId?: string) => {
    const d = await rpc("directories.create", { name });
    qc.setQueryData<DirectoryT[]>(qk.directories, (old) => [...(old ?? []), d]);
    if (chatId) await moveChat(chatId, d.id);
    qc.invalidateQueries({ queryKey: qk.directories });
    return d;
  };
  return { moveChat, createDirectory };
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { data: chats, isLoading } = useChats();
  const { data: savedDirectories = [] } = useDirectories();
  const qc = useQueryClient();
  const reorder = useMutation({
    mutationFn: (ids: string[]) => rpc("directories.reorder", { ids }),
    onError: (error) => toast.error(error.message),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.directories }),
  });
  const pendingOrder = new Map((reorder.isPending ? reorder.variables : []).map((id, index) => [id, index]));
  const directories = reorder.isPending
    ? [...savedDirectories].sort((a, b) => (pendingOrder.get(a.id) ?? Infinity) - (pendingOrder.get(b.id) ?? Infinity))
    : savedDirectories;
  const pathname = usePathname();
  const set = useUi((s) => s.set);
  // `null`: not creating. Otherwise an inline name field is shown; `chatId` is moved in once created.
  const [creating, setCreating] = useState<{ chatId?: string } | null>(null);
  const [titleHover, setTitleHover] = useState(false);
  const { createDirectory, moveChat } = useDirectoryActions();

  const dirIds = new Set(directories.map((d) => d.id));
  const inDir = (c: ChatListItem) => !!c.directoryId && dirIds.has(c.directoryId);
  const loose = chats?.filter((c) => !inDir(c)) ?? [];
  // The sidebar keeps only the latest few; the Chats page has everything.
  const recent = [...loose].sort((a, b) => new Date(b.editedAt).getTime() - new Date(a.editedAt).getTime()).slice(0, 3);
  const startCreating = (c: { chatId?: string }) => {
    set({ collapsedSections: useUi.getState().collapsedSections.filter((x) => x !== "directories") });
    setCreating(c);
  };
  const ctx: RowCtx = { pathname, onNavigate, directories, onNewDirectory: (chatId) => startCreating({ chatId }) };

  return (
    <div className="grain flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pb-3 pt-3.5">
        <Link
          href="/"
          onClick={onNavigate}
          onPointerEnter={(e) => e.pointerType === "mouse" && setTitleHover(true)}
          onPointerLeave={() => setTitleHover(false)}
          onFocus={(e) => e.currentTarget.matches(":focus-visible") && setTitleHover(true)}
          onBlur={() => setTitleHover(false)}
          aria-label="SimpleTavern, home"
          className="flex h-8 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg px-1.5 text-[15px] font-semibold transition-colors hover:bg-sidebar-accent"
        >
          <LogoMark className="size-6 rounded-[7px]" />
          <KaomojiTitle showName={titleHover} />
        </Link>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="hidden md:inline-flex" onClick={() => set({ sidebarOpen: false })} aria-label="Collapse sidebar" />}>
            <PanelLeftClose />
          </TooltipTrigger>
          <TooltipContent side="right">
            Collapse <Kbd>Alt B</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex gap-1.5 px-3 pb-3">
        <Button className="h-9 flex-1 justify-start gap-2 bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => set({ newChatOpen: true })}>
          <Plus className="size-4" /> New chat
        </Button>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon" className="surface-well size-9" onClick={() => set({ paletteOpen: true })} aria-label="Search" />}>
            <Search />
          </TooltipTrigger>
          <TooltipContent>
            Search <Kbd>Ctrl K</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>

      <DragDropProvider
        onDragEnd={(e) => {
          if (e.canceled) return;
          const { source, target } = e.operation;
          if (isSortable(source)) {
            const { initialIndex, index } = source;
            if (reorder.isPending || initialIndex === index || directories[initialIndex]?.id !== source.id || !directories[index]) return;
            const ids = directories.map((dir) => dir.id);
            ids.splice(index, 0, ...ids.splice(initialIndex, 1));
            reorder.mutate(ids);
            return;
          }
          if (!source || !target) return;
          const to = (target.data as DropData).dirId;
          const chat = chats?.find((c) => c.id === (source.data as DragData).chatId);
          if (!chat || (chat.directoryId ?? null) === to) return;
          void moveChat(chat.id, to);
        }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {isLoading && (
            <div className="space-y-1.5 p-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="surface-well h-10 animate-pulse rounded-lg" style={{ animationDelay: `${i * 80}ms` }} />
              ))}
            </div>
          )}

          {!isLoading && (
            <SidebarSection
              id="chats"
              className="mb-4"
              icon={MessagesSquare}
              label="Chats"
              action={
                <Tooltip>
                  <TooltipTrigger
                    render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" onClick={() => set({ newChatOpen: true })} aria-label="New chat" />}
                  >
                    <MessageSquarePlus className="size-[18px]" />
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    New chat <Kbd>Alt N</Kbd>
                  </TooltipContent>
                </Tooltip>
              }
            >
              <LooseDropZone>
                {!chats?.length && <p className="px-2 py-1 text-xs text-muted-foreground/80">No chats yet. Start one with a character.</p>}
                {!!chats?.length && !recent.length && <p className="px-2 py-1 text-xs text-muted-foreground/80">Every chat is in a directory.</p>}
                <AnimatePresence initial={false}>
                  {recent.map((c) => (
                    <ChatRow key={c.id} chat={c} ctx={ctx} />
                  ))}
                </AnimatePresence>
                <Link
                  href="/chats"
                  onClick={onNavigate}
                  aria-current={pathname === "/chats" ? "page" : undefined}
                  className={cn(rowBase, "group/all mt-0.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground", pathname === "/chats" && "bg-sidebar-accent font-medium text-foreground")}
                >
                  <span className="flex-1">All chats</span>
                  {!!chats?.length && <span className="text-[11px] tabular-nums">{chats.length}</span>}
                  <ArrowRight className="size-3.5 transition-transform group-hover/all:translate-x-0.5" />
                </Link>
              </LooseDropZone>
            </SidebarSection>
          )}
          {!isLoading && (
            <SidebarSection
              id="directories"
              icon={FolderTree}
              label="Directories"
              action={
                <Tooltip>
                  <TooltipTrigger
                    render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" onClick={() => startCreating({})} aria-label="New directory" />}
                  >
                    <FolderPlus className="size-[18px]" />
                  </TooltipTrigger>
                  <TooltipContent side="right">New directory</TooltipContent>
                </Tooltip>
              }
            >
              {creating && (
                <NewDirectoryField
                  onCancel={() => setCreating(null)}
                  onSubmit={async (name) => {
                    const forChat = creating.chatId;
                    setCreating(null);
                    try {
                      const d = await createDirectory(name, forChat);
                      if (forChat) toast.success(`Moved to ${d.name}`);
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                />
              )}
              {!directories.length && !creating && <p className="px-2 py-1 text-xs text-muted-foreground/80">Drag a chat here, or use its menu, to group chats.</p>}
              {directories.map((d, index) => (
                <DirectoryRow
                  key={d.id}
                  dir={d}
                  index={index}
                  savingOrder={reorder.isPending}
                  chats={chats?.filter((c) => c.directoryId === d.id) ?? []}
                  ctx={ctx}
                />
              ))}
            </SidebarSection>
          )}
        </div>
        <DragOverlay disabled={(source) => source?.type !== "chat"} dropAnimation={null}>
          {(source) => {
            const c = chats?.find((x) => x.id === (source.data as DragData).chatId);
            return c ? (
              <div className="surface-grain flex w-56 items-center gap-2 rounded-lg px-2 py-1.5 shadow-xl">
                <EntityAvatar name={c.characterName} src={c.characterAvatar} color={c.characterColor} size={22} />
                <span className="truncate text-[13px] font-medium">{c.title}</span>
              </div>
            ) : null;
          }}
        </DragOverlay>
      </DragDropProvider>

      <nav aria-label="Main" className="space-y-0.5 px-2 pb-3 pt-1">
        {NAV.map((n) => (
          <NavLink key={n.href} item={n} pathname={pathname} onNavigate={onNavigate} />
        ))}
        <div role="separator" className="mx-2 my-2 h-px bg-sidebar-foreground/10" />
        {NAV_CONFIG.map((n) => (
          <NavLink key={n.href} item={n} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </nav>
    </div>
  );
}

/** What a sidebar drop target carries: the directory a dropped chat moves into (null = main list). */
type DropData = { dirId: string | null };
/** What a dragged chat carries. */
type DragData = { chatId: string; directoryId: string | null };

/** The main list doubles as a drop target that takes a chat out of its directory. */
function LooseDropZone({ children }: { children: React.ReactNode }) {
  const { source } = useDragOperation();
  const fromDirectory = source?.type === "chat" && (source.data as DragData).directoryId != null;
  const { ref, isDropTarget } = useDroppable<DropData>({
    id: "dir:none",
    accept: (s) => s.type === "chat" && (s.data as DragData).directoryId != null,
    data: { dirId: null },
  });
  return (
    <div ref={ref} className={cn("rounded-xl transition-colors", isDropTarget && "bg-brand/10")}>
      {fromDirectory && (
        <p className={cn("surface-well mb-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground transition-colors", isDropTarget && "text-foreground")}>Drop here to take it out of its directory</p>
      )}
      {children}
    </div>
  );
}

function NavLink({ item: n, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
  return (
    <Link
      href={n.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(rowBase, "py-1.5 text-sm text-sidebar-foreground/80 hover:text-sidebar-foreground", active && "bg-sidebar-accent font-medium text-sidebar-foreground")}
    >
      <n.icon className={cn("size-4 opacity-80", active && "text-brand opacity-100")} />
      {n.label}
    </Link>
  );
}

type RowCtx = { pathname: string; onNavigate?: () => void; directories: DirectoryT[]; onNewDirectory: (chatId: string) => void };

function NewDirectoryField({ onSubmit, onCancel, initial = "" }: { onSubmit: (name: string) => void; onCancel: () => void; initial?: string }) {
  return (
    <div className={cn(rowBase, "py-1 hover:bg-transparent")}>
      <Folder className="size-4 shrink-0 text-muted-foreground" />
      <input
        autoFocus
        defaultValue={initial}
        aria-label="Directory name"
        placeholder="Directory name"
        maxLength={80}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          if (v && v !== initial) onSubmit(v);
          else onCancel();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = initial;
            e.currentTarget.blur();
          }
        }}
        className="surface-well h-7 min-w-0 flex-1 rounded-md px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      />
    </div>
  );
}

function DirectoryRow({ dir, index, savingOrder, chats, ctx }: { dir: DirectoryT; index: number; savingOrder: boolean; chats: ChatListItem[]; ctx: RowCtx }) {
  const qc = useQueryClient();
  const collapsed = useUi((s) => s.collapsedDirs.includes(dir.id));
  const set = useUi((s) => s.set);
  const [renaming, setRenaming] = useState(false);
  const open = !collapsed;
  const hasActive = chats.some((c) => ctx.pathname === `/chats/${c.id}`);
  const toggle = () => {
    const cur = useUi.getState().collapsedDirs;
    set({ collapsedDirs: collapsed ? cur.filter((x) => x !== dir.id) : [...cur, dir.id] });
  };
  const { ref: dropRef, isDropTarget } = useDroppable<DropData>({
    id: `dir:${dir.id}`,
    accept: (s) => s.type === "chat" && (s.data as DragData).directoryId !== dir.id,
    data: { dirId: dir.id },
  });
  const canReorder = ctx.directories.length > 1;
  const { ref: sortRef, handleRef, isDragging } = useSortable({
    id: dir.id,
    index,
    group: "directories",
    type: "directory",
    accept: "directory",
    sensors: directorySensors,
    disabled: savingOrder || !canReorder || renaming,
  });
  const rowRef = useCallback((node: HTMLDivElement | null) => {
    dropRef(node);
    sortRef(node);
  }, [dropRef, sortRef]);
  // Holding a chat over a closed directory opens it, so you can see where it lands.
  useEffect(() => {
    if (!isDropTarget || !collapsed) return;
    const t = setTimeout(() => {
      const cur = useUi.getState().collapsedDirs;
      set({ collapsedDirs: cur.filter((x) => x !== dir.id) });
    }, 600);
    return () => clearTimeout(t);
  }, [isDropTarget, collapsed, dir.id, set]);
  const sorted = [...chats].sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  const rename = async (name: string) => {
    setRenaming(false);
    qc.setQueryData<DirectoryT[]>(qk.directories, (old) => old?.map((d) => (d.id === dir.id ? { ...d, name } : d)));
    await rpc("directories.update", { id: dir.id, name });
    qc.invalidateQueries({ queryKey: qk.directories });
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete "${dir.name}"?`,
      description: chats.length
        ? `The ${chats.length} chat${chats.length === 1 ? "" : "s"} inside ${chats.length === 1 ? "is" : "are"} kept and move${chats.length === 1 ? "s" : ""} back to the main list.`
        : "The directory is empty.",
      confirmLabel: "Delete directory",
      destructive: true,
    });
    if (!ok) return;
    set({ collapsedDirs: useUi.getState().collapsedDirs.filter((x) => x !== dir.id) });
    qc.setQueryData<DirectoryT[]>(qk.directories, (old) => old?.filter((d) => d.id !== dir.id));
    qc.setQueryData<ChatListItem[]>(qk.chats, (old) => old?.map((c) => (c.directoryId === dir.id ? { ...c, directoryId: null } : c)));
    await rpc("directories.delete", { id: dir.id });
    qc.invalidateQueries({ queryKey: qk.directories });
    qc.invalidateQueries({ queryKey: qk.chats });
  };

  if (renaming) return <NewDirectoryField initial={dir.name} onSubmit={rename} onCancel={() => setRenaming(false)} />;

  const Icon = open ? FolderOpen : Folder;
  return (
    <div ref={rowRef} className={cn("group/dir rounded-lg transition-colors", isDropTarget && "bg-brand/12", isDragging && "bg-sidebar-accent shadow-lg")}>
      <div className="relative">
        <button
          ref={handleRef}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-keyshortcuts={canReorder ? "Shift+Space" : undefined}
          data-vaul-no-drag
          className={cn(rowBase, "w-full py-1.5 pr-8 text-left text-[13px]", !open && hasActive && "bg-sidebar-accent")}
        >
          <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-90")} />
          <Icon className={cn("size-3.5 shrink-0", hasActive ? "text-brand" : "text-muted-foreground")} />
          <span className="min-w-0 flex-1 truncate font-medium">{dir.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground transition-opacity group-hover/dir:opacity-0">{chats.length}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/dir:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 max-md:opacity-100"
                aria-label={`${dir.name} options`}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => setTimeout(() => setRenaming(true), 50)}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={remove}>
              <Trash2 /> Delete directory
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-[15px] pl-2.5">
              {sorted.length ? (
                <AnimatePresence initial={false}>
                  {sorted.map((c) => (
                    <ChatRow key={c.id} chat={c} ctx={ctx} compact />
                  ))}
                </AnimatePresence>
              ) : (
                <p className="px-2 py-1.5 text-xs text-muted-foreground/80">Empty. Drag chats here.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A collapsible sidebar section: the title toggles it, `action` sits on the right. Open/closed is remembered per device. */
function SidebarSection({
  id,
  icon: Icon,
  label,
  action,
  className,
  children,
}: {
  id: string;
  icon: typeof Users;
  label: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const collapsed = useUi((s) => s.collapsedSections.includes(id));
  const set = useUi((s) => s.set);
  const toggle = () => {
    const cur = useUi.getState().collapsedSections;
    set({ collapsedSections: collapsed ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const bodyId = `sidebar-section-${id}`;
  return (
    <section aria-label={label} className={className}>
      <div className="flex min-h-8 items-center gap-1 pb-1 pl-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          className="group/sec flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon className="size-3.5 shrink-0" />
          <span className="text-xs font-medium">{label}</span>
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-[transform,opacity] duration-200",
              collapsed ? "opacity-100" : "rotate-90 opacity-0 group-hover/sec:opacity-100 group-focus-visible/sec:opacity-100",
            )}
          />
        </button>
        {action}
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            id={bodyId}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function ChatRow({ chat, ctx, compact }: { chat: ChatListItem; ctx: RowCtx; compact?: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { moveChat } = useDirectoryActions();
  const active = ctx.pathname === `/chats/${chat.id}`;

  const update = async (patch: { pinned?: boolean; archived?: boolean; title?: string }) => {
    qc.setQueryData<ChatListItem[]>(qk.chats, (old) => (patch.archived ? old?.filter((c) => c.id !== chat.id) : old?.map((c) => (c.id === chat.id ? { ...c, ...patch } : c))));
    await rpc("chats.update", { id: chat.id, ...patch });
    qc.invalidateQueries({ queryKey: qk.chats });
  };

  const [editing, setEditing] = useState(false);
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete "${chat.title}"?`,
      description: "All messages, branches and memories of this chat will be permanently deleted.",
      confirmLabel: "Delete chat",
      destructive: true,
    });
    if (!ok) return;
    qc.setQueryData<ChatListItem[]>(qk.chats, (old) => old?.filter((c) => c.id !== chat.id));
    await rpc("chats.delete", { id: chat.id });
    if (ctx.pathname === `/chats/${chat.id}`) router.push("/");
    toast.success("Chat deleted");
  };
  const currentDir = ctx.directories.find((d) => d.id === chat.directoryId);
  const { ref: dragRef, isDragSource } = useDraggable<DragData>({
    // Keyed by location as well: after a move, the old row lingers for its exit animation,
    // and a shared id would let its cleanup unregister the new row.
    id: `${chat.directoryId ?? "loose"}:${chat.id}`,
    type: "chat",
    data: { chatId: chat.id, directoryId: chat.directoryId ?? null },
    disabled: editing,
  });

  return (
    <motion.div layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className={cn("group relative", isDragSource && "opacity-40")}>
      {/* The link itself is the draggable: dnd-kit won't start a drag from an interactive
          element nested inside the draggable, but it will from the draggable element itself. */}
      <Link
        ref={dragRef}
        href={`/chats/${chat.id}`}
        draggable={false}
        onClick={ctx.onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(rowBase, compact ? "py-1" : "py-1.5", active && "bg-sidebar-accent")}
      >
        <EntityAvatar name={chat.characterName} src={chat.characterAvatar} color={chat.characterColor} size={compact ? 24 : 28} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              defaultValue={chat.title}
              aria-label="Chat title"
              onClick={(e) => e.preventDefault()}
              onBlur={(e) => {
                setEditing(false);
                const t = e.currentTarget.value.trim();
                if (t && t !== chat.title) void update({ title: t });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = chat.title;
                  e.currentTarget.blur();
                }
              }}
              className="surface-well w-full rounded px-1 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            />
          ) : (
            <div className={cn("truncate text-[13px] leading-tight", active ? "font-semibold" : "font-medium")}>{chat.title}</div>
          )}
          {!compact && (
            <div className="truncate text-[11px] text-muted-foreground">
              {chat.characterName} · {relativeTime(chat.lastMessageAt)}
            </div>
          )}
        </div>
        {chat.pinned && <Pin className="size-3 shrink-0 text-muted-foreground group-hover:opacity-0" />}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 max-md:opacity-100"
              aria-label="Chat options"
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => setTimeout(() => setEditing(true), 50)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => update({ pinned: !chat.pinned })}>
            {chat.pinned ? <PinOff /> : <Pin />} {chat.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput /> Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              {ctx.directories.map((d) => (
                <DropdownMenuItem key={d.id} disabled={d.id === chat.directoryId} onClick={() => void moveChat(chat.id, d.id)}>
                  <Folder /> <span className="flex-1 truncate">{d.name}</span>
                  {d.id === chat.directoryId && <Check className="text-brand" />}
                </DropdownMenuItem>
              ))}
              {ctx.directories.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onClick={() => setTimeout(() => ctx.onNewDirectory(chat.id), 50)}>
                <FolderPlus /> New directory…
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {currentDir && (
            <DropdownMenuItem onClick={() => void moveChat(chat.id, null)}>
              <FolderMinus /> Remove from {currentDir.name}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={async () => {
              await update({ archived: true });
              toast.success("Chat archived", { action: undoAction(() => update({ archived: false })), duration: UNDO_DURATION });
            }}
          >
            <Archive /> Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={remove}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.div>
  );
}
