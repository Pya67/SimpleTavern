"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { toast } from "sonner";
import { cn } from "cn";
import { Plus, Star, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { AvatarUploader } from "@/components/common/avatar-uploader";
import { EntityAvatar } from "@/components/common/avatar";
import { EmptyState } from "@/components/common/empty-state";
import { confirmDialog } from "@/components/common/confirm";
import { SaveIndicator, TextField } from "@/components/editors/field";
import { useAutosave } from "@/hooks/use-autosave";
import { qk, usePersonas, useSettings, type PersonaT } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";

export default function PersonasPage() {
  const { data: personas } = usePersonas();
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => {
    if (personas) {
      setOrder(personas.map((p) => p.id));
      if (!selected || !personas.some((p) => p.id === selected)) setSelected(personas[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personas]);

  const byId = new Map((personas ?? []).map((p) => [p.id, p]));
  const current = selected ? byId.get(selected) : undefined;

  const create = async () => {
    const p = await rpc("personas.create", { name: "New persona", description: "", pronouns: "" });
    await qc.invalidateQueries({ queryKey: qk.personas });
    setSelected(p.id);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Personas"
        description="Who you are in the story. Switch any time — even mid-chat."
        actions={
          <Button size="sm" onClick={create} className="bg-brand text-brand-foreground hover:bg-brand/90">
            <Plus /> New persona
          </Button>
        }
      />
      {personas && !personas.length ? (
        <EmptyState icon={UserRound} title="No personas" action={<Button onClick={create}>Create persona</Button>} />
      ) : (
        <div className="borderless-controls mx-auto grid min-h-0 w-full max-w-5xl flex-1 gap-6 overflow-y-auto px-4 py-6 md:grid-cols-[280px_1fr] md:px-6">
          <Reorder.Group
            axis="y"
            values={order}
            onReorder={(ids: string[]) => {
              setOrder(ids);
              void rpc("personas.reorder", { ids }).then(() => qc.invalidateQueries({ queryKey: qk.personas }));
            }}
            className="space-y-1.5"
          >
            {order.map((id) => {
              const p = byId.get(id);
              if (!p) return null;
              return (
                <Reorder.Item
                  key={id}
                  value={id}
                  onClick={() => setSelected(id)}
                  className={cn("surface-grain flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-accent", selected === id && "bg-brand/12 hover:bg-brand/15")}
                >
                  <EntityAvatar name={p.name} src={p.avatar} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {p.name}
                      {settings?.defaultPersonaId === p.id && <Star className="size-3 shrink-0 fill-brand text-brand" />}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{p.description || "No description"}</div>
                  </div>
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
          <AnimatePresence mode="wait">
            {current && (
              <motion.div key={current.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
                <PersonaEditor persona={current} isDefault={settings?.defaultPersonaId === current.id} onDeleted={() => setSelected(null)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function PersonaEditor({ persona, isDefault, onDeleted }: { persona: PersonaT; isDefault: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: persona.name, description: persona.description, pronouns: persona.pronouns, avatar: persona.avatar });
  const state = useAutosave(form, async (f) => {
    await rpc("personas.update", { id: persona.id, ...f, name: f.name || "Unnamed" });
    qc.invalidateQueries({ queryKey: qk.personas });
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="surface-grain space-y-5 rounded-2xl p-5">
      <div className="flex items-start gap-5">
        <AvatarUploader name={form.name} value={form.avatar} onChange={(v) => set("avatar", v)} size={84} />
        <div className="min-w-0 flex-1 space-y-3">
          <TextField label="Name" value={form.name} onChange={(v) => set("name", v)} />
          <TextField label="Pronouns" value={form.pronouns} onChange={(v) => set("pronouns", v)} placeholder="they/them" />
        </div>
      </div>
      <TextField
        label="Description"
        hint="Sent to the model so the character knows who they're talking to. Use {{user}} for the persona's name."
        multiline
        rows={6}
        value={form.description}
        onChange={(v) => set("description", v)}
        placeholder="Appearance, personality, background…"
      />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <SaveIndicator state={state} />
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          disabled={isDefault}
          onClick={async () => {
            await rpc("settings.update", { defaultPersonaId: persona.id });
            qc.invalidateQueries({ queryKey: qk.settings });
            toast.success(`${form.name} is now your default persona`);
          }}
        >
          <Star /> {isDefault ? "Default persona" : "Make default"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={async () => {
            const ok = await confirmDialog({ title: `Delete ${form.name}?`, description: "Messages sent as this persona will keep their text but lose the persona link.", confirmLabel: "Delete", destructive: true });
            if (!ok) return;
            try {
              await rpc("personas.delete", { id: persona.id });
              qc.invalidateQueries({ queryKey: qk.personas });
              onDeleted();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          <Trash2 /> Delete
        </Button>
      </div>
    </div>
  );
}
