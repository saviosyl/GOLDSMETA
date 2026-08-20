/**
 * Bound every external broker/read operation so one slow cTrader call
 * cannot stall a FAST scan for minutes.
 */

export class BoundedOpTimeoutError extends Error {
  readonly op: string;
  readonly timeoutMs: number;
  constructor(op: string, timeoutMs: number) {
    super(`${op}_TIMEOUT`);
    this.name = "BoundedOpTimeoutError";
    this.op = op;
    this.timeoutMs = timeoutMs;
  }
}

export async function withBoundedOp<T>(
  op: string,
  timeoutMs: number,
  work: () => Promise<T>
): Promise<T> {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new BoundedOpTimeoutError(op, ms)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isBoundedOpTimeout(error: unknown): error is BoundedOpTimeoutError {
  return error instanceof BoundedOpTimeoutError;
}
