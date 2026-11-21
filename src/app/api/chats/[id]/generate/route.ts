import { z } from "zod";
import { generate } from "@/lib/chat/generate";
import { bootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  mode: z.enum(["send", "regenerate", "continue", "impersonate"]),
  content: z.string().optional(),
  personaId: z.string().uuid().nullable().optional(),
  targetId: z.string().uuid().nullable().optional(),
  role: z.enum(["user", "system"]).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await bootstrap();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  const stream = generate({ chatId: id, ...parsed.data }, req.signal);
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
