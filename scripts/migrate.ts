import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "postgres://tavern:tavern@localhost:5432/tavern", { max: 1, onnotice: () => {} });
migrate(drizzle(sql), { migrationsFolder: "./drizzle" })
  .then(() => console.log("Migrations applied"))
  .finally(() => sql.end());
