"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Drawer } from "vaul";
import { PanelLeft, WifiOff } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "@/components/app/sidebar";
import { CommandPalette } from "@/components/app/command-palette";
import { NewChatDialog } from "@/components/app/new-chat-dialog";
import { HelpDialog } from "@/components/app/help-dialog";
import { ConfirmHost, useConfirmOpen } from "@/components/common/confirm";
import { PortalContainerContext } from "@/components/ui/portal-container";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useIsMobile } from "@/hooks/use-media";
import { useOnline } from "@/hooks/use-online";
import { useUi } from "@/stores/ui";
import { useSettings } from "@/lib/client/queries";
import { applyAccent } from "@/lib/themes";
import { applyFonts } from "@/lib/fonts";
import { applyAvatarShape } from "@/lib/avatar-shape";

const SIDEBAR_W = 272;

export function AppShell({ children }: { children: React.ReactNode }) {
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const mobileNavOpen = useUi((s) => s.mobileNavOpen);
  const set = useUi((s) => s.set);
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const online = useOnline();

  useEffect(() => set({ mobileNavOpen: false }), [pathname, set]);
  // The drawer is modal and locks pointer events outside itself, so a dialog shown over it
  // (opened from a sidebar action) would be unclickable. Dialogs take over from the drawer.
  const appDialogOpen = useUi((s) => s.newChatOpen || s.paletteOpen || s.helpOpen);
  const confirmOpen = useConfirmOpen();
  const dialogOpen = appDialogOpen || confirmOpen;
  useEffect(() => {
    if (dialogOpen) set({ mobileNavOpen: false });
  }, [dialogOpen, set]);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Keep the accent palette in sync with saved settings (the boot script covers first paint).
  const ui = useSettings().data?.ui;
  const accent = ui?.accent;
  const customAccent = ui?.customAccent;
  useEffect(() => {
    if (accent) applyAccent(accent, customAccent);
  }, [accent, customAccent]);
  const appFont = ui?.appFont;
  const chatFont = ui?.chatFont;
  useEffect(() => {
    if (ui) applyFonts(appFont, chatFont);
  }, [ui, appFont, chatFont]);
  const avatarShape = ui?.avatarShape;
  useEffect(() => {
    if (ui) applyAvatarShape(avatarShape);
  }, [ui, avatarShape]);

  useHotkeys({
    "mod+k": () => set({ paletteOpen: !useUi.getState().paletteOpen }),
    "alt+b": () => (isMobile ? set({ mobileNavOpen: !mobileNavOpen }) : set({ sidebarOpen: !useUi.getState().sidebarOpen })),
    "alt+n": () => set({ newChatOpen: true }),
    "?": () => set({ helpOpen: true, helpTab: "shortcuts" }),
  });

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background standalone:bg-black standalone:pt-[env(safe-area-inset-top)] standalone:pb-[env(safe-area-inset-bottom)]">
      {!isMobile && (
        <motion.aside
          initial={false}
          animate={{ width: sidebarOpen ? SIDEBAR_W : 0, opacity: sidebarOpen ? 1 : 0.4 }}
          transition={{ type: "spring", stiffness: 420, damping: 42 }}
          className="relative shrink-0 overflow-hidden bg-sidebar"
          aria-hidden={!sidebarOpen}
        >
          <div style={{ width: SIDEBAR_W }} className="h-full">
            <SidebarContent />
          </div>
        </motion.aside>
      )}
      {isMobile && (
        <Drawer.Root direction="left" open={mobileNavOpen} onOpenChange={(o) => set({ mobileNavOpen: o })}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
            <Drawer.Content ref={drawerRef} className="fixed inset-y-0 left-0 z-50 w-[86vw] max-w-[320px] bg-sidebar shadow-2xl outline-none standalone:before:absolute standalone:before:inset-x-0 standalone:before:top-0 standalone:before:z-10 standalone:before:h-[env(safe-area-inset-top)] standalone:before:bg-black" aria-describedby={undefined}>
              <Drawer.Title className="sr-only">Navigation</Drawer.Title>
              <div className="h-full pt-[env(safe-area-inset-top)]">
                {/* Menus opened in the drawer render inside it, where taps are allowed. */}
                <PortalContainerContext.Provider value={drawerRef}>
                  <SidebarContent onNavigate={() => set({ mobileNavOpen: false })} />
                </PortalContainerContext.Provider>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
      <main className="relative flex min-w-0 flex-1 flex-col bg-background">
        <AnimatePresence>
          {!online && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex items-center justify-center gap-2 overflow-hidden bg-destructive/15 text-xs font-medium text-destructive"
            >
              <span className="flex items-center gap-2 py-1.5">
                <WifiOff className="size-3.5" /> You&apos;re offline — messages will send when you reconnect.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        {children}
      </main>
      <CommandPalette />
      <NewChatDialog />
      <HelpDialog />
      <ConfirmHost />
    </div>
  );
}

/** Button that opens the sidebar when it is collapsed (desktop) or the drawer (mobile). */
export function SidebarToggle({ className }: { className?: string }) {
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const set = useUi((s) => s.set);
  const isMobile = useIsMobile();
  if (!isMobile && sidebarOpen) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={() => (isMobile ? set({ mobileNavOpen: true }) : set({ sidebarOpen: true }))}
      aria-label="Open sidebar"
    >
      <PanelLeft />
    </Button>
  );
}
