import { describe, expect, it } from "vitest";
import { applyMacros } from "@/lib/prompt/macros";

describe("applyMacros", () => {
  const ctx = { char: "Mira", user: "Traveler", random: () => 0, now: new Date("2026-11-20T18:30:00") };

  it("replaces char/user (case-insensitive, with spaces)", () => {
    expect(applyMacros("{{char}} greets {{ USER }}.", ctx)).toBe("Mira greets Traveler.");
  });
  it("supports random and roll", () => {
    expect(applyMacros("{{random:a,b,c}}", ctx)).toBe("a");
    expect(applyMacros("{{roll:2d6+1}}", ctx)).toBe("3");
  });
  it("leaves unknown macros untouched", () => {
    expect(applyMacros("{{nope}}", ctx)).toBe("{{nope}}");
  });
  it("formats idle duration", () => {
    const r = applyMacros("{{idle_duration}}", { ...ctx, lastMessageAt: new Date("2026-11-20T16:30:00") });
    expect(r).toBe("2 hours");
  });
});
