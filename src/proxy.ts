import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

// The userscript is public so userscript managers can fetch it to install; it holds no secrets.
const PUBLIC = ["/login", "/api/auth/login", "/api/auth/status", "/manifest.webmanifest", "/sw.js", "/offline.html", "/icons", "/simple-tavern-janitor.user.js"];

export async function proxy(req: NextRequest) {
  const bypass = ["1", "true", "yes"].includes((process.env.AUTH_BYPASS ?? "").toLowerCase());
  if (bypass) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();

  const ok = await verifySessionToken(
    req.cookies.get(SESSION_COOKIE)?.value,
    process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me-please-0000",
  );
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  // Keep the query too (e.g. /characters?import=janitor from the userscript survives logging in).
  const back = pathname + req.nextUrl.search;
  url.search = back === "/" ? "" : `?next=${encodeURIComponent(back)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\.(?:png|svg|ico|webp|jpg)$).*)"],
};
