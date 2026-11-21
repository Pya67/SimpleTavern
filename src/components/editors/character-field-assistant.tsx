"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { Loader2, Sparkles } from "lucide-react";
import { ModelPicker } from "@/components/common/model-picker";
import { FieldLabel, TextField } from "@/components/editors/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useModels } from "@/lib/client/queries";
import { rpc, type ProcInput } from "@/lib/client/rpc";

type DraftInput = ProcInput<"characters.draftField">;
export type CharacterWritingField = DraftInput["field"];

const primaryAction = "bg-brand text-brand-foreground hover:bg-brand/90";

type AssistantProps = {
  field: CharacterWritingField;
  label: string;
  value: string;
  onApply: (value: string) => void;
  character: DraftInput["character"];
  model: string;
  defaultModel?: string;
  onModelChange: (model: string) => void;
};

export function CharacterFieldAssistant(props: AssistantProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="xs" className="text-muted-foreground" aria-label={`AI for ${props.label}`} />}>
        <Sparkles /> AI
      </DialogTrigger>
      <DialogContent className="grain borderless-controls flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 shadow-2xl ring-transparent sm:max-w-lg">
        <DialogHeader className="shrink-0 gap-1 px-5 pt-4 pr-12 pb-2">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 shrink-0 text-brand" aria-hidden /> AI writing · {props.label}
          </DialogTitle>
          <DialogDescription className="sr-only">Improve this field or draft it from a character brief.</DialogDescription>
        </DialogHeader>
        {open && <DraftControls {...props} close={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function DraftControls({ field, label, value, onApply, character, model, defaultModel, onModelChange, close }: AssistantProps & { close: () => void }) {
  const [mode, setMode] = useState<DraftInput["mode"]>(value.trim() ? "improve" : "write");
  const [brief, setBrief] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const draftPreview = useRef<HTMLElement>(null);
  const { data: models } = useModels();
  const modelId = model || (models?.some((item) => item.id === defaultModel) ? defaultModel ?? "" : "");
  const text = (mode === "improve" ? value : brief).trim();

  useEffect(() => {
    if (draft) draftPreview.current?.scrollIntoView({ block: "nearest" });
  }, [draft]);

  const clearDraft = () => {
    setDraft("");
    setError("");
  };

  const generate = async () => {
    if (!modelId || !text || busy) return;
    clearDraft();
    if (text.length > 40000) {
      setError("Shorten the input to 40,000 characters or fewer and try again.");
      return;
    }
    setBusy(true);
    try {
      const context = Object.fromEntries(Object.entries(character).flatMap(([key, content]) => {
        const excerpt = content?.trim().slice(0, 2400);
        return key === field || !excerpt ? [] : [[key, excerpt]];
      }));
      const result = await rpc("characters.draftField", { field, mode, modelId, text, character: context });
      setDraft(result.text);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not generate a draft.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="min-h-0 space-y-4 overflow-y-auto px-5 pt-2 pb-4">
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div role="group" aria-label="Writing mode" className="surface-well flex w-fit rounded-lg p-0.5">
            {(["improve", "write"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50",
                  mode === option ? "bg-popover font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  if (mode === option) return;
                  setMode(option);
                  clearDraft();
                }}
              >
                {option === "improve" ? "Improve" : "Write for me"}
              </button>
            ))}
          </div>
          {mode === "write" ? (
            <TextField label="Who is the character?" value={brief} onChange={(value) => { setBrief(value); clearDraft(); }} multiline rows={3} showTokens={false} placeholder="Name the character and their series, or describe an original character." />
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">{text ? "Simplifies and formats the current text while keeping its meaning." : "Add some text to this field before using Improve."}</p>
          )}
          <div role="group" aria-label="Model">
            <FieldLabel label="Model" />
            <ModelPicker value={modelId} onChange={(value) => { onModelChange(value); clearDraft(); }} />
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {draft && (
          <section ref={draftPreview} aria-label="Draft preview">
            <h3 className="mb-1.5 text-sm font-medium">Draft</h3>
            <p className="surface-well max-h-52 overflow-y-auto whitespace-pre-wrap wrap-anywhere rounded-xl p-3 leading-relaxed">{draft}</p>
          </section>
        )}
      </div>
      <DialogFooter className="m-0 shrink-0 flex-row justify-end gap-1.5 bg-transparent px-5 py-3">
        <Button type="button" size="sm" variant={draft ? "ghost" : "default"} className={cn(!draft && primaryAction)} onClick={generate} disabled={!modelId || !text || busy}>
          {busy && <Loader2 className="animate-spin" />}
          {busy ? "Writing…" : draft ? "Regenerate" : "Generate"}
        </Button>
        {draft && <Button type="button" size="sm" className={primaryAction} onClick={() => { onApply(draft); close(); }} aria-label={`Use draft for ${label}`}>Use draft</Button>}
      </DialogFooter>
    </>
  );
}
