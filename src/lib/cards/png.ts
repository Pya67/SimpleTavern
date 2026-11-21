/** Minimal PNG tEXt chunk reader/writer (no dependencies). */

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(buf: Uint8Array) {
  return buf.length > 8 && SIG.every((b, i) => buf[i] === b);
}

interface Chunk {
  type: string;
  data: Uint8Array;
}

export function readChunks(buf: Uint8Array): Chunk[] {
  if (!isPng(buf)) throw new Error("Not a PNG file");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const chunks: Chunk[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...buf.subarray(off + 4, off + 8));
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data });
    off += 12 + len;
    if (type === "IEND") break;
  }
  return chunks;
}

export function readTextChunks(buf: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of readChunks(buf)) {
    if (c.type !== "tEXt") continue;
    const nul = c.data.indexOf(0);
    if (nul < 0) continue;
    const key = new TextDecoder("latin1").decode(c.data.subarray(0, nul));
    out[key] = new TextDecoder("latin1").decode(c.data.subarray(nul + 1));
  }
  return out;
}

function encodeChunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Returns a new PNG with the given tEXt entries (replacing existing ones with the same keys). */
export function writeTextChunks(buf: Uint8Array, entries: Record<string, string>): Uint8Array {
  const chunks = readChunks(buf).filter((c) => {
    if (c.type !== "tEXt") return true;
    const nul = c.data.indexOf(0);
    const key = new TextDecoder("latin1").decode(c.data.subarray(0, nul));
    return !(key in entries);
  });
  const parts: Uint8Array[] = [new Uint8Array(SIG)];
  for (const c of chunks) {
    if (c.type === "IEND") {
      for (const [k, v] of Object.entries(entries)) {
        const kb = new TextEncoder().encode(k);
        // Values are base64 (ASCII), so latin1 encoding is safe.
        const vb = Uint8Array.from(v, (ch) => ch.charCodeAt(0) & 0xff);
        const data = new Uint8Array(kb.length + 1 + vb.length);
        data.set(kb, 0);
        data.set(vb, kb.length + 1);
        parts.push(encodeChunk("tEXt", data));
      }
    }
    parts.push(encodeChunk(c.type, c.data));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function b64encodeUtf8(s: string) {
  return Buffer.from(s, "utf8").toString("base64");
}
export function b64decodeUtf8(s: string) {
  return Buffer.from(s, "base64").toString("utf8");
}
