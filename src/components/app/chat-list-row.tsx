"use client";
import Link from "next/link";
import { Pin } from "lucide-react";
import { cn } from "cn";
import { EntityAvatar } from "@/components/common/avatar";
import type { ChatListItem } from "@/lib/client/queries";
import { relativeTime } from "@/lib/format";

/** One chat in a list: avatar, title, character and when it was last edited. */
export function ChatListRow({ chat, showCharacter = true, className }: { chat: ChatListItem; showCharacter?: boolean; className?: string }) {
  return (
    <Link href={`/chats/${chat.id}`} className={cn("flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent", className)}>
      {showCharacter && <EntityAvatar name={chat.characterName} src={chat.characterAvatar} color={chat.characterColor} size={32} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {chat.pinned && <Pin className="size-3 shrink-0 text-brand" aria-label="Pinned" />}
          <span className="truncate text-sm font-medium">{chat.title}</span>
        </div>
        {showCharacter && <div className="truncate text-xs text-muted-foreground">{chat.characterName}</div>}
      </div>
      <time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(chat.editedAt).toISOString()} title={`Edited ${new Date(chat.editedAt).toLocaleString()}`}>
        {relativeTime(chat.editedAt)}
      </time>
    </Link>
  );
}

export const byEdited = (a: ChatListItem, b: ChatListItem) => new Date(b.editedAt).getTime() - new Date(a.editedAt).getTime();
