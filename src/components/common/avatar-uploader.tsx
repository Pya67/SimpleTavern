"use client";
import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { EntityAvatar } from "@/components/common/avatar";

const VIEW = 280;

export async function uploadImage(file: Blob, crop?: { x: number; y: number; width: number; height: number }) {
  const fd = new FormData();
  fd.append("file", file);
  if (crop) fd.append("crop", JSON.stringify(crop));
  const res = await fetch("/api/uploads", { method: "POST", body: fd });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "Upload failed");
  return j.url as string;
}

export function AvatarUploader({ name, value, color, onChange, size = 96 }: { name: string; value: string | null; color?: string | null; onChange: (url: string | null) => void; size?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ file: File; url: string; w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const pick = (f: File) => {
    if (!f.type.startsWith("image/")) return toast.error("Please choose an image");
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      setFile({ file: f, url, w: img.naturalWidth, h: img.naturalHeight });
      setZoom(1);
      setPan({ x: 0, y: 0 });
    };
    img.src = url;
  };

  // Scale so the image covers the circle at zoom 1.
  const base = file ? VIEW / Math.min(file.w, file.h) : 1;
  const scale = base * zoom;
  const clamp = (p: { x: number; y: number }) => {
    if (!file) return p;
    const maxX = Math.max(0, (file.w * scale - VIEW) / 2);
    const maxY = Math.max(0, (file.h * scale - VIEW) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
  };

  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const sizeSrc = VIEW / scale;
      const cx = file.w / 2 - pan.x / scale;
      const cy = file.h / 2 - pan.y / scale;
      const url = await uploadImage(file.file, { x: Math.max(0, cx - sizeSrc / 2), y: Math.max(0, cy - sizeSrc / 2), width: Math.min(sizeSrc, file.w), height: Math.min(sizeSrc, file.h) });
      onChange(url);
      setFile(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="inline-flex flex-col items-center gap-1.5">
        <div className="group relative inline-block">
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) pick(f);
            }}
            className="relative block rounded-full"
            aria-label="Change avatar"
          >
            <EntityAvatar name={name || "?"} src={value} color={color} size={size} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="size-5" />
            </span>
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full bg-popover text-muted-foreground opacity-0 shadow-md transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
              aria-label="Remove avatar"
            >
              <Trash2 className="size-3" />
            </button>
          )}
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        </div>
        {/* While the kaomoji stands in, say plainly that a real picture can go here. */}
        {!value && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Upload className="size-3" /> Upload image
          </button>
        )}
      </div>
      <Dialog open={!!file} onOpenChange={(o) => !o && setFile(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Crop avatar</DialogTitle>
          </DialogHeader>
          {file && (
            <div className="flex flex-col items-center gap-4">
              <div
                className="relative cursor-grab touch-none overflow-hidden rounded-full bg-muted active:cursor-grabbing"
                style={{ width: VIEW, height: VIEW }}
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
                }}
                onPointerMove={(e) => {
                  if (!drag.current) return;
                  setPan(clamp({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y }));
                }}
                onPointerUp={() => (drag.current = null)}
                onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.002)))}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={file.url}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                  style={{ width: file.w * scale, height: file.h * scale, transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))` }}
                />
              </div>
              <div className="flex w-full items-center gap-3 text-xs text-muted-foreground">
                Zoom
                <Slider
                  min={1}
                  max={4}
                  step={0.01}
                  value={[zoom]}
                  onValueChange={(v) => {
                    const z = Array.isArray(v) ? v[0] : (v as number);
                    setZoom(z);
                    setPan((p) => clamp(p));
                  }}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFile(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
