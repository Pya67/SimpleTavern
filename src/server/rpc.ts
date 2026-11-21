import type { z } from "zod";

export interface Procedure<I extends z.ZodType = z.ZodType, O = unknown> {
  input: I;
  handler: (input: z.infer<I>) => Promise<O>;
}

export function proc<I extends z.ZodType, O>(input: I, handler: (input: z.infer<I>) => Promise<O>): Procedure<I, O> {
  return { input, handler };
}

/** JSON round-trip type (Dates become strings). */
export type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

export class RpcError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
