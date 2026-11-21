import { importCardFile } from "@/lib/cards/service";
import { bootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await bootstrap();
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "No files" }, { status: 400 });
  const results: ({ ok: true; id: string; name: string; spec: string; entries: number } | { ok: false; file: string; error: string })[] = [];
  for (const f of files) {
    try {
      const r = await importCardFile(new Uint8Array(await f.arrayBuffer()), f.name);
      results.push({ ok: true, ...r });
    } catch (e) {
      results.push({ ok: false, file: f.name, error: (e as Error).message });
    }
  }
  return Response.json({ results });
}
