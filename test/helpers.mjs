import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveToken } from "../lib/config.mjs";

export const SCOPE = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly";

/** A throwaway config folder with a client.json (fake values) and optionally a token for `personal`. */
export function sandbox({ token = true, expiresAt = Date.now() + 3_600_000 } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), "ro-mail-")), "cfg");
  const env = { CALMA_DIR: dir };
  // The folder is created by saveToken/ensureConfigDir when a token is written; create it for client.json otherwise.
  saveToken("personal", { account: "personal", scope: SCOPE, access_token: "FAKE-ACCESS", refresh_token: "FAKE-REFRESH", expires_at: token ? expiresAt : 0 }, env);
  const client = join(dir, "client.json");
  writeFileSync(client, JSON.stringify({ installed: { client_id: "fake-id", client_secret: "fake-secret" } }));
  chmodSync(client, 0o600);
  return { dir, env };
}

export const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

/**
 * Plays the browser's part of a sign-in: calls the loopback callback URL after `delayMs`. The returned promise never
 * rejects and the body is read, so nothing is left running (or unhandled) when the test ends; await it before finishing.
 */
export function visit(url, delayMs = 20) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
    .then(() => fetch(url))
    .then(async (res) => (await res.text(), res.status))
    .catch(() => null);
}
