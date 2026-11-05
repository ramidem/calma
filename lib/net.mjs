import { ToolError } from "./config.mjs";

export const REQUEST_TIMEOUT_MS = 30_000;

const isTimeout = (err) => err?.name === "TimeoutError" || err?.name === "AbortError";
const timeoutError = (ms = REQUEST_TIMEOUT_MS) => new ToolError("timeout", `No answer from Google within ${Math.round(ms / 1000)} seconds.`);

/** fetch with a deadline, so a stalled connection ends the command instead of hanging it. */
export async function fetchWithTimeout(fetchFn, url, init = {}, ms = REQUEST_TIMEOUT_MS) {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (err) {
    if (isTimeout(err)) throw timeoutError(ms);
    throw err;
  }
}

/**
 * The response body as JSON. The deadline set in fetchWithTimeout also covers reading the body, so a stalled body ends
 * as a "timeout" error. A body that is not JSON gives {} (callers check the fields they need), or with `strict` an error.
 */
export async function readJson(res, { strict = false } = {}) {
  try {
    return await res.json();
  } catch (err) {
    if (isTimeout(err)) throw timeoutError();
    if (strict) throw new ToolError("google_error", "Google sent a response that is not JSON.");
    return {};
  }
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}
