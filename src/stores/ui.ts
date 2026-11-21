"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  sidebarOpen: boolean;
  panelOpen: boolean;
  panelTab: string;
  panelWidth: number;
  paletteOpen: boolean;
  helpOpen: boolean;
  /** Which tab the help dialog opens on. */
  helpTab: "features" | "shortcuts";
  newChatOpen: boolean;
  /** Sidebar directories the user has collapsed. */
  collapsedDirs: string[];
  /** Sidebar sections ("chats", "directories") the user has collapsed. */
  collapsedSections: string[];
  mobileNavOpen: boolean;
  /** Mobile context drawer (not persisted, so it never pops open on load). */
  mobilePanelOpen: boolean;
  set: (p: Partial<Omit<UiState, "set">>) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      panelOpen: false,
      panelTab: "character",
      panelWidth: 380,
      paletteOpen: false,
      helpOpen: false,
      helpTab: "shortcuts",
      newChatOpen: false,
      collapsedDirs: [],
      collapsedSections: [],
      mobileNavOpen: false,
      mobilePanelOpen: false,
      set: (p) => set(p),
    }),
    {
      name: "st-ui",
      partialize: (s) => ({ sidebarOpen: s.sidebarOpen, panelOpen: s.panelOpen, panelTab: s.panelTab, panelWidth: s.panelWidth, collapsedDirs: s.collapsedDirs, collapsedSections: s.collapsedSections }),
    },
  ),
);

interface DraftState {
  drafts: Record<string, string>;
  setDraft: (chatId: string, text: string) => void;
}

export const useDrafts = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (chatId, text) =>
        set((s) => {
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(s.drafts)) if (k !== chatId) next[k] = v;
          if (text) next[chatId] = text;
          return { drafts: next };
        }),
    }),
    { name: "st-drafts" },
  ),
);
