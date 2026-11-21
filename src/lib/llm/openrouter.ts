import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { mockFetch } from "@/lib/llm/mock";

export async function getApiKey() {
  const [row] = await db.select({ k: settings.openrouterKeyEnc }).from(settings).where(eq(settings.id, 1));
  if (row?.k) {
    try {
      return decrypt(row.k);
    } catch {
      /* fallthrough */
    }
  }
  return env.openrouterKey;
}

export function isMock() {
  return env.openrouterMock;
}

/** fetch used for raw OpenRouter REST calls (models, key). */
export function orFetch(): typeof fetch {
  return isMock() ? mockFetch : fetch;
}

export function baseUrl() {
  return isMock() ? "http://mock.openrouter.local/api/v1" : env.openrouterBaseUrl;
}

export async function getProvider() {
  const apiKey = isMock() ? "mock-key" : await getApiKey();
  if (!apiKey) {
    const e = new Error("No OpenRouter API key configured. Add one in Settings.");
    (e as Error & { code?: string }).code = "no_key";
    throw e;
  }
  return createOpenRouter({
    apiKey,
    baseURL: baseUrl(),
    fetch: isMock() ? mockFetch : undefined,
    // Generic attribution; never send personal details.
    appName: "SimpleTavern",
    appUrl: "https://github.com/",
  });
}
