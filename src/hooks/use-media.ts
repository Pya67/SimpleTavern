"use client";
import { useSyncExternalStore } from "react";

export function useMedia(query: string, ssr = false) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => ssr,
  );
}

export const useIsMobile = () => useMedia("(max-width: 767px)");
