"use client"

import * as React from "react"
import { Pipette } from "lucide-react"
import { cn } from "cn"

type Hsv = { h: number; s: number; v: number }

const HEX_RE = /^#[0-9a-f]{6}$/i

function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}

function hsvToHex({ h, s, v }: Hsv) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
  }
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, "0")).join("")}`
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))

/** Pointer drag over an element, reporting the position as 0–1 fractions. */
function useDrag(onMove: (x: number, y: number) => void) {
  const ref = React.useRef<HTMLDivElement>(null)
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    onMove(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height))
  }
  return {
    ref,
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      move(e)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e)
    },
  }
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }

/** Saturation/brightness area, hue slider, hex field and optional eyedropper. */
function ColorPicker({
  value,
  onChange,
  presets,
  className,
}: {
  value: string
  onChange: (hex: string) => void
  presets?: string[]
  className?: string
}) {
  // Keep HSV locally so hue survives greys/black, where the hex alone loses it.
  const [hsv, setHsv] = React.useState(() => hexToHsv(HEX_RE.test(value) ? value : "#000000"))
  const [draft, setDraft] = React.useState<string | null>(null)
  const [seen, setSeen] = React.useState(value)
  const current = hsvToHex(hsv)
  if (value !== seen) {
    // Value changed from outside (e.g. reset elsewhere): adopt it unless it's what we just sent.
    setSeen(value)
    if (HEX_RE.test(value) && value.toLowerCase() !== current) setHsv(hexToHsv(value))
  }

  const commit = (next: Hsv) => {
    setHsv(next)
    onChange(hsvToHex(next))
  }
  const area = useDrag((x, y) => commit({ ...hsv, s: x, v: 1 - y }))
  const hue = useDrag((x) => commit({ ...hsv, h: x * 360 }))
  const step = (e: React.KeyboardEvent, key: "s" | "v" | "h", dx: number) => {
    const max = key === "h" ? 360 : 1
    const inc = (key === "h" ? 2 : 0.02) * (e.shiftKey ? 5 : 1) * dx
    e.preventDefault()
    commit({ ...hsv, [key]: Math.min(max, Math.max(0, hsv[key] + inc)) })
  }
  const EyeDropper = typeof window !== "undefined" ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper : undefined

  return (
    <div data-slot="color-picker" className={cn("flex flex-col gap-3", className)}>
      <div
        {...area}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(e, "s", 1)
          else if (e.key === "ArrowLeft") step(e, "s", -1)
          else if (e.key === "ArrowUp") step(e, "v", 1)
          else if (e.key === "ArrowDown") step(e, "v", -1)
        }}
        className="relative h-36 w-full cursor-crosshair touch-none rounded-md outline-none ring-ring/50 focus-visible:ring-3"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
        }}
      >
        <span
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: current }}
        />
      </div>
      <div
        {...hue}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") step(e, "h", 1)
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") step(e, "h", -1)
        }}
        className="relative h-3 w-full cursor-pointer touch-none rounded-full outline-none ring-ring/50 focus-visible:ring-3"
        style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="size-8 shrink-0 rounded-md ring-1 ring-foreground/15" style={{ background: current }} />
        <input
          aria-label="Hex color"
          value={draft ?? current.toUpperCase()}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`
            setDraft(v)
            if (HEX_RE.test(v)) commit(hexToHsv(v.toLowerCase()))
          }}
          onBlur={() => setDraft(null)}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 font-mono text-xs uppercase outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
        {EyeDropper && (
          <button
            type="button"
            aria-label="Pick a color from the screen"
            onClick={async () => {
              try {
                const { sRGBHex } = await new EyeDropper().open()
                if (HEX_RE.test(sRGBHex)) commit(hexToHsv(sRGBHex.toLowerCase()))
              } catch {}
            }}
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pipette className="size-4" />
          </button>
        )}
      </div>
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              aria-label={p}
              onClick={() => commit(hexToHsv(p))}
              className={cn("size-5 rounded-sm ring-1 ring-foreground/15 transition-transform hover:scale-110", p === current && "ring-2 ring-foreground")}
              style={{ background: p }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export { ColorPicker, hexToHsv, hsvToHex }
