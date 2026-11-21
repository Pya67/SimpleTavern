import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { characterLorebooks, characters, lorebookEntries, lorebooks } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { parseCardFile, toCardV3, type ParsedBook } from "@/lib/cards/card";
import { b64encodeUtf8, isPng, writeTextChunks } from "@/lib/cards/png";
import { colorFor } from "@/lib/format";

async function saveAvatarFromPng(buf: Uint8Array) {
  const out = await sharp(buf).resize(512, 512, { fit: "cover", position: "top" }).webp({ quality: 88 }).toBuffer();
  const name = `${crypto.randomUUID()}.webp`;
  const dir = path.join(env.dataDir, "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), out);
  return `/api/uploads/${name}`;
}

export async function importCardFile(buf: Uint8Array, filename: string) {
  const parsed = parseCardFile(buf, filename);
  const avatar = isPng(buf) ? await saveAvatarFromPng(buf).catch(() => null) : null;
  const [c] = await db
    .insert(characters)
    .values({ ...parsed.character, avatar, tagline: parsed.character.creatorNotes.split("\n")[0]?.slice(0, 140) ?? "" })
    .returning();
  let bookId: string | null = null;
  if (parsed.book) {
    const [b] = await db
      .insert(lorebooks)
      .values({ name: parsed.book.name === "Imported lorebook" ? `${c.name}'s lore` : parsed.book.name, description: parsed.book.description, scanDepth: parsed.book.scanDepth, tokenBudget: parsed.book.tokenBudget, recursive: parsed.book.recursive })
      .returning();
    bookId = b.id;
    if (parsed.book.entries.length) await db.insert(lorebookEntries).values(parsed.book.entries.map((e) => ({ ...e, lorebookId: b.id })));
    await db.insert(characterLorebooks).values({ characterId: c.id, lorebookId: b.id });
  }
  return { id: c.id, name: c.name, spec: parsed.spec, lorebook: bookId, entries: parsed.book?.entries.length ?? 0 };
}

async function bookForCharacter(characterId: string): Promise<ParsedBook | null> {
  const links = await db.select().from(characterLorebooks).where(eq(characterLorebooks.characterId, characterId));
  if (!links.length) return null;
  const books = await db.select().from(lorebooks).where(inArray(lorebooks.id, links.map((l) => l.lorebookId)));
  const entries = await db.select().from(lorebookEntries).where(inArray(lorebookEntries.lorebookId, books.map((b) => b.id)));
  const first = books[0];
  return {
    name: books.length === 1 ? first.name : books.map((b) => b.name).join(" + "),
    description: first.description,
    scanDepth: first.scanDepth,
    tokenBudget: Math.max(...books.map((b) => b.tokenBudget)),
    recursive: books.some((b) => b.recursive),
    entries: entries.map((e) => ({
      comment: e.comment,
      keys: e.keys,
      secondaryKeys: e.secondaryKeys,
      selectiveLogic: e.selectiveLogic,
      content: e.content,
      constant: e.constant,
      position: e.position,
      depth: e.depth,
      order: e.order,
      probability: e.probability,
      caseSensitive: e.caseSensitive,
      wholeWord: e.wholeWord,
      enabled: e.enabled,
    })),
  };
}

export async function exportCharacter(id: string, format: "png" | "json") {
  const [c] = await db.select().from(characters).where(eq(characters.id, id));
  if (!c) throw new Error("Character not found");
  const book = await bookForCharacter(id);
  const cards = toCardV3(c, book);
  const safe = c.name.replace(/[^\w\- ]+/g, "").trim() || "character";
  if (format === "json") {
    return { body: new TextEncoder().encode(JSON.stringify(cards.v3, null, 2)), type: "application/json", filename: `${safe}.json` };
  }
  let base: Buffer;
  const local = c.avatar?.match(/^\/api\/uploads\/([\w-]+\.\w+)$/)?.[1];
  if (local) {
    base = await sharp(await readFile(path.join(env.dataDir, "uploads", local))).png().toBuffer();
  } else {
    const color = colorFor(c.name, c.color);
    base = await sharp({ create: { width: 512, height: 512, channels: 4, background: color } }).png().toBuffer();
  }
  const png = writeTextChunks(new Uint8Array(base), { chara: b64encodeUtf8(JSON.stringify(cards.v2)), ccv3: b64encodeUtf8(JSON.stringify(cards.v3)) });
  return { body: png, type: "image/png", filename: `${safe}.png` };
}
