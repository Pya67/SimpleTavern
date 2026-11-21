import { describe, expect, it } from "vitest";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText } from "ai";
import { mockFetch } from "@/lib/llm/mock";
import { mapError } from "@/lib/llm/errors";

const or = createOpenRouter({ apiKey: "mock", baseURL: "http://mock.local/api/v1", fetch: mockFetch });

describe("mock OpenRouter through the real provider", () => {
  it("streams text, reasoning and usage/cost via the AI SDK", async () => {
    const r = streamText({
      model: or.chat("mock/tavern-flash"),
      messages: [
        { role: "system", content: "You are Mira in a roleplay." },
        { role: "user", content: "Tell me about the lantern." },
      ],
      allowSystemInMessages: true,
      providerOptions: { openrouter: { reasoning: { enabled: true }, usage: { include: true } } },
    });
    let text = "";
    let reasoning = "";
    for await (const p of r.stream) {
      if (p.type === "text-delta") text += p.text;
      if (p.type === "reasoning-delta") reasoning += p.text;
    }
    expect(text.length).toBeGreaterThan(20);
    expect(reasoning).toContain("Mira");
    const meta = (await r.providerMetadata) as { openrouter?: { usage?: { cost?: number } } };
    expect(meta?.openrouter?.usage?.cost).toBeGreaterThan(0);
  }, 30_000);

  it("surfaces HTTP errors that map to friendly codes", async () => {
    const r = streamText({ model: or.chat("mock/tavern-flash"), messages: [{ role: "user", content: "/mock-error 429" }], maxRetries: 0 });
    let err: unknown = null;
    try {
      for await (const p of r.stream) if (p.type === "error") throw p.error;
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect(mapError(err).code).toBe("rate_limit");
  }, 30_000);
});
