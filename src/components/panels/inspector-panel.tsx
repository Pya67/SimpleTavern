"use client";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Copy, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Group, Section } from "@/components/panels/generation-panel";
import { rpc } from "@/lib/client/rpc";
import { formatNum } from "@/lib/format";
import type { PromptBreakdown } from "@/lib/types";

const COLORS: Record<string, string> = {
  main: "var(--chart-1)",
  history: "var(--chart-2)",
  memory: "var(--chart-3)",
  facts: "var(--chart-3)",
  lore_before: "var(--chart-4)",
  lore_after: "var(--chart-4)",
  lore_depth: "var(--chart-4)",
  char_description: "var(--chart-5)",
  char_personality: "var(--chart-5)",
  scenario: "var(--chart-5)",
  examples: "var(--chart-5)",
};

export function InspectorPanel({ chatId, messageId, personaId, onClear }: { chatId: string; messageId: string | null; personaId: string | null; onClear: () => void }) {
  const q = useQuery({
    queryKey: ["inspect", chatId, messageId, personaId],
    queryFn: async () => {
      if (messageId) {
        const snap = await rpc("messages.inspect", { id: messageId });
        if (!snap) return null;
        const p = snap.payload as { model: string; messages: { role: string; content: string }[]; params: unknown };
        return { model: p.model, messages: p.messages, params: p.params, breakdown: snap.breakdown as PromptBreakdown };
      }
      return rpc("chats.previewPrompt", { id: chatId, personaId: personaId ?? undefined });
    },
    staleTime: 0,
  });

  if (q.isLoading) return <Loader2 className="mx-auto mt-10 size-5 animate-spin text-muted-foreground" />;
  if (!q.data) return <p className="text-sm text-muted-foreground">No prompt snapshot for this message.</p>;
  const { breakdown, messages, model } = q.data;
  const total = breakdown.total;

  return (
    <div className="space-y-6">
      <div className="surface-well flex items-center justify-between rounded-xl px-3 py-2 text-xs">
        <span>{messageId ? "Prompt that produced this message" : "Next reply preview"}</span>
        {messageId && (
          <button onClick={onClear} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <X className="size-3" /> Show next
          </button>
        )}
      </div>

      <Section title="Token budget">
        <Group className="space-y-0">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium">{model}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatNum(total)} / {formatNum(breakdown.budget)} prompt · {formatNum(breakdown.contextSize)} ctx
            </span>
          </div>
          <div className="surface-well mt-2 flex h-2 gap-px overflow-hidden rounded-full">
            {breakdown.items
              .filter((i) => i.tokens > 0)
              .map((i, idx) => (
                <div key={idx} title={`${i.label}: ${i.tokens}`} style={{ width: `${(i.tokens / Math.max(breakdown.budget, total)) * 100}%`, background: COLORS[i.kind] ?? "var(--chart-2)" }} className="h-full" />
              ))}
          </div>
          <div className="mt-3 space-y-1">
            {breakdown.items.map((i, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className="size-2 shrink-0 rounded-full" style={{ background: COLORS[i.kind] ?? "var(--chart-2)" }} />
                <span className="flex-1 truncate text-muted-foreground">{i.label}</span>
                <span className="tabular-nums">{formatNum(i.tokens)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs tabular-nums text-muted-foreground">
            Messages: {breakdown.historyIncluded} in context · {breakdown.compactedCovered} summarized ·{" "}
            <span className={cn(breakdown.historyDropped > 0 && "font-medium text-destructive")}>{breakdown.historyDropped} dropped</span>
          </p>
        </Group>
      </Section>

      {breakdown.loreFired.length > 0 && (
        <Section title={`Lore activated (${breakdown.loreFired.length})`}>
          <div className="space-y-1">
            {breakdown.loreFired.map((l) => (
              <div key={l.id} className="surface-grain rounded-xl px-3 py-2 text-xs">
                <div className="font-medium">{l.comment || l.keys.join(", ") || "Entry"}</div>
                <div className="text-muted-foreground">{l.reason}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title={`Messages (${messages.length})`}
        action={
          <button
            onClick={() => {
              void navigator.clipboard.writeText(JSON.stringify({ model, messages }, null, 2));
              toast.success("Payload copied");
            }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Copy className="size-3" /> Copy JSON
          </button>
        }
      >
        <div className="space-y-2">
          {messages.map((m, i) => (
            <details key={i} className="surface-grain group rounded-xl" open={i === 0 && messages.length < 6}>
              <summary className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs">
                <span className={cn("rounded px-1.5 py-px font-mono text-[10px] uppercase", m.role === "system" ? "bg-chart-3/20" : m.role === "user" ? "bg-chart-2/20" : "bg-chart-1/20")}>{m.role}</span>
                <span className="truncate text-muted-foreground">{m.content.slice(0, 80)}</span>
              </summary>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-relaxed">{m.content}</pre>
            </details>
          ))}
        </div>
      </Section>
    </div>
  );
}
