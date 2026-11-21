"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkX, BookOpen, CornerDownRight, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EntityAvatar } from "@/components/common/avatar";
import { jumpToMessage, useChat } from "@/components/chat/chat-store";
import { rpc } from "@/lib/client/rpc";
import type { PersonaT } from "@/lib/client/queries";

interface CharacterLite {
  name: string;
  avatar?: string | null;
  color?: string | null;
}

/** All bookmarked messages of this chat (current branch), with a jump to each. */
export function BookmarksDialog({
  chatId,
  character,
  personas,
  open,
  onOpenChange,
}: {
  chatId: string;
  character: CharacterLite | undefined;
  personas: PersonaT[] | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const key = ["bookmarks", chatId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => rpc("chats.bookmarks", { id: chatId }),
    enabled: open,
    staleTime: 0,
  });

  const jump = (id: string) => {
    onOpenChange(false);
    void jumpToMessage(id);
  };
  const unbookmark = async (id: string) => {
    qc.setQueryData<typeof data>(key, (old) => old?.filter((b) => b.id !== id));
    useChat.setState((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, bookmarked: false } : m)),
    }));
    await rpc("messages.update", { id, bookmarked: false });
    void qc.invalidateQueries({ queryKey: key });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 shadow-2xl ring-transparent sm:max-w-xl">
        <div className="grain rounded-xl">
          <DialogHeader className="px-5 pb-2 pt-4">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <BookOpen className="size-4 text-brand" /> Bookmarks
              {!!data?.length && <span className="font-normal tabular-nums text-muted-foreground">{data.length}</span>}
            </DialogTitle>
            <DialogDescription className="text-xs">Messages you bookmarked in this chat.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(60vh,520px)] overflow-y-auto px-3 pb-3 pt-1">
            {isLoading ? (
              <div className="space-y-1.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="surface-well h-16 animate-pulse rounded-xl" />
                ))}
              </div>
            ) : !data?.length ? (
              <div className="surface-well flex flex-col items-center gap-2 rounded-xl px-6 py-10 text-center text-sm text-muted-foreground">
                <BookOpen className="size-6 opacity-50" />
                No bookmarks yet. Use the bookmark button on any message to keep it here.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {data.map((b) => {
                  const persona = b.personaId ? personas?.find((p) => p.id === b.personaId) : null;
                  const name = b.role === "user" ? (persona?.name ?? "You") : b.role === "system" ? "Narrator" : (character?.name ?? "Character");
                  return (
                    <li key={b.id} className="surface-well group/bm flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-foreground/8">
                      <button onClick={() => jump(b.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-label={`Jump to ${name}'s message #${b.depth + 1}`}>
                        {b.role === "system" ? (
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--avatar-radius,9999px)] bg-muted text-muted-foreground">
                            <Megaphone className="size-3.5" />
                          </span>
                        ) : b.role === "user" ? (
                          <EntityAvatar name={name} src={persona?.avatar} color={persona?.color} size={32} />
                        ) : (
                          <EntityAvatar name={name} src={character?.avatar} color={character?.color} size={32} />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-semibold">{name}</span>
                            <span className="text-[11px] tabular-nums text-muted-foreground">#{b.depth + 1}</span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{b.snippet.replace(/[*_]/g, "").replace(/\s+/g, " ").trim() || "(empty)"}</p>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1 self-center">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => void unbookmark(b.id)}
                                aria-label="Remove bookmark"
                                className="text-muted-foreground opacity-0 transition-opacity group-hover/bm:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
                              />
                            }
                          >
                            <BookmarkX />
                          </TooltipTrigger>
                          <TooltipContent>Remove bookmark</TooltipContent>
                        </Tooltip>
                        <Button size="sm" variant="secondary" onClick={() => jump(b.id)} className="gap-1.5">
                          <CornerDownRight /> Jump
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
