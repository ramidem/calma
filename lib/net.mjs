import { ToolError } from "./config.mjs";

export const REQUEST_TIMEOUT_MS = 30_000;

/** fetch with a deadline, so a stalled connection ends the command instead of hanging it. */
export async function fetchWithTimeout(fetchFn, url, init = {}, ms = REQUEST_TIMEOUT_MS) {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new ToolError("timeout", `No answer from Google within ${Math.round(ms / 1000)} seconds.`);
    throw err;
  }
}
