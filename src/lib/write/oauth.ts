// Sign-in and token refresh for the write side. Same loopback flow as `calma auth`, but it asks for calendar.events (plus
// identity, to learn the address) and saves to the separate write token store. A sign-in is refused, and its grant
// revoked at Google, if the address is not on the allow-list in write.json or Google granted any other scope.
import { normalizeEmail } from "../accounts.ts";
import { openUrl } from "../browser.ts";
import { ToolError, loadClient } from "../config.ts";
import { listenForCallback, newPkce } from "../loopback.ts";
import { fetchWithTimeout, readJson } from "../net.ts";
import { revokeToken, tokenRequest } from "../oauth.ts";
import { asRec } from "../record.ts";
import type { FetchLike, IoDeps } from "../types.ts";
import { loadPolicy } from "./policy.ts";
import { REQUESTED_WRITE_SCOPES, assertWriteScopes } from "./scopes.ts";
import { loadWriteToken, saveWriteToken } from "./tokens.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

type TokenDeps = {
  fetchFn?: FetchLike;
  env?: IoDeps["env"];
  now?: () => number;
};

export function buildWriteAuthUrl({ clientId, redirectUri, state, challenge }: { clientId: string; redirectUri: string; state: string; challenge: string }) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: REQUESTED_WRITE_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent select_account",
  }).toString();
  return u.toString();
}

/** A valid access token for a write account, refreshed (and saved) when it is about to expire. */
export async function accessWriteToken(email: string, { fetchFn = fetch, env = process.env, now = () => Date.now() }: TokenDeps = {}): Promise<string> {
  const tok = loadWriteToken(email, env);
  assertWriteScopes(tok.scope);
  if (tok.access_token && tok.expires_at && tok.expires_at - 60_000 > now()) return tok.access_token;
  if (!tok.refresh_token) throw new ToolError("reauth_needed", "No refresh token for this account. Run: calma-write auth");
  const { client_id, client_secret } = loadClient(env);
  const fresh = await tokenRequest(fetchFn, { client_id, client_secret, refresh_token: String(tok.refresh_token), grant_type: "refresh_token" });
  const scope = fresh.scope ?? tok.scope;
  assertWriteScopes(scope);
  saveWriteToken(email, { ...tok, access_token: fresh.access_token, expires_at: now() + fresh.expires_in * 1000, scope }, env);
  return fresh.access_token;
}

/** One-time write sign-in. Emits the URL like `calma auth`; `open: null` skips opening the browser. */
export async function authorizeWrite({ fetchFn = fetch, env = process.env, emit, open = openUrl, now = () => Date.now(), timeoutMs = 300_000 }: IoDeps & { emit: (value: unknown) => void }) {
  const policy = loadPolicy(env);
  if (policy.accounts.length === 0) throw new ToolError("write_not_configured", "No account is allowed to write yet. Run: calma-write allow --account <email>");
  const { client_id, client_secret } = loadClient(env);
  const { verifier, challenge, state } = newPkce();
  const { redirectUri, code: codePromise, close } = await listenForCallback({ state, timeoutMs });

  const url = buildWriteAuthUrl({ clientId: client_id, redirectUri, state, challenge });
  const opened = open ? await open(url) : false;
  emit({ event: "auth_url", url, opened });
  try {
    const code = await codePromise;
    const tok = await tokenRequest(fetchFn, { client_id, client_secret, code: code ?? null, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri });
    // Anything that goes wrong after Google issued the grant revokes it before the error is reported.
    try {
      assertWriteScopes(tok.scope);
      const who = await fetchWithTimeout(fetchFn, USERINFO_URL, { headers: { authorization: `Bearer ${tok.access_token}` } });
      const info = asRec(await readJson(who));
      if (!who.ok) throw new ToolError("auth_failed", "Could not read the signed-in address from Google. Nothing was saved.");
      let email: string;
      try {
        email = normalizeEmail(info.email);
      } catch {
        throw new ToolError("auth_failed", "Google did not report a usable address for this account. Nothing was saved.");
      }
      if (!policy.accounts.includes(email)) throw new ToolError("account_not_allowed", "That account is not on the write allow-list. Nothing was saved.");
      if (typeof tok.refresh_token !== "string" || !tok.refresh_token) throw new ToolError("auth_failed", "Google sent no refresh token. Remove this app from the account's third-party access and run auth again.");
      saveWriteToken(email, { account: email, scope: tok.scope, access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: now() + tok.expires_in * 1000, saved_at: new Date(now()).toISOString() }, env);
      return { event: "authorized", access: "write", account: email, scopes: (tok.scope as string).split(/\s+/) };
    } catch (err) {
      const secret = typeof tok.refresh_token === "string" && tok.refresh_token ? tok.refresh_token : tok.access_token;
      const revoked = await revokeToken(secret, { fetchFn });
      throw err instanceof ToolError ? new ToolError(err.code, `${err.message} ${revoked ? "The grant was revoked at Google." : "Could not revoke it; remove calma under your Google account's Third-party access."}`) : err;
    }
  } finally {
    close();
  }
}
