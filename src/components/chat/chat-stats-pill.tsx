"use client";
import { CircleDollarSign, MessageSquare } from "lucide-react";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProviderIcon } from "@/components/common/provider-icons";
import { useChat } from "@/components/chat/chat-store";
import { providerKey, providerLabel, shortModelName } from "@/lib/client/model-providers";
import { formatCost, formatNum } from "@/lib/format";
import type { ModelInfo } from "@/lib/client/queries";

/**
 * Header summary of the chat: model logo, message count, how full the context window was on the
 * last reply, and the total spent. Clicking opens the generation settings.
 */
export function ChatStatsPill({
  modelId,
  model,
  contextSize,
  totalCost,
  onClick,
}: {
  modelId: string;
  model: ModelInfo | undefined;
  /** Context window the server uses: the preset's own size, else the model's. */
  contextSize: number | null | undefined;
  totalCost: number;
  onClick: () => void;
}) {
  const count = useChat((s) => s.total);
  // Prompt size of the most recent reply = how much of the context window the chat currently fills.
  const lastPrompt = useChat((s) => {
    for (let i = s.messages.length - 1; i >= 0; i--) {
      const m = s.messages[i];
      if (m.role === "assistant" && m.promptTokens) return m.promptTokens;
    }
    return null;
  });
  const ctxWindow = contextSize ?? model?.contextLength ?? null;
  const pct = lastPrompt && ctxWindow ? Math.min(100, (lastPrompt / ctxWindow) * 100) : null;
  // Big context windows make small chats round to 0%, so show more precision at the low end.
  const pctLabel = pct == null ? "" : pct < 1 ? "<1%" : pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
  const m = model ?? { id: modelId, name: "" };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={onClick}
            // Sizes follow the chat header's width (an @container): the full pill when there's room,
            // just model + cost when it's tighter, hidden when it's narrow.
            className="hidden h-7 shrink-0 items-center gap-2.5 rounded-full px-2.5 text-xs tabular-nums text-foreground transition-colors hover:bg-accent/80 @lg:flex"
            aria-label="Chat stats and generation settings"
          />
        }
      >
        <ProviderIcon provider={providerKey(m)} label={providerLabel(m) || "?"} className="size-3.5" />
        <span className="hidden items-center gap-1 @2xl:flex">
          <MessageSquare className="size-3" />
          {formatNum(count)}
        </span>
        {pct != null && (
          <span className="hidden items-center gap-1.5 @2xl:flex">
            <ContextRing pct={pct} />
            {pctLabel}
          </span>
        )}
        <span className="flex items-center gap-1">
          <CircleDollarSign className="size-3" />
          {totalCost > 0 ? formatCost(totalCost) : "$0"}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex-col items-start gap-0.5">
        <span className="font-medium">{model ? shortModelName(model) : modelId}</span>
        <span>{count} messages in this chat</span>
        <span>{pct != null ? `Last reply used ${formatNum(lastPrompt!)} of ${formatNum(ctxWindow!)} context tokens (${pctLabel})` : "Context use shows after the next reply"}</span>
        <span>{formatCost(totalCost)} spent on this chat</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** Tiny progress ring for the context share; turns amber/red as it fills. */
function ContextRing({ pct }: { pct: number }) {
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 12 12" className={cn("size-3 -rotate-90", pct >= 90 ? "text-destructive" : pct >= 70 ? "text-amber-500" : "text-brand")} aria-hidden>
      <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
      <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} strokeLinecap="round" />
    </svg>
  );
}
