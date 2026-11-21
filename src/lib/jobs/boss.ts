import "server-only";
import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";

export type JobName = "compaction" | "chat-title" | "backup";
type Handler = (data: { chatId: string; force?: boolean }) => Promise<void>;

const g = globalThis as unknown as {
  __boss?: Promise<PgBoss | null>;
  __bossWorkers?: boolean;
  /** Handlers live on globalThis so dev hot-reloads swap in fresh code for running workers. */
  __jobHandlers?: Partial<Record<JobName, Handler>>;
};
const handlers = (g.__jobHandlers ??= {});

async function create(): Promise<PgBoss | null> {
  try {
    const boss = new PgBoss({ connectionString: env.databaseUrl, schema: "pgboss" });
    boss.on("error", (e) => console.error("[jobs]", e));
    await boss.start();
    for (const q of ["compaction", "chat-title", "backup"] as JobName[]) {
      await boss.createQueue(q, { policy: "stately" }).catch(() => {});
    }
    // Nightly backup at 04:00 server time.
    await boss.schedule("backup", "0 4 * * *", { chatId: "" }).catch((e) => console.error("[jobs] schedule failed", e));
    return boss;
  } catch (e) {
    console.error("[jobs] failed to start pg-boss; running jobs inline", e);
    return null;
  }
}

export function getBoss() {
  return (g.__boss ??= create());
}

/** Update the handler registry (cheap, call on every module load). */
export function setJobHandlers(map: Record<JobName, Handler>) {
  Object.assign(handlers, map);
}

export async function startWorkers() {
  const boss = await getBoss();
  if (!boss || g.__bossWorkers) return;
  g.__bossWorkers = true;
  for (const name of ["compaction", "chat-title", "backup"] as JobName[]) {
    await boss.work<{ chatId: string; force?: boolean }>(name, { batchSize: 1, pollingIntervalSeconds: 0.5 }, async (jobs) => {
      for (const job of jobs) {
        try {
          await g.__jobHandlers?.[name]?.(job.data);
        } catch (e) {
          console.error(`[jobs:${name}]`, e);
          throw e;
        }
      }
    });
  }
}

export async function enqueue(name: JobName, data: { chatId: string; force?: boolean }, singletonKey?: string) {
  const boss = await getBoss();
  if (!boss) {
    void g.__jobHandlers?.[name]?.(data).catch((e) => console.error(`[jobs:${name}]`, e));
    return;
  }
  await boss.send(name, data, { singletonKey, retryLimit: 2, retryDelay: 5 });
}
