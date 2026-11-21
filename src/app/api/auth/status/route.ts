import { env } from "@/lib/env";

export async function GET() {
  return Response.json({ bypass: env.authBypass, configured: !!env.authPasswordHash });
}
