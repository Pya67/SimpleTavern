"use client";
import { Undo2 } from "lucide-react";

/** How long toasts with an Undo button stay up (longer than the default, so there's time to click). */
export const UNDO_DURATION = 6000;

/** Toast action for undoing what just happened: an Undo button with an icon. */
export function undoAction(onClick: () => void) {
  return {
    label: (
      <span className="flex items-center gap-1">
        <Undo2 className="size-3.5" /> Undo
      </span>
    ),
    onClick,
  };
}
