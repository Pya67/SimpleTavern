import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { procedures } from "@/server/procedures";
import { RpcError } from "@/server/rpc";
import { bootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const p = (procedures as Record<string, { input: { parse: (v: unknown) => unknown }; handler: (i: unknown) => Promise<unknown> }>)[name];
  if (!p) return NextResponse.json({ error: `Unknown procedure ${name}` }, { status: 404 });
  try {
    await bootstrap();
    const body = await req.json().catch(() => ({}));
    const input = p.input.parse(body);
    const out = await p.handler(input);
    return NextResponse.json({ data: out ?? null });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input", issues: e.issues }, { status: 400 });
    if (e instanceof RpcError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(`[rpc:${name}]`, e);
    return NextResponse.json({ error: (e as Error).message ?? "Server error" }, { status: 500 });
  }
}
