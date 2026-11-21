import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "st_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(secret: string) {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(key(secret));
}

export async function verifySessionToken(token: string | undefined, secret: string) {
  if (!token) return false;
  try {
    await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_S,
  secure: process.env.NODE_ENV === "production",
};
