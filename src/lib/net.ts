import { ToolError } from "./config.ts";
import type { FetchInit, FetchLike, FetchResponse } from "./types.ts";

export const REQUEST_TIMEOUT_MS = 30_000;

const isTimeout = (err: unknown) => {
  if (typeof err !== "object" || err === null || !("name" in err)) return false;
  const name = (err as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
};
const timeoutError = (ms = REQUEST_TIMEOUT_MS) => new ToolError("timeout", `No answer from Google within ${Math.round(ms / 1000)} seconds.`);

/** fetch with a deadline, so a stalled connection ends the command instead of hanging it. */
export async function fetchWithTimeout(fetchFn: FetchLike, url: string | URL, init: Omit<FetchInit, "signal"> = { headers: {} }, ms = REQUEST_TIMEOUT_MS): Promise<FetchResponse> {
  try {
    // The cast matches FetchLike. The object is the same fields the caller passed, plus the deadline signal.
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(ms) } as FetchInit);
  } catch (err) {
    if (isTimeout(err)) throw timeoutError(ms);
    throw err;
  }
}

/**
 * The response body as JSON. The deadline set in fetchWithTimeout also covers reading the body, so a stalled body ends
 * as a "timeout" error. A body that is not JSON gives {} (callers check the fields they need), or with `strict` an error.
 */
export async function readJson(res: { json: () => Promise<unknown> }, { strict = false }: { strict?: boolean } = {}): Promise<unknown> {
  try {
    return await res.json();
  } catch (err) {
    if (isTimeout(err)) throw timeoutError();
    if (strict) throw new ToolError("google_error", "Google sent a response that is not JSON.");
    return {};
  }
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => R | Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  }));
  return out;
}
