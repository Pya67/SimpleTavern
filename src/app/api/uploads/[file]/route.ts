import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[\w-]+\.(webp|png|jpg|jpeg)$/i.test(file)) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(path.join(env.dataDir, "uploads", file));
    const type = file.endsWith(".png") ? "image/png" : file.match(/jpe?g$/) ? "image/jpeg" : "image/webp";
    return new Response(new Uint8Array(data), { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
