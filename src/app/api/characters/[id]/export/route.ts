import { exportCharacter } from "@/lib/cards/service";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "png";
  try {
    const out = await exportCharacter(id, format);
    return new Response(new Uint8Array(out.body), {
      headers: { "content-type": out.type, "content-disposition": `attachment; filename="${encodeURIComponent(out.filename)}"` },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
