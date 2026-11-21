import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://tavern:tavern@localhost:5432/tavern";

const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

export const sqlClient = globalForDb.__sql ?? postgres(url, { max: 10, prepare: true, onnotice: () => {} });
if (process.env.NODE_ENV !== "production") globalForDb.__sql = sqlClient;

export const db = drizzle(sqlClient, { schema, casing: undefined });
export type DB = typeof db;
export { schema };
