import "server-only";
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { messages, personas, presets, promptTemplates, settings } from "@/lib/db/schema";
import {
  DEFAULT_COMPACTION,
  DEFAULT_MODEL,
  DEFAULT_PERSONA,
  DEFAULT_PRESET_PARAMS,
  DEFAULT_TEMPLATE_BLOCKS,
  DEFAULT_UI,
  LEGACY_BLOCK_CONTENT,
  LEGACY_COMPACTION_PROMPTS,
} from "@/lib/defaults";
import type { PromptBlock } from "@/lib/types";
import { setJobHandlers, startWorkers } from "@/lib/jobs/boss";
import { runCompaction, runTitle } from "@/lib/memory/run";
import { writeScheduledBackup } from "@/lib/backup";

// Re-registered on every module evaluation so hot reloads update running workers.
setJobHandlers({
  compaction: async ({ chatId, force }) => {
    await runCompaction(chatId, { force });
  },
  "chat-title": async ({ chatId }) => {
    await runTitle(chatId);
  },
  backup: async () => {
    const name = await writeScheduledBackup();
    console.log(`[backup] wrote ${name}`);
  },
});

const g = globalThis as unknown as { __booted?: Promise<void>; __defaultsUpgrade?: Promise<void>; __defaultsVersion?: number };

/** Bump when migrations or shipped defaults change, so a running dev server applies them without a restart. */
const DEFAULTS_VERSION = 3;

export async function bootstrap() {
  await bootOnce();
  if (g.__defaultsVersion !== DEFAULTS_VERSION) {
    await (g.__defaultsUpgrade ??= migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") })
      .then(() => ensureDefaults())
      .then(() => {
        g.__defaultsVersion = DEFAULTS_VERSION;
      })
      .finally(() => {
        g.__defaultsUpgrade = undefined;
      }));
  }
}

function bootOnce() {
  return (g.__booted ??= doBootstrap().catch((e) => {
    g.__booted = undefined;
    console.error("[bootstrap] failed", e);
    throw e;
  }));
}

async function doBootstrap() {
  if (process.env.NODE_ENV === "production") {
    if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.startsWith("change-me")) console.warn("[security] AUTH_SECRET is not set — using an insecure default. Set it!");
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.startsWith("change-me")) console.warn("[security] ENCRYPTION_KEY is not set — using an insecure default. Set it!");
    if (!["1", "true", "yes"].includes((process.env.AUTH_BYPASS ?? "").toLowerCase()) && !process.env.AUTH_PASSWORD_HASH) console.warn("[security] AUTH_PASSWORD_HASH is empty — nobody can log in. Run `pnpm auth:hash`.");
  }
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await ensureDefaults();
  g.__defaultsVersion = DEFAULTS_VERSION;
  // Messages left "streaming" by a crash/restart are marked stopped so they can be continued.
  await db.update(messages).set({ status: "stopped", finishReason: "interrupted", updatedAt: sql`updated_at` }).where(eq(messages.status, "streaming"));
  await startWorkers();
  console.log("[bootstrap] ready");
}

export async function ensureDefaults() {
  let [s] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!s) {
    [s] = await db.insert(settings).values({ id: 1, compaction: DEFAULT_COMPACTION, ui: DEFAULT_UI }).returning();
  }
  const patch: Partial<typeof settings.$inferInsert> = {};

  const [anyPreset] = await db.select({ id: presets.id }).from(presets).limit(1);
  if (!anyPreset) {
    const [p] = await db.insert(presets).values({ name: "Balanced RP", modelId: DEFAULT_MODEL, params: DEFAULT_PRESET_PARAMS }).returning();
    patch.defaultPresetId = p.id;
  }
  const [anyTpl] = await db.select({ id: promptTemplates.id }).from(promptTemplates).limit(1);
  if (!anyTpl) {
    const [t] = await db.insert(promptTemplates).values({ name: "Default", blocks: DEFAULT_TEMPLATE_BLOCKS }).returning();
    patch.defaultTemplateId = t.id;
  } else {
    await upgradeTemplates();
  }
  // Upgrade compaction prompts the user never edited.
  if (s.compaction) {
    const c = { ...s.compaction };
    let changed = false;
    for (const key of ["prompt", "mergePrompt"] as const) {
      if (c[key] === LEGACY_COMPACTION_PROMPTS[key]) {
        c[key] = DEFAULT_COMPACTION[key];
        changed = true;
      }
    }
    if (changed) patch.compaction = c;
  }
  const [anyPersona] = await db.select({ id: personas.id }).from(personas).limit(1);
  if (!anyPersona) {
    const [p] = await db.insert(personas).values(DEFAULT_PERSONA).returning();
    patch.defaultPersonaId = p.id;
  }
  if (Object.keys(patch).length) await db.update(settings).set(patch).where(eq(settings.id, 1));
}

/** Replace blocks that still hold a previous version's default text with the current default. Edited blocks are left alone. */
async function upgradeTemplates() {
  const defaults = new Map(DEFAULT_TEMPLATE_BLOCKS.map((b) => [b.kind, b]));
  const all = await db.select().from(promptTemplates);
  for (const t of all) {
    let changed = false;
    const blocks = (t.blocks as PromptBlock[]).map((b) => {
      const legacy = LEGACY_BLOCK_CONTENT[b.kind];
      const def = defaults.get(b.kind);
      if (!legacy || !def || !legacy.includes(b.content)) return b;
      changed = true;
      return { ...b, content: def.content };
    });
    if (changed) await db.update(promptTemplates).set({ blocks }).where(eq(promptTemplates.id, t.id));
  }
}
