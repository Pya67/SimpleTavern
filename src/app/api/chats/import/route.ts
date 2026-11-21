import { importChatJson } from "@/lib/chat/export";
import { bootstrap } from "@/server/bootstrap";

export async function POST(req: Request) {
  await bootstrap();
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
    const r = await importChatJson(JSON.parse(await file.text()));
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
