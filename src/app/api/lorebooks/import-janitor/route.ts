import { importJanitorLorebook } from "@/lib/cards/service";
import { bootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";

/** Import a JanitorAI lorebook handed over by the userscript. Body: { data: <JanitorAI script JSON> }. */
export async function POST(req: Request) {
  await bootstrap();
  const body = (await req.json().catch(() => null)) as { data?: unknown } | null;
  if (!body?.data) return Response.json({ ok: false, error: "No lorebook data was sent." }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await importJanitorLorebook(body.data)) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 422 });
  }
}
