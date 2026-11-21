import { exportChat } from "@/lib/chat/export";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = new URL(req.url).searchParams.get("format");
  const format = f === "json" || f === "html" ? f : "md";
  try {
    const out = await exportChat(id, format);
    return new Response(out.body, { headers: { "content-type": out.type, "content-disposition": `attachment; filename="${encodeURIComponent(out.filename)}"` } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
