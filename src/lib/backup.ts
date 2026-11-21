import "server-only";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { env } from "@/lib/env";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Insert order respects foreign keys; deletion uses the reverse.
const TABLES = [
  ["personas", t.personas],
  ["presets", t.presets],
  ["promptTemplates", t.promptTemplates],
  ["characters", t.characters],
  ["lorebooks", t.lorebooks],
  ["lorebookEntries", t.lorebookEntries],
  ["characterLorebooks", t.characterLorebooks],
  ["directories", t.directories],
  ["chats", t.chats],
  ["chatLorebooks", t.chatLorebooks],
  ["messages", t.messages],
  ["memoryChunks", t.memoryChunks],
  ["pinnedFacts", t.pinnedFacts],
  ["settings", t.settings],
] as const;

const DATE_KEYS = new Set(["createdAt", "updatedAt", "lastMessageAt"]);

export async function createBackup() {
  const tables: Record<string, any[]> = {};
  for (const [name, table] of TABLES) {
    const rows = await db.select().from(table as any);
    tables[name] = rows.map((r: any) => {
      const { search, ...rest } = r;
      void search;
      if (name === "settings") rest.openrouterKeyEnc = null; // never export secrets
      return rest;
    });
  }
  const uploads: Record<string, string> = {};
  const dir = path.join(env.dataDir, "uploads");
  try {
    for (const f of await readdir(dir)) uploads[f] = (await readFile(path.join(dir, f))).toString("base64");
  } catch {}
  return { format: "simple-tavern-backup", version: 1, createdAt: new Date().toISOString(), tables, uploads };
}

function revive(row: any) {
  const out: any = {};
  for (const [k, v] of Object.entries(row)) out[k] = DATE_KEYS.has(k) && typeof v === "string" ? new Date(v) : v;
  return out;
}

export async function restoreBackup(data: any) {
  if (data?.format !== "simple-tavern-backup" && data?.format !== "sussy-tavern-backup") throw new Error("Not a SimpleTavern backup file");
  const keyRow = await db.select({ k: t.settings.openrouterKeyEnc }).from(t.settings);
  await db.transaction(async (tx) => {
    for (const [, table] of [...TABLES].reverse()) await tx.delete(table as any);
    for (const [name, table] of TABLES) {
      let rows: any[] = (data.tables?.[name] ?? []).map(revive);
      if (!rows.length) continue;
      if (name === "messages") {
        // Parents before children.
        const byId = new Map(rows.map((r) => [r.id, r]));
        const depth = (r: any): number => {
          let d = 0;
          let cur = r;
          while (cur?.parentId && d < 100000) {
            cur = byId.get(cur.parentId);
            d++;
          }
          return d;
        };
        rows = rows.map((r) => [depth(r), r] as const).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
      }
      if (name === "settings") rows = rows.map((r) => ({ ...r, openrouterKeyEnc: keyRow[0]?.k ?? null }));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(table as any).values(rows.slice(i, i + 500));
    }
  });
  const dir = path.join(env.dataDir, "uploads");
  await mkdir(dir, { recursive: true });
  for (const [name, b64] of Object.entries<string>(data.uploads ?? {})) {
    if (/^[\w-]+\.(webp|png|jpe?g)$/i.test(name)) await writeFile(path.join(dir, name), Buffer.from(b64, "base64"));
  }
}

export async function writeScheduledBackup(keep = 7) {
  const dir = path.join(env.dataDir, "backups");
  await mkdir(dir, { recursive: true });
  const b = await createBackup();
  const name = `backup-${new Date().toISOString().slice(0, 10)}.json`;
  await writeFile(path.join(dir, name), JSON.stringify(b));
  const files = (await readdir(dir)).filter((f) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) await unlink(path.join(dir, old));
  return name;
}

export async function listScheduledBackups() {
  const dir = path.join(env.dataDir, "backups");
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).sort().reverse();
  } catch {
    return [];
  }
}
