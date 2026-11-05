// Loopback OAuth (RFC 8252) with PKCE, and token refresh. The only POST in this tool is to Google's token endpoint.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { fetchWithTimeout } from "./net.mjs";
import { ALLOWED_SCOPES, ToolError, accountEmail, assertScopes, loadClient, loadToken, saveToken } from "./config.mjs";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const b64url = (buf) => buf.toString("base64url");

export function buildAuthUrl({ clientId, redirectUri, state, challenge, scopes = ALLOWED_SCOPES }) {
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
    prompt: "consent",
  }).toString();
  return u.toString();
}

async function tokenRequest(fetchFn, params) {
  const res = await fetchWithTimeout(fetchFn, TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Only Google's error code is passed on, never the response body (it could echo a token or a code).
    const code = typeof body.error === "string" ? body.error.replace(/[^a-z_]/gi, "") : "token_error";
    if (code === "invalid_grant") throw new ToolError("reauth_needed", "Google rejected the refresh token. Test-mode tokens expire after 7 days. Run auth for this account again.");
    throw new ToolError("token_error", `Google's token endpoint answered ${res.status} (${code}).`);
  }
  if (typeof body.access_token !== "string" || !body.access_token || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
    throw new ToolError("token_error", "Google's token response was incomplete.");
  }
  return body;
}

/** Returns a valid access token for the account, refreshing it (and saving the new expiry) when needed. */
export async function accessToken(name, { fetchFn = fetch, env = process.env, now = () => Date.now() } = {}) {
  const tok = loadToken(name, env);
  assertScopes(tok.scope);
  if (tok.access_token && tok.expires_at && tok.expires_at - 60_000 > now()) return tok.access_token;
  if (!tok.refresh_token) throw new ToolError("reauth_needed", `No refresh token for "${name}". Run: calma auth ${name}`);
  const { client_id, client_secret } = loadClient(env);
  const fresh = await tokenRequest(fetchFn, { client_id, client_secret, refresh_token: tok.refresh_token, grant_type: "refresh_token" });
  const scope = fresh.scope ?? tok.scope;
  assertScopes(scope);
  saveToken(name, { ...tok, access_token: fresh.access_token, expires_at: now() + fresh.expires_in * 1000, scope }, env);
  return fresh.access_token;
}

/**
 * One-time authorisation for an account. Prints the URL (as a JSON event through `emit`), waits for Google to call
 * back on 127.0.0.1, checks that the granted scopes are read-only and that the signed-in address is the configured one,
 * then saves the token. Nothing secret is emitted.
 */
export async function authorize(name, { fetchFn = fetch, env = process.env, emit, now = () => Date.now(), timeoutMs = 300_000 } = {}) {
  const email = accountEmail(name, env);
  const { client_id, client_secret } = loadClient(env);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;

  const codePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ToolError("auth_timeout", "No answer from Google within 5 minutes.")), timeoutMs);
    server.on("request", (req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      // A callback with the wrong state is not Google answering us (a stray request, or someone probing the port): ignore it
      // and keep waiting for the real one.
      if (u.searchParams.get("state") !== state) {
        res.writeHead(400, { "content-type": "text/plain" }).end("Unexpected request. Ignored.");
        return;
      }
      if (u.searchParams.get("error")) {
        res.writeHead(400, { "content-type": "text/plain" }).end("Not authorised. You can close this tab.");
        clearTimeout(timer);
        reject(new ToolError("auth_failed", `Google returned an error: ${u.searchParams.get("error").replace(/[^a-z_]/gi, "")}`));
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" }).end("Authorised. You can close this tab.");
      clearTimeout(timer);
      resolve(u.searchParams.get("code"));
    });
  });

  emit({ event: "auth_url", account: name, url: buildAuthUrl({ clientId: client_id, redirectUri, state, challenge }) });
  try {
    const code = await codePromise;
    const tok = await tokenRequest(fetchFn, { client_id, client_secret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri });
    // Refuse (and save nothing) if Google granted anything beyond the two read-only scopes.
    assertScopes(tok.scope);
    const who = await fetchWithTimeout(fetchFn, PROFILE_URL, { headers: { authorization: `Bearer ${tok.access_token}` } });
    const profile = await who.json().catch(() => ({}));
    if (!who.ok || String(profile.emailAddress).toLowerCase() !== email) {
      throw new ToolError("wrong_account", "The signed-in Google account is not the one configured for this label. Nothing was saved.");
    }
    if (!tok.refresh_token) throw new ToolError("auth_failed", "Google sent no refresh token. Remove this app from the account's third-party access and run auth again.");
    saveToken(name, { account: name, scope: tok.scope, access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: now() + tok.expires_in * 1000, saved_at: new Date(now()).toISOString() }, env);
    return { event: "authorized", account: name, scopes: tok.scope.split(/\s+/), note: "Test-mode tokens expire after 7 days; run auth again then." };
  } finally {
    server.close();
  }
}

/** Asks Google to revoke a token (the grant ends at the source). Best effort: true if Google accepted it, false otherwise. */
export async function revokeToken(token, { fetchFn = fetch } = {}) {
  try {
    const res = await fetchFn(REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
    return res.ok;
  } catch {
    return false;
  }
}
