"use client";
import { useId } from "react";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { estimateTokens } from "@/lib/tokens";
import { Info } from "lucide-react";

export function FieldLabel({ label, hint, tokens, right, htmlFor }: { label: string; hint?: string; tokens?: string; right?: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      {htmlFor ? <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label> : <span className="text-sm font-medium">{label}</span>}
      {hint && (
        <Tooltip>
          <TooltipTrigger render={<span className="cursor-help text-muted-foreground" />}>
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{hint}</TooltipContent>
        </Tooltip>
      )}
      <span className="flex-1" />
      {right}
      {tokens !== undefined && <span className="text-[11px] tabular-nums text-muted-foreground">{estimateTokens(tokens)} tok</span>}
    </div>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline,
  rows = 4,
  mono,
  showTokens = true,
  className,
  right,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  showTokens?: boolean;
  className?: string;
  right?: React.ReactNode;
}) {
  const id = useId();
  const base = "surface-well w-full rounded-lg px-3 py-2 text-sm outline-none transition-shadow placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/60";
  return (
    <div className={cn("block", className)}>
      <FieldLabel label={label} htmlFor={id} hint={hint} tokens={multiline && showTokens ? value : undefined} right={right} />
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className={cn(base, "field-sizing-content min-h-20 resize-y leading-relaxed", mono && "font-mono text-xs")}
          style={{ minHeight: rows * 22 }}
        />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(base, "h-9")} />
      )}
    </div>
  );
}

export function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  return (
    <span className={cn("flex items-center gap-1.5 text-xs text-muted-foreground transition-opacity", state === "idle" && "opacity-0")}>
      <span className={cn("size-1.5 rounded-full", state === "saving" ? "animate-pulse bg-brand" : state === "error" ? "bg-destructive" : "bg-emerald-500")} />
      {state === "saving" ? "Saving…" : state === "error" ? "Save failed" : "Saved"}
    </span>
  );
}
