"use client"

import * as React from "react"

/**
 * Where popups (menus) portal to. Defaults to `document.body`.
 *
 * The mobile nav drawer is a modal (vaul/Radix): while open, `body` gets `pointer-events: none`
 * and only the drawer is interactive. A menu portaled to `body` would then let taps fall through
 * to whatever sits under it, so menus opened inside the drawer portal into the drawer instead.
 */
export const PortalContainerContext = React.createContext<React.RefObject<HTMLElement | null> | undefined>(undefined)

export function usePortalContainer() {
  return React.useContext(PortalContainerContext)
}
