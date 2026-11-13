// Loopback OAuth (RFC 8252) with PKCE, and token refresh. The only POST in this tool is to Google's token endpoint.
import { fetchWithTimeout, readJson } from "./net.ts";
import { normalizeEmail } from "./accounts.ts";
import { openUrl } from "./browser.ts";
import { newPkce, listenForCallback } from "./loopback.ts";
import { ALLOWED_SCOPES, ToolError, assertScopes, loadClient, loadToken, saveToken } from "./config.ts";
import { asRec } from "./record.ts";
import type { FetchLike, IoDeps } from "./types.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

type TokenDeps = {
  fetchFn?: FetchLike;
  env?: IoDeps["env"];
  now?: () => number;
};

export function buildAuthUrl({ clientId, redirectUri, state, challenge, scopes = ALLOWED_SCOPES }: { clientId: string; redirectUri: string; state: string; challenge: string; scopes?: readonly string[] }) {
  assertScopes(scopes);
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent select_account",
  }).toString();
  return u.toString();
}

function formBody(params: Record<string, string | null>) {
  // URLSearchParams stringifies null as "null". Build that ourselves so the param type can stay exact.
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) pairs.push([key, value === null ? "null" : value]);
  return new URLSearchParams(pairs);
}

/** POST to Google's token endpoint (code exchange or refresh). Shared with calma-write. */
export async function tokenRequest(fetchFn: FetchLike, params: Record<string, string | null>) {
  const res = await fetchWithTimeout(fetchFn, TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody(params) });
  const body = asRec(await readJson(res));
  if (!res.ok) {
    // Only Google's error code is passed on, never the response body (it could echo a token or a code).
    const code = typeof body.error === "string" ? body.error.replace(/[^a-z_]/gi, "") : "token_error";
    if (code === "invalid_grant") throw new ToolError("reauth_needed", "Google rejected the refresh token. Run auth for this account again.");
    throw new ToolError("token_error", `Google's token endpoint answered ${res.status} (${code}).`);
  }
  const expires = body.expires_in;
  if (typeof body.access_token !== "string" || !body.access_token || typeof expires !== "number" || !Number.isFinite(expires) || expires <= 0) {
    throw new ToolError("token_error", "Google's token response was incomplete.");
  }
  return { access_token: body.access_token, expires_in: expires, refresh_token: body.refresh_token, scope: body.scope };
}

/** Returns a valid access token for the account, refreshing it (and saving the new expiry) when needed. */
export async function accessToken(name: string, { fetchFn = fetch, env = process.env, now = () => Date.now() }: TokenDeps = {}): Promise<string> {
  const tok = loadToken(name, env);
  assertScopes(tok.scope);
  if (tok.access_token && tok.expires_at && tok.expires_at - 60_000 > now()) return tok.access_token;
  if (!tok.refresh_token) throw new ToolError("reauth_needed", "No refresh token for this account. Run: calma auth");
  const { client_id, client_secret } = loadClient(env);
  const fresh = await tokenRequest(fetchFn, { client_id, client_secret, refresh_token: String(tok.refresh_token), grant_type: "refresh_token" });
  const scope = fresh.scope ?? tok.scope;
  assertScopes(scope);
  saveToken(name, { ...tok, access_token: fresh.access_token, expires_at: now() + fresh.expires_in * 1000, scope }, env);
  return fresh.access_token;
}

/**
 * One-time authorisation. Opens the sign-in URL in the browser and prints it (as a JSON event through `emit`); Google shows its account chooser, and calls
 * back on 127.0.0.1. Checks that the granted scopes are read-only, reads the signed-in address from Gmail, and saves the
 * token as <address>.json. Nothing secret is emitted.
 */
export async function authorize({ fetchFn = fetch, env = process.env, emit, open = openUrl, now = () => Date.now(), timeoutMs = 300_000 }: IoDeps & { emit: (value: unknown) => void }) {
  const { client_id, client_secret } = loadClient(env);
  const { verifier, challenge, state } = newPkce();
  const { redirectUri, code: codePromise, close } = await listenForCallback({ state, timeoutMs });

  const url = buildAuthUrl({ clientId: client_id, redirectUri, state, challenge });
  // Open the browser (pass `open: null` to skip). The URL is printed either way, for a headless machine or another browser.
  const opened = open ? await open(url) : false;
  emit({ event: "auth_url", url, opened });
  try {
    const code = await codePromise;
    const tok = await tokenRequest(fetchFn, { client_id, client_secret, code: code ?? null, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri });
    // Refuse (and save nothing) if Google granted anything beyond the two read-only scopes, or the wrong account signed in.
    // A refused grant is live at Google until revoked, so revoke it before reporting the refusal.
    try {
      // Refuse (and save nothing) if Google granted anything beyond the two read-only scopes.
      assertScopes(tok.scope);
      const who = await fetchWithTimeout(fetchFn, PROFILE_URL, { headers: { authorization: `Bearer ${tok.access_token}` } });
      const profile = asRec(await readJson(who));
      if (!who.ok) throw new ToolError("auth_failed", "Could not read the signed-in address from Google. Nothing was saved.");
      let email: string;
      try {
        email = normalizeEmail(profile.emailAddress);
      } catch {
        throw new ToolError("auth_failed", "Google did not report a usable address for this account. Nothing was saved.");
      }
      if (typeof tok.refresh_token !== "string" || !tok.refresh_token) throw new ToolError("auth_failed", "Google sent no refresh token. Remove this app from the account's third-party access and run auth again.");
      saveToken(email, { account: email, scope: tok.scope, access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: now() + tok.expires_in * 1000, saved_at: new Date(now()).toISOString() }, env);
      return { event: "authorized", account: email, scopes: (tok.scope as string).split(/\s+/) };
    } catch (err) {
      const secret = typeof tok.refresh_token === "string" && tok.refresh_token ? tok.refresh_token : tok.access_token;
      const revoked = await revokeToken(secret, { fetchFn });
      throw err instanceof ToolError ? new ToolError(err.code, `${err.message} ${revoked ? "The grant was revoked at Google." : "Could not revoke it; remove calma under your Google account's Third-party access."}`) : err;
    }
  } finally {
    close();
  }
}

/** Asks Google to revoke a token (the grant ends at the source). Best effort: true if Google accepted it, false otherwise. */
export async function revokeToken(token: string, { fetchFn = fetch }: { fetchFn?: FetchLike } = {}) {
  try {
    const res = await fetchWithTimeout(fetchFn, REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
    return res.ok;
  } catch {
    return false;
  }
}
