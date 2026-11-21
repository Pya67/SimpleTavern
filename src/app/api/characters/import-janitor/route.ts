import { importJanitorData } from "@/lib/cards/service";
import { bootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";

/** Import a JanitorAI character handed over by the userscript. Body: { data: <JanitorAI character JSON> }. */
export async function POST(req: Request) {
  await bootstrap();
  const body = (await req.json().catch(() => null)) as { data?: unknown } | null;
  if (!body?.data) return Response.json({ ok: false, error: "No character data was sent." }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await importJanitorData(body.data)) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 422 });
  }
}
