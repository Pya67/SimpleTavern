"use client";
import { cn } from "cn";
import { kaomojiFor, kaomojiLength } from "@/lib/kaomoji";

/** A kaomoji sized to fit the avatar's width: longer faces get a smaller font. */
function KaomojiFace({ kaomoji, size, label }: { kaomoji: string; size: number; label: string }) {
  // ~0.62em per glyph on average; aim for ~90% of the avatar width, capped so short faces don't balloon.
  const fontSize = Math.min(size * 0.38, (size * 0.9) / (kaomojiLength(kaomoji) * 0.62));
  return (
    <span role="img" aria-label={label} className="whitespace-nowrap font-normal leading-none tracking-tighter" style={{ fontSize }}>
      {kaomoji}
    </span>
  );
}

/**
 * A profile picture: the uploaded image, or a kaomoji on a transparent background when there is none.
 * `color` is accepted for older callers but no longer drawn.
 */
export function EntityAvatar({
  name,
  src,
  size = 32,
  className,
  ring,
}: {
  name: string;
  src?: string | null;
  color?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-[var(--avatar-radius,9999px)] text-foreground",
        ring && "ring-2 ring-background",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="size-full object-cover" draggable={false} />
      ) : (
        <KaomojiFace kaomoji={kaomojiFor(name || "?")} size={size} label={name} />
      )}
    </span>
  );
}
