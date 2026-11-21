"use client";
import { create } from "zustand";
import type { LucideIcon } from "lucide-react";

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  icon?: LucideIcon;
  shortcut?: string;
  keywords?: string[];
  run: () => void;
}

/** Context-specific commands (e.g. the open chat) contributed to the command palette. */
export const useCommands = create<{ commands: Record<string, PaletteCommand[]>; register: (scope: string, cmds: PaletteCommand[]) => void; unregister: (scope: string) => void }>(
  (set) => ({
    commands: {},
    register: (scope, cmds) => set((s) => ({ commands: { ...s.commands, [scope]: cmds } })),
    unregister: (scope) =>
      set((s) => {
        const next = { ...s.commands };
        Reflect.deleteProperty(next, scope);
        return { commands: next };
      }),
  }),
);
