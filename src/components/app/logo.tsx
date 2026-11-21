import { cn } from "cn";

/**
 * The SimpleTavern mark: a raised tankard on the dark panel tile.
 * The beer follows the accent theme (`--brand`); the master artwork is public/icons/logo.svg.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn("size-6 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect width="512" height="512" rx="112" fill="#1D1A16" />
      <g transform="rotate(-12 256 270) translate(-16 4)">
        <path d="M330 236H352A44 44 0 0 1 396 280V300A44 44 0 0 1 352 344H330" fill="none" stroke="var(--brand)" strokeWidth="32" />
        <rect x="134" y="200" width="200" height="212" rx="28" fill="var(--brand)" />
        <path
          d="M134 230V208C134 182 152 164 176 162C186 138 210 124 236 124C262 124 282 138 292 158C316 158 334 178 334 202V230Z"
          fill="#EDE8E1"
        />
        <path d="M266 228V262A14 14 0 0 0 294 262V228Z" fill="#EDE8E1" />
      </g>
      <circle cx="348" cy="106" r="16" fill="#EDE8E1" />
      <circle cx="390" cy="138" r="10" fill="#EDE8E1" />
    </svg>
  );
}

/** Mark plus the SimpleTavern wordmark. */
export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <LogoMark className={markClassName} />
      <span className="truncate font-semibold tracking-tight">SimpleTavern</span>
    </span>
  );
}
