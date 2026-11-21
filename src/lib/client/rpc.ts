"use client";
import type { z } from "zod";
import type { Procedures } from "@/server/procedures";
import type { Jsonify } from "@/server/rpc";

export type ProcName = keyof Procedures;
export type ProcInput<K extends ProcName> = z.input<Procedures[K]["input"]>;
export type ProcOutput<K extends ProcName> = Jsonify<Awaited<ReturnType<Procedures[K]["handler"]>>>;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function rpc<K extends ProcName>(name: K, input: ProcInput<K>): Promise<ProcOutput<K>> {
  const res = await fetch(`/api/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  if (res.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    throw new ApiError("Unauthorized", 401);
  }
  const json = await res.json().catch(() => ({ error: "Bad response" }));
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status);
  return json.data as ProcOutput<K>;
}
