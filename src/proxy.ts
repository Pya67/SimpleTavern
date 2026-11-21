import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

const PUBLIC = ["/login", "/api/auth/login", "/api/auth/status", "/manifest.webmanifest", "/sw.js", "/offline.html", "/icons"];

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
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\.(?:png|svg|ico|webp|jpg)$).*)"],
};
