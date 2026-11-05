import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { listAccounts } from "../lib/accounts.mjs";
import * as config from "../lib/config.mjs";
import * as google from "../lib/google.mjs";
import * as oauth from "../lib/oauth.mjs";
import { SCOPE, jsonResponse, sandbox, visit } from "./helpers.mjs";

const mode = (p) => statSync(p).mode & 0o777;

test("the config folder is 700 and token files are 600", () => {
  const { dir, env } = sandbox();
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(config.tokenPath("personal", env)), 0o600);
  // A pre-existing wide folder and file are tightened, not trusted.
  config.writeSecretFile(config.tokenPath("school", env), "{}");
  assert.equal(mode(config.tokenPath("school", env)), 0o600);
});

test("a token with any other scope is refused and not saved", () => {
  const { env } = sandbox();
  assert.throws(() => config.saveToken("school", { scope: `${SCOPE} https://www.googleapis.com/auth/gmail.send` }, env), { code: "scope_refused" });
  assert.throws(() => config.loadToken("school", env), { code: "reauth_needed" });
});

test("a refresh saves the new expiry, keeps 600 and never prints a token", async () => {
  const { env } = sandbox({ expiresAt: 0 });
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url: String(url), method: init.method });
    return jsonResponse({ access_token: "NEW-ACCESS", expires_in: 3600, scope: SCOPE });
  };
  let printed = "";
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (s) => ((printed += s), true);
  process.stderr.write = (s) => ((printed += s), true);
  try {
    assert.equal(await oauth.accessToken("personal", { fetchFn, env }), "NEW-ACCESS");
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  assert.equal(printed, "");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(JSON.parse(readFileSync(config.tokenPath("personal", env), "utf8")).access_token, "NEW-ACCESS");
  assert.equal(mode(config.tokenPath("personal", env)), 0o600);
});

test("a refresh that Google rejects asks for re-auth and leaks nothing", async () => {
  const { env } = sandbox({ expiresAt: 0 });
  const fetchFn = async () => jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked. FAKE-REFRESH" }, 400);
  await assert.rejects(oauth.accessToken("personal", { fetchFn, env }), (e) => e.code === "reauth_needed" && !/FAKE-/.test(e.message));
});

test("error messages from Google never echo a token", async () => {
  const { env } = sandbox();
  const fetchFn = async () => jsonResponse({ error: { code: 403, status: "PERMISSION_DENIED", message: "Bearer FAKE-ACCESS" } }, 403);
  await assert.rejects(google.mailRecent("personal", "", { fetchFn, env }), (e) => e.code === "google_error" && !/FAKE-/.test(e.message));
});

test("auth: end to end with a mocked Google, and refuses a wrong account or extra scope", async () => {
  async function runAuth({ scope = SCOPE, email = "me@example.com" } = {}) {
    const { env } = sandbox({ token: false });
    // sandbox wrote a placeholder token; remove it so we see what auth saves.
    const { rmSync } = await import("node:fs");
    rmSync(config.tokenPath("personal", env));
    const events = [];
    const pending = [];
    const revoked = [];
    const fetchFn = async (url, init) => {
      if (String(url).startsWith("https://oauth2.googleapis.com/revoke")) {
        revoked.push(new URLSearchParams(init.body).get("token"));
        return jsonResponse({});
      }
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) return jsonResponse({ access_token: "A1", refresh_token: "R1", expires_in: 3600, scope });
      return jsonResponse({ emailAddress: email });
    };
    const emit = (e) => {
      events.push(e);
      if (e.event === "auth_url") {
        const u = new URL(e.url);
        const cb = new URL(u.searchParams.get("redirect_uri"));
        cb.searchParams.set("code", "CODE");
        cb.searchParams.set("state", u.searchParams.get("state"));
        pending.push(visit(cb, 20));
      }
    };
    const result = await oauth.authorize({ fetchFn, env, emit, timeoutMs: 5000 }).then((r) => ({ r }), (e) => ({ e }));
    await Promise.all(pending);
    return { env, events, revoked, ...result };
  }
  const ok = await runAuth();
  assert.equal(ok.r.event, "authorized");
  assert.deepEqual(ok.revoked, [], "a good sign-in revokes nothing");
  assert.equal(new URL(ok.events[0].url).host, "accounts.google.com");
  assert.ok(!JSON.stringify([ok.r, ...ok.events]).includes("R1"));
  // The address Google reports names the account and the token file; the sign-in URL carries no address.
  assert.equal(ok.r.account, "me@example.com");
  assert.ok(!ok.events[0].url.includes("example.com"));
  assert.equal(new URL(ok.events[0].url).searchParams.get("prompt"), "consent select_account");
  assert.equal(mode(config.tokenPath("me@example.com", ok.env)), 0o600);
  assert.deepEqual(listAccounts(ok.env), ["me@example.com"]);

  const extra = await runAuth({ scope: `${SCOPE} https://www.googleapis.com/auth/gmail.send` });
  assert.equal(extra.e.code, "scope_refused");
  assert.deepEqual(extra.revoked, ["R1"], "the refused grant is revoked at Google");
  assert.match(extra.e.message, /revoked at Google/);
  assert.deepEqual(listAccounts(extra.env), [], "nothing saved");

  // A profile without a usable address is refused, revoked and not saved; so is a failed profile call.
  for (const email of [null, "", "../x@example.com", "not an address"]) {
    const bad = await runAuth({ email });
    assert.equal(bad.e.code, "auth_failed", String(email));
    assert.deepEqual(bad.revoked, ["R1"], "the grant is revoked at Google");
    assert.ok(!bad.e.message.includes("R1"));
    assert.deepEqual(listAccounts(bad.env), []);
  }

  // Signing in again as the same account replaces its token; a second account adds one.
  const again = await runAuth({ email: " Me@Example.com " });
  assert.equal(again.r.account, "me@example.com");
});
