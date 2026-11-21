import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { characters, chats, memoryChunks, messages, personas, pinnedFacts } from "@/lib/db/schema";
import { getPathFull } from "@/lib/chat/tree";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rpHtml(s: string) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/(&quot;|")([^"\n]+?)("|&quot;)/g, '<q>"$2"</q>')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export async function exportChat(chatId: string, format: "md" | "json" | "html") {
  const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
  if (!chat) throw new Error("Chat not found");
  const [character] = await db.select().from(characters).where(eq(characters.id, chat.characterId));
  const ps = await db.select().from(personas);
  const pName = new Map(ps.map((p) => [p.id, p.name]));
  const safe = chat.title.replace(/[^\w\- ]+/g, "").trim() || "chat";

  if (format === "json") {
    const all = await db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt));
    const chunks = await db.select().from(memoryChunks).where(eq(memoryChunks.chatId, chatId));
    const facts = await db.select().from(pinnedFacts).where(eq(pinnedFacts.chatId, chatId));
    const body = {
      format: "sussy-tavern-chat",
      version: 1,
      exportedAt: new Date().toISOString(),
      chat: { title: chat.title, activeRootId: chat.activeRootId, authorsNote: chat.authorsNote, authorsNoteDepth: chat.authorsNoteDepth, createdAt: chat.createdAt },
      character: { name: character.name },
      personas: Object.fromEntries(ps.map((p) => [p.id, p.name])),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      messages: all.map(({ search, ...m }) => m),
      memory: chunks,
      facts,
    };
    return { body: JSON.stringify(body, null, 2), type: "application/json", filename: `${safe}.json` };
  }

  const path = await getPathFull(chatId);
  const who = (m: (typeof path)[number]) => (m.role === "assistant" ? character.name : m.role === "system" ? "Narrator" : (m.personaId && pName.get(m.personaId)) || "You");

  if (format === "md") {
    const lines = [`# ${chat.title}`, ``, `*${character.name} · exported ${new Date().toLocaleString()}*`, ``];
    for (const m of path) {
      if (m.hidden) continue;
      lines.push(`### ${who(m)}`, ``, m.content.trim(), ``);
    }
    return { body: lines.join("\n"), type: "text/markdown; charset=utf-8", filename: `${safe}.md` };
  }

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(chat.title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fbf8f3;--fg:#2a241d;--muted:#7a6f63;--card:#fff;--q:#9a5b00;--b:#e8e1d6}
@media (prefers-color-scheme:dark){:root{--bg:#1c1916;--fg:#ece7df;--muted:#a59a8c;--card:#25211d;--q:#f0c36d;--b:#3a332c}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 Georgia,serif}
main{max-width:760px;margin:0 auto;padding:48px 20px}
h1{font:600 28px/1.2 system-ui,sans-serif;margin:0 0 4px}.sub{color:var(--muted);font:14px system-ui,sans-serif;margin-bottom:32px}
.m{background:var(--card);border:1px solid var(--b);border-radius:16px;padding:14px 18px;margin:14px 0}
.m.user{background:transparent}.n{font:600 13px system-ui,sans-serif;margin-bottom:4px}
em{color:var(--muted)}q{quotes:none;color:var(--q)}p{margin:0 0 .7em}p:last-child{margin:0}
</style></head><body><main><h1>${esc(chat.title)}</h1><div class="sub">${esc(character.name)} · ${path.length} messages · exported ${new Date().toLocaleDateString()}</div>
${path
  .filter((m) => !m.hidden)
  .map((m) => `<div class="m ${m.role}"><div class="n">${esc(who(m))}</div>${rpHtml(m.content)}</div>`)
  .join("\n")}
</main></body></html>`;
  return { body: html, type: "text/html; charset=utf-8", filename: `${safe}.html` };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function importChatJson(data: any) {
  if (data?.format !== "sussy-tavern-chat") throw new Error("Not a Sussy Tavern chat export");
  let [character] = await db.select().from(characters).where(eq(characters.name, data.character?.name ?? ""));
  if (!character) [character] = await db.insert(characters).values({ name: data.character?.name || "Imported character" }).returning();
  const [chat] = await db
    .insert(chats)
    .values({ characterId: character.id, title: `${data.chat?.title ?? "Imported chat"}`, authorsNote: data.chat?.authorsNote ?? "", authorsNoteDepth: data.chat?.authorsNoteDepth ?? 4 })
    .returning();
  const idMap = new Map<string, string>();
  for (const m of data.messages ?? []) idMap.set(m.id, crypto.randomUUID());
  const existingPersonas = new Set((await db.select({ id: personas.id }).from(personas)).map((p) => p.id));
  // Parents first.
  const msgs = [...(data.messages ?? [])];
  const inserted = new Set<string>();
  let guard = 0;
  while (msgs.length && guard++ < 100000) {
    const m = msgs.shift();
    if (m.parentId && !inserted.has(m.parentId) && idMap.has(m.parentId)) {
      msgs.push(m);
      continue;
    }
    await db.insert(messages).values({
      id: idMap.get(m.id)!,
      chatId: chat.id,
      parentId: m.parentId ? (idMap.get(m.parentId) ?? null) : null,
      activeChildId: m.activeChildId ? (idMap.get(m.activeChildId) ?? null) : null,
      role: m.role,
      personaId: m.personaId && existingPersonas.has(m.personaId) ? m.personaId : null,
      characterId: m.role === "assistant" ? character.id : null,
      content: m.content ?? "",
      reasoning: m.reasoning ?? null,
      status: m.status === "streaming" ? "stopped" : (m.status ?? "complete"),
      error: m.error ?? null,
      modelId: m.modelId ?? null,
      promptTokens: m.promptTokens ?? null,
      completionTokens: m.completionTokens ?? null,
      cost: m.cost ?? null,
      bookmarked: !!m.bookmarked,
      hidden: !!m.hidden,
      createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
      updatedAt: m.updatedAt ? new Date(m.updatedAt) : new Date(),
    });
    inserted.add(m.id);
  }
  const root = data.chat?.activeRootId ? idMap.get(data.chat.activeRootId) : null;
  await db.update(chats).set({ activeRootId: root ?? null }).where(eq(chats.id, chat.id));
  for (const c of data.memory ?? []) {
    if (!c.messageIds?.every((id: string) => idMap.has(id))) continue;
    await db.insert(memoryChunks).values({ chatId: chat.id, level: c.level, messageIds: c.messageIds.map((id: string) => idMap.get(id)!), content: c.content, tokenCount: c.tokenCount ?? 0, userEdited: !!c.userEdited, createdAt: new Date(c.createdAt ?? Date.now()) });
  }
  for (const f of data.facts ?? []) await db.insert(pinnedFacts).values({ chatId: chat.id, content: f.content, suggested: !!f.suggested, sort: f.sort ?? 0 });
  return { id: chat.id };
}
