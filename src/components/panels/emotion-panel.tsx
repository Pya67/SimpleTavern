"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { toast } from "sonner";
import { HeartPulse, Loader2, Pencil, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Group, Section } from "@/components/panels/generation-panel";
import { AffectionMeter, EMOTION_COLOR, EmotionBars } from "@/components/chat/emotion";
import { appraise, jumpToMessage, setEmotion, useChat } from "@/components/chat/chat-store";
import { confirmDialog } from "@/components/common/confirm";
import { qk, type ChatInfo } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import { EMOTIONS, NEUTRAL_BASELINE, type EmotionState } from "@/lib/emotion/engine";
import { KAOMOJI_GROUPS } from "@/lib/kaomoji";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function EmotionPanel({ info }: { info: ChatInfo }) {
  const qc = useQueryClient();
  const chatId = info.chat.id;
  const enabled = info.chat.emotionEnabled;
  const name = info.character.name;
  const messages = useChat((s) => s.messages);
  const pending = useChat((s) => s.emotionPending);
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);

  const lastReply = [...messages].reverse().find((m) => m.role === "assistant" && m.content.trim());
  const current = [...messages].reverse().find((m) => m.role === "assistant" && m.emotion);
  const state = current?.emotion ?? null;
  const baseline = info.chat.emotionBaseline ?? null;
  const reading = !!lastReply && pending.includes(lastReply.id);
  const history = messages.filter((m) => m.role === "assistant" && m.emotion).slice(-12).reverse();

  const refreshChat = () => qc.invalidateQueries({ queryKey: qk.chat(chatId) });

  const toggle = async (on: boolean) => {
    qc.setQueryData<ChatInfo>(qk.chat(chatId), (old) => (old ? { ...old, chat: { ...old.chat, emotionEnabled: on } } : old));
    await rpc("chats.update", { id: chatId, emotionEnabled: on });
    await refreshChat();
    // Start from where the story is: read the latest reply right away.
    if (on && lastReply && !lastReply.emotion) {
      await appraise(lastReply.id);
      refreshChat();
    }
  };

  const reread = async () => {
    if (!lastReply) return;
    await appraise(lastReply.id, true);
    refreshChat();
  };

  const reset = async () => {
    const ok = await confirmDialog({
      title: "Reset feelings?",
      description: `${name}'s temperament is re-estimated from the character sheet, and their mood starts over from it. Earlier replies keep their readings.`,
      confirmLabel: "Reset",
    });
    if (!ok) return;
    setResetting(true);
    try {
      const res = await rpc("emotion.reset", { chatId });
      if (res.messageId) setEmotion(res.messageId, res.state);
      await refreshChat();
      toast.success("Feelings reset");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section title="Emotion engine">
        <Group>
          <label className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Track {name}&apos;s feelings</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                After each reply, a quick read of how {name} feels. Moods build up, fade back toward their temperament, and shape the next replies. Uses the memory model: one small extra call per reply.
              </span>
            </span>
            <Switch checked={enabled} onCheckedChange={toggle} className="mt-0.5" />
          </label>
        </Group>
      </Section>

      {enabled && (
        <>
          <Section
            title="Right now"
            action={
              state && (
                <div className="flex gap-0.5">
                  <Button variant="ghost" size="icon-sm" onClick={reread} disabled={!lastReply || reading} aria-label="Re-read the latest reply">
                    {reading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing((e) => !e)} aria-label="Edit feelings" className={cn(editing && "bg-accent")}>
                    <Pencil />
                  </Button>
                </div>
              )
            }
          >
            {state && current && editing ? (
              <EmotionEditor
                key={current.id}
                state={state}
                onCancel={() => setEditing(false)}
                onSave={async (next) => {
                  const { emotion } = await rpc("emotion.set", { messageId: current.id, state: next });
                  setEmotion(current.id, emotion);
                  setEditing(false);
                  toast.success("Feelings updated", { description: "The next reply builds on them." });
                }}
              />
            ) : state ? (
              <Group className="space-y-4">
                <div className="space-y-1.5">
                  <div className="whitespace-nowrap text-2xl leading-tight" aria-hidden>
                    {state.kaomoji}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {cap(state.label)}
                      {state.manual && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-medium text-muted-foreground">edited</span>}
                    </div>
                    {state.note && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{state.note}</p>}
                    {current && current.id !== lastReply?.id && (
                      <p className="mt-1 text-[11px] text-muted-foreground">From an earlier reply; the latest hasn&apos;t been read yet.</p>
                    )}
                  </div>
                </div>
                <AffectionMeter value={state.affection} />
                <EmotionBars v={state.v} baseline={baseline} />
                {baseline && <p className="text-[11px] text-muted-foreground">Tick marks show {name}&apos;s resting level for each feeling.</p>}
              </Group>
            ) : (
              <Group className="flex flex-col items-center gap-3 py-6 text-center">
                <HeartPulse className="size-6 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{lastReply ? `No reading yet for ${name}.` : `${name}'s mood shows up after their first reply.`}</p>
                {lastReply && (
                  <Button variant="outline" size="sm" onClick={() => appraise(lastReply.id).then(refreshChat)} disabled={reading}>
                    {reading ? <Loader2 className="animate-spin" /> : <HeartPulse />} Read the latest reply
                  </Button>
                )}
              </Group>
            )}
          </Section>

          {history.length > 1 && (
            <Section title="Mood over time">
              <Group className="space-y-0.5 p-1.5">
                {history.map((m, i) => {
                  const e = m.emotion!;
                  const older = history[i + 1]?.emotion;
                  const delta = older ? e.affection - older.affection : 0;
                  return (
                    <button
                      key={m.id}
                      onClick={() => jumpToMessage(m.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                    >
                      <span className="w-24 shrink-0 truncate whitespace-nowrap" aria-hidden>
                        {e.kaomoji}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{e.label}</span>
                      {delta !== 0 && (
                        <span className={cn("tabular-nums", delta > 0 ? "text-brand" : "text-destructive")} title="Change in feelings toward you">
                          {delta > 0 ? "+" : ""}
                          {delta}
                        </span>
                      )}
                      <span className="flex h-3 w-14 shrink-0 items-end gap-px" aria-hidden>
                        {EMOTIONS.map((k) => (
                          <span key={k} className="flex-1 rounded-[1px]" style={{ height: `${Math.max(8, e.v[k])}%`, background: EMOTION_COLOR[k] }} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </Group>
            </Section>
          )}

          <Section title="Temperament">
            <Group>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {baseline
                  ? `How ${name} feels on an ordinary day, estimated from their character sheet. Strong feelings fade back toward this.`
                  : `Estimated from ${name}'s character sheet on the first reading.`}
              </p>
              {baseline && <EmotionBars v={{ ...NEUTRAL_BASELINE, ...baseline }} compact />}
              <Button variant="outline" size="sm" className="w-full" onClick={reset} disabled={resetting}>
                {resetting ? <Loader2 className="animate-spin" /> : <RotateCcw />} Re-estimate and reset mood
              </Button>
            </Group>
          </Section>
        </>
      )}
    </div>
  );
}

function EmotionEditor({ state, onSave, onCancel }: { state: EmotionState; onSave: (s: EmotionState) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(state);
  const [saving, setSaving] = useState(false);
  const val = (x: number | readonly number[]) => (Array.isArray(x) ? x[0] : (x as number));
  return (
    <Group className="space-y-4">
      <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} aria-label="Mood" placeholder="Mood" maxLength={40} />
      <div className="space-y-2" role="radiogroup" aria-label="Face">
        {KAOMOJI_GROUPS.filter((g) => g.mood !== "Animals").map((g) => (
          <div key={g.mood}>
            <div className="mb-1 text-[11px] text-muted-foreground">{g.mood}</div>
            <div className="flex flex-wrap gap-1">
              {g.items.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={draft.kaomoji === k}
                  onClick={() => setDraft({ ...draft, kaomoji: k })}
                  className={cn(
                    "whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-accent",
                    draft.kaomoji === k ? "bg-accent text-foreground ring-1 ring-brand" : "text-muted-foreground",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="What's going on inside them (optional)" rows={2} maxLength={240} />
      <div className="space-y-2.5">
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Toward you</span>
            <span className="tabular-nums">{draft.affection}</span>
          </div>
          <Slider min={-100} max={100} step={1} value={[draft.affection]} onValueChange={(v) => setDraft({ ...draft, affection: val(v) })} />
        </div>
        {EMOTIONS.map((e) => (
          <div key={e} className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: EMOTION_COLOR[e] }} aria-hidden />
                {cap(e)}
              </span>
              <span className="tabular-nums">{draft.v[e]}</span>
            </div>
            <Slider min={0} max={100} step={1} value={[draft.v[e]]} onValueChange={(v) => setDraft({ ...draft, v: { ...draft.v, [e]: val(v) } })} />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({ ...draft, label: draft.label.trim() || state.label });
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
    </Group>
  );
}
