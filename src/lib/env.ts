import "server-only";

function bool(v: string | undefined, fallback = false) {
  if (v == null || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

/** Accepts `b64:<base64 of the argon2 hash>` (recommended) or a raw hash. */
function passwordHash(v: string | undefined) {
  if (!v) return "";
  if (v.startsWith("b64:")) return Buffer.from(v.slice(4), "base64").toString("utf8");
  return v;
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://tavern:tavern@localhost:5432/tavern",
  authBypass: bool(process.env.AUTH_BYPASS),
  authPasswordHash: passwordHash(process.env.AUTH_PASSWORD_HASH),
  authSecret: process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me-please-0000",
  openrouterKey: process.env.OPENROUTER_API_KEY ?? "",
  openrouterMock: bool(process.env.OPENROUTER_MOCK, true),
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  encryptionKey: process.env.ENCRYPTION_KEY ?? "dev-insecure-encryption-key-change-me",
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  dataDir: process.env.DATA_DIR ?? "./data",
};
