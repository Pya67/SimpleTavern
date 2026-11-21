"use client";
import { useState } from "react";
import Link from "next/link";
import { providerKey, providerLabel, shortModelName, useProviderFilter } from "@/lib/client/model-providers";
import { ProviderIcon } from "@/components/common/provider-icons";
import { Brain, Check, ChevronsUpDown, RefreshCw, Star } from "lucide-react";
import { cn } from "cn";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { qk, useModels, type ModelInfo } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import { formatNum, pricePerM } from "@/lib/format";

const FAV_KEY = "st-fav-models";
const RECENT_KEY = "st-recent-models";
const read = (k: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "[]");
  } catch {
    return [];
  }
};

/** Provider logo for a model, or a neutral letter tile when the provider has none. */
function ModelLogo({ m, className = "size-4" }: { m: Pick<ModelInfo, "id" | "name">; className?: string }) {
  return <ProviderIcon provider={providerKey(m)} label={providerLabel(m) || "?"} className={className} />;
}

function ModelRow({ m, selected, fav, onFav }: { m: ModelInfo; selected: boolean; fav: boolean; onFav: () => void }) {
  return (
    // min-w-0 lets the text column truncate instead of pushing the star out of line on long rows.
    <div className="flex w-full min-w-0 items-center gap-2">
      <Check className={cn("size-3.5 shrink-0", selected ? "opacity-100 text-brand" : "opacity-0")} />
      <ModelLogo m={m} className="size-[18px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{shortModelName(m)}</span>
          {m.reasoning && <Brain className="size-3 shrink-0 text-muted-foreground" />}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {m.id} · {formatNum(m.contextLength)} ctx · {pricePerM(m.promptPrice)} in · {pricePerM(m.completionPrice)} out
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onFav();
        }}
        className="shrink-0 rounded p-1 text-muted-foreground hover:text-brand"
        aria-label={fav ? "Unfavorite" : "Favorite"}
      >
        <Star className={cn("size-3.5", fav && "fill-brand text-brand")} />
      </button>
    </div>
  );
}

export function ModelPicker({ value, onChange, className, variant = "default" }: { value: string; onChange: (id: string) => void; className?: string; variant?: "default" | "chip" }) {
  const { data: allModels, isLoading } = useModels();
  const chip = variant === "chip";
  const providerFilter = useProviderFilter();
  // Only providers chosen in Settings → OpenRouter (all when none are chosen).
  const models = allModels ? providerFilter.filter(allModels) : allModels;
  const [open, setOpen] = useState(false);
  const [favs, setFavs] = useState<string[]>(() => (typeof window === "undefined" ? [] : read(FAV_KEY)));
  const qc = useQueryClient();
  // Look the current model up in the full list, so a model from a hidden provider still shows its name.
  const current = allModels?.find((m) => m.id === value);

  const toggleFav = (id: string) => {
    const next = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id];
    setFavs(next);
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  };
  const pick = (id: string) => {
    const recent = [id, ...read(RECENT_KEY).filter((r) => r !== id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    onChange(id);
    setOpen(false);
  };
  const recent = typeof window === "undefined" ? [] : read(RECENT_KEY);
  const favModels = (models ?? []).filter((m) => favs.includes(m.id));
  const recentModels = (models ?? []).filter((m) => recent.includes(m.id) && !favs.includes(m.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {chip ? (
        <PopoverTrigger
          render={
            <button
              aria-label="Choose model"
              className={cn("flex h-8 min-w-0 max-w-52 items-center gap-1.5 rounded-lg px-2.5 text-xs text-foreground outline-none transition-colors hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring/60 max-md:h-9 max-[360px]:gap-1 max-[360px]:px-1.5", className)}
            />
          }
        >
          <ModelLogo m={current ?? { id: value, name: "" }} className="size-3.5 max-[360px]:hidden" />
          <span className="truncate font-medium">{current ? shortModelName(current) : value.split("/").pop()}</span>
          <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground max-[360px]:size-2.5" />
        </PopoverTrigger>
      ) : (
        <PopoverTrigger render={<Button variant="outline" className={cn("h-auto min-h-9 w-full justify-between gap-2 py-1.5 text-left font-normal", className)} />}>
          <div className="flex min-w-0 items-center gap-2.5">
            <ModelLogo m={current ?? { id: value, name: "" }} className="size-[18px]" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{current ? shortModelName(current) : value || "Choose a model"}</div>
              {current && (
                <div className="truncate text-[11px] text-muted-foreground">
                  {formatNum(current.contextLength)} context · {pricePerM(current.completionPrice)} out
                </div>
              )}
            </div>
          </div>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </PopoverTrigger>
      )}
      <PopoverContent
        className={cn("w-[min(92vw,460px)] p-0", chip && "grain rounded-xl shadow-xl ring-transparent")}
        align="start"
        side={chip ? "top" : undefined}
        sideOffset={chip ? 8 : undefined}
      >
        <Command className={chip ? "bg-transparent p-1.5 **:data-[slot=input-group]:border-transparent **:data-[slot=input-group]:bg-foreground/5" : undefined}>
          <CommandInput placeholder="Search models…" />
          <CommandList className={chip ? "max-h-[min(45dvh,20rem)]" : "max-h-[50vh]"}>
            <CommandEmpty>{isLoading ? "Loading models…" : "No models found."}</CommandEmpty>
            {[
              ["Favorites", favModels],
              ["Recent", recentModels],
              ["All models", models ?? []],
            ].map(([label, list]) =>
              (list as ModelInfo[]).length ? (
                <CommandGroup key={label as string} heading={label as string}>
                  {(list as ModelInfo[]).map((m) => (
                    <CommandItem key={`${label}-${m.id}`} value={`${label} ${m.id} ${m.name}`} onSelect={() => pick(m.id)} className={chip ? "rounded-lg data-selected:bg-brand/12" : undefined}>
                      <ModelRow m={m} selected={m.id === value} fav={favs.includes(m.id)} onFav={() => toggleFav(m.id)} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null,
            )}
          </CommandList>
          <div className={cn("flex items-center justify-between border-t px-3 py-1.5 text-[11px] text-muted-foreground", chip && "border-border/60")}>
            <span>
              {providerFilter.selected.length ? `${models?.length ?? 0} of ${allModels?.length ?? 0} models · ` : `${models?.length ?? 0} models`}
              {providerFilter.selected.length > 0 && (
                <Link href="/settings" onClick={() => setOpen(false)} className="underline-offset-2 hover:text-foreground hover:underline">
                  filtered by provider
                </Link>
              )}
            </span>
            <button
              className="flex items-center gap-1 hover:text-foreground"
              onClick={async () => {
                const fresh = await rpc("models.list", { force: true });
                qc.setQueryData(qk.models, fresh);
              }}
            >
              <RefreshCw className="size-3" /> Refresh
            </button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
