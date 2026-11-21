import { NextResponse } from "next/server";
import { verify } from "@node-rs/argon2";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { env } from "@/lib/env";

const attempts = new Map<string, { n: number; at: number }>();

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const a = attempts.get(ip);
  if (a && a.n >= 8 && Date.now() - a.at < 5 * 60_000) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!env.authPasswordHash) {
    return NextResponse.json({ error: "No password configured. Set AUTH_PASSWORD_HASH (see README) or AUTH_BYPASS=true." }, { status: 500 });
  }
  const ok = !!password && (await verify(env.authPasswordHash, password).catch(() => false));
  if (!ok) {
    attempts.set(ip, { n: (a?.n ?? 0) + 1, at: Date.now() });
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  attempts.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(env.authSecret), sessionCookieOptions);
  return res;
}
