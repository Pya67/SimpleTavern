import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Accepts an image (multipart field "file"), optional crop (x,y,size in source px), stores a 512px webp. */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return Response.json({ error: "File too large (max 15 MB)" }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  let img = sharp(buf, { animated: false }).rotate();
  const crop = form.get("crop");
  if (typeof crop === "string" && crop) {
    const c = JSON.parse(crop) as { x: number; y: number; width: number; height: number };
    img = img.extract({ left: Math.round(c.x), top: Math.round(c.y), width: Math.max(1, Math.round(c.width)), height: Math.max(1, Math.round(c.height)) });
  }
  const out = await img.resize(512, 512, { fit: "cover" }).webp({ quality: 88 }).toBuffer();
  const name = `${crypto.randomUUID()}.webp`;
  const dir = path.join(env.dataDir, "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), out);
  return Response.json({ url: `/api/uploads/${name}` });
}
