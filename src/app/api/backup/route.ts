import { createBackup, restoreBackup } from "@/lib/backup";
import { bootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  await bootstrap();
  const b = await createBackup();
  return new Response(JSON.stringify(b), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="simple-tavern-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

export async function POST(req: Request) {
  await bootstrap();
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
    await restoreBackup(JSON.parse(await file.text()));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
