import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { listAccounts } from "../lib/accounts.mjs";
import * as config from "../lib/config.mjs";
import { uninstall } from "../lib/uninstall.mjs";
import { allowAccount, allowCalendar, loadPolicy, normalizeCalendarId, policyPath } from "../lib/write/policy.mjs";
import { accessWriteToken, authorizeWrite, buildWriteAuthUrl } from "../lib/write/oauth.mjs";
import { WRITE_SCOPE, assertWriteScopes } from "../lib/write/scopes.mjs";
import { listWriteAccounts, loadWriteToken, saveWriteToken, writeTokenPath } from "../lib/write/tokens.mjs";
import * as cli from "../calma-write.mjs";
import { SCOPE, jsonResponse, sandbox, visit } from "./helpers.mjs";

const WRITE_GRANT = `${WRITE_SCOPE} openid https://www.googleapis.com/auth/userinfo.email`;
const mode = (p) => statSync(p).mode & 0o777;
const FAR = Date.now() + 10 * 365 * 24 * 3600 * 1000;
const writeToken = (env, email, extra = {}) => saveWriteToken(email, { account: email, scope: WRITE_GRANT, access_token: `WRITE-ACCESS-${email}`, refresh_token: `WRITE-REFRESH-${email}`, expires_at: FAR, ...extra }, env);

test("the write token may carry calendar.events and identity, nothing else", () => {
  assert.deepEqual(assertWriteScopes(WRITE_GRANT), WRITE_GRANT.split(" "));
  assert.deepEqual(assertWriteScopes([WRITE_SCOPE]), [WRITE_SCOPE]);
  for (const extra of ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send", "https://mail.google.com/", "https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/drive"]) {
    assert.throws(() => assertWriteScopes(`${WRITE_GRANT} ${extra}`), { code: "scope_refused" }, extra);
  }
  assert.throws(() => assertWriteScopes("openid email"), { code: "scope_refused" }, "calendar.events is required");
  assert.throws(() => assertWriteScopes(SCOPE), { code: "scope_refused" }, "a read token is not a write token");
});

test("the write sign-in URL asks for calendar.events and identity only, with the account chooser", () => {
  const u = new URL(buildWriteAuthUrl({ clientId: "x", redirectUri: "http://127.0.0.1:1/callback", state: "s", challenge: "c" }));
  assert.deepEqual(u.searchParams.get("scope").split(" "), [WRITE_SCOPE, "openid", "email"]);
  assert.equal(u.searchParams.get("prompt"), "consent select_account");
  assert.equal(u.searchParams.has("login_hint"), false);
  assert.equal(u.searchParams.get("access_type"), "offline");
});

test("the policy starts empty and allows accounts and calendars idempotently, normalised, in a 600 file", () => {
  const { env } = sandbox();
  assert.deepEqual(loadPolicy(env), { accounts: [], calendars: [] });
  allowAccount(" Me@Example.com ", env);
  allowAccount("me@example.com", env);
  allowCalendar("primary", env);
  allowCalendar(" primary ", env);
  const second = `cal-1${"@"}example.com`;
  assert.deepEqual(allowCalendar(second, env), { accounts: ["me@example.com"], calendars: ["primary", second] });
  assert.equal(mode(policyPath(env)), 0o600);
});

test("bad accounts and calendar ids are refused (a calendar id goes into a URL path)", () => {
  const { env } = sandbox();
  assert.throws(() => allowAccount("not an address", env), { code: "bad_email" });
  for (const bad of ["", " ", "..", "a/b", "../x", "a b", ".hidden", "a..b", "x?y=1", "x#y", "a%2fb", undefined, 5]) {
    assert.throws(() => normalizeCalendarId(bad), { code: "bad_calendar" }, String(bad));
  }
  assert.equal(normalizeCalendarId("primary"), "primary");
  assert.equal(normalizeCalendarId(`abc123${"@"}group.calendar.example.com`), `abc123${"@"}group.calendar.example.com`);
  writeFileSync(policyPath(env), "{not json", { mode: 0o600 });
  assert.throws(() => loadPolicy(env), { code: "bad_policy" });
  writeFileSync(policyPath(env), JSON.stringify({ accounts: ["../x"], calendars: [] }));
  assert.throws(() => loadPolicy(env), { code: "bad_email" });
});

test("write tokens are stored apart from read tokens: write/<address>.json, folder 700, file 600", () => {
  const { dir, env } = sandbox();
  writeToken(env, "me@example.com");
  assert.equal(writeTokenPath("me@example.com", env), join(dir, "write", `${"me@example.com"}.json`));
  assert.equal(mode(join(dir, "write")), 0o700);
  assert.equal(mode(writeTokenPath("me@example.com", env)), 0o600);
  assert.deepEqual(listWriteAccounts(env), ["me@example.com"]);
  assert.deepEqual(listAccounts(env), [], "a write token is not a read account");
  assert.throws(() => loadWriteToken("you@example.com", env), { code: "reauth_needed" });
  // A token with a read scope can never be saved in the write store, and a write token never in the read store.
  assert.throws(() => saveWriteToken("me@example.com", { scope: SCOPE }, env), { code: "scope_refused" });
  assert.throws(() => config.saveToken("me@example.com", { scope: WRITE_GRANT }, env), { code: "scope_refused" });
});

/** Runs authorizeWrite against a mocked Google. `grant` is what Google reports back. */
async function signIn({ policy = ["me@example.com"], scope = WRITE_GRANT, email = "me@example.com", refresh = "WRITE-REFRESH-TOKEN-1", userinfoOk = true, open = null } = {}) {
  const { env } = sandbox({ token: false });
  for (const a of policy) allowAccount(a, env);
  const events = [];
  const pending = [];
  const revoked = [];
  const calls = [];
  const fetchFn = async (url, init) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("https://oauth2.googleapis.com/revoke")) return revoked.push(new URLSearchParams(init.body).get("token")), jsonResponse({});
    if (u.startsWith("https://oauth2.googleapis.com/token")) return jsonResponse({ access_token: "WRITE-ACCESS-TOKEN-1", ...(refresh ? { refresh_token: refresh } : {}), expires_in: 3600, scope });
    if (u.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return userinfoOk ? jsonResponse({ email }) : jsonResponse({}, 500);
    throw new Error(`unexpected request ${u}`);
  };
  const emit = (e) => {
    events.push(e);
    if (e.event !== "auth_url") return;
    const q = new URL(e.url);
    const cb = new URL(q.searchParams.get("redirect_uri"));
    cb.searchParams.set("code", "CODE");
    cb.searchParams.set("state", q.searchParams.get("state"));
    pending.push(visit(cb, 20));
  };
  const result = await authorizeWrite({ fetchFn, env, emit, open, timeoutMs: 5000 }).then((r) => ({ r }), (e) => ({ e }));
  await Promise.all(pending);
  return { env, events, revoked, calls, ...result };
}

test("write sign-in saves the token under write/<address>.json and prints no secret", async () => {
  const ok = await signIn();
  assert.equal(ok.r.event, "authorized");
  assert.equal(ok.r.access, "write");
  assert.equal(ok.r.account, "me@example.com");
  assert.deepEqual(ok.revoked, []);
  assert.equal(new URL(ok.events[0].url).host, "accounts.google.com");
  assert.ok(new URL(ok.events[0].url).searchParams.get("scope").includes("calendar.events"));
  assert.ok(!JSON.stringify([ok.r, ...ok.events]).includes("WRITE-"), "no token in the output");
  assert.deepEqual(listWriteAccounts(ok.env), ["me@example.com"]);
  assert.deepEqual(listAccounts(ok.env), []);
  assert.equal(JSON.parse(readFileSync(writeTokenPath("me@example.com", ok.env), "utf8")).refresh_token, "WRITE-REFRESH-TOKEN-1");
});

test("write sign-in opens the browser through the injected opener, once", async () => {
  const opened = [];
  const ok = await signIn({ open: async (url) => (opened.push(url), true) });
  assert.equal(ok.r.event, "authorized");
  assert.deepEqual(opened, [ok.events[0].url]);
  assert.equal(ok.events[0].opened, true);
});

test("an address that is not on the allow-list is refused, its grant revoked, nothing saved", async () => {
  const bad = await signIn({ email: "kid@example.com" });
  assert.equal(bad.e.code, "account_not_allowed");
  assert.deepEqual(bad.revoked, ["WRITE-REFRESH-TOKEN-1"]);
  assert.match(bad.e.message, /revoked at Google/);
  assert.deepEqual(listWriteAccounts(bad.env), []);
  assert.ok(!bad.e.message.includes("WRITE-"));
});

test("with nothing allowed yet, write sign-in stops before opening a browser or listening", async () => {
  const none = await signIn({ policy: [] });
  assert.equal(none.e.code, "write_not_configured");
  assert.deepEqual(none.events, []);
  assert.deepEqual(none.calls, []);
});

test("any other scope, a missing calendar.events, a missing address or no refresh token: refused and revoked", async () => {
  for (const scope of [`${WRITE_GRANT} https://www.googleapis.com/auth/gmail.send`, `${WRITE_GRANT} https://www.googleapis.com/auth/gmail.readonly`, "openid email"]) {
    const bad = await signIn({ scope });
    assert.equal(bad.e.code, "scope_refused", scope);
    assert.deepEqual(bad.revoked, ["WRITE-REFRESH-TOKEN-1"]);
    assert.deepEqual(listWriteAccounts(bad.env), []);
  }
  for (const opts of [{ email: "" }, { email: "../x@example.com" }, { userinfoOk: false }]) {
    const bad = await signIn(opts);
    assert.equal(bad.e.code, "auth_failed");
    assert.deepEqual(bad.revoked, ["WRITE-REFRESH-TOKEN-1"]);
    assert.deepEqual(listWriteAccounts(bad.env), []);
  }
  const noRefresh = await signIn({ refresh: null });
  assert.equal(noRefresh.e.code, "auth_failed");
  assert.deepEqual(noRefresh.revoked, ["WRITE-ACCESS-TOKEN-1"], "with no refresh token the access token is revoked");
});

test("accessWriteToken: a fresh token is used as is; an expired one is refreshed and saved; Google's refusal asks for a new sign-in", async () => {
  const { env } = sandbox();
  writeToken(env, "me@example.com");
  const never = async () => assert.fail("no request expected");
  assert.equal(await accessWriteToken("me@example.com", { env, fetchFn: never }), "WRITE-ACCESS-me@example.com");

  writeToken(env, "me@example.com", { expires_at: 0 });
  const fetchFn = async () => jsonResponse({ access_token: "WRITE-NEW-1", expires_in: 3600, scope: WRITE_GRANT });
  assert.equal(await accessWriteToken("me@example.com", { env, fetchFn }), "WRITE-NEW-1");
  assert.equal(loadWriteToken("me@example.com", env).access_token, "WRITE-NEW-1");
  assert.equal(mode(writeTokenPath("me@example.com", env)), 0o600);

  writeToken(env, "me@example.com", { expires_at: 0 });
  await assert.rejects(accessWriteToken("me@example.com", { env, fetchFn: async () => jsonResponse({ error: "invalid_grant" }, 400) }), { code: "reauth_needed" });
  await assert.rejects(accessWriteToken("me@example.com", { env, fetchFn: async () => jsonResponse({ access_token: "N", expires_in: 3600, scope: `${WRITE_GRANT} https://www.googleapis.com/auth/gmail.send` }) }), { code: "scope_refused" });
});

test("a hand-made write token with a read scope is refused", async () => {
  const { dir, env } = sandbox();
  writeToken(env, "me@example.com");
  writeFileSync(writeTokenPath("me@example.com", env), JSON.stringify({ scope: SCOPE, access_token: "X", expires_at: FAR }));
  await assert.rejects(accessWriteToken("me@example.com", { env, fetchFn: async () => assert.fail("no request") }), { code: "scope_refused" });
  assert.ok(dir);
});

test("the calma-write command: parse, accounts, policy, allow, usage", async () => {
  assert.deepEqual(cli.parseArgs(["allow", "--account", "me@example.com"]), { cmd: "allow", rest: [], flags: { account: "me@example.com", calendar: undefined, open: true } });
  assert.deepEqual(cli.parseArgs(["allow", "--calendar", "primary"]).flags.calendar, "primary");
  assert.equal(cli.parseArgs(["auth", "--no-open"]).flags.open, false);
  assert.throws(() => cli.parseArgs(["allow", "--calendar"]), { code: "usage" });

  const { env } = sandbox();
  const run = async (argv) => {
    const lines = [];
    await cli.run(argv, { env, emit: (o) => lines.push(o) });
    return lines;
  };
  assert.deepEqual(await run(["policy"]), [{ accounts: [], calendars: [] }]);
  assert.deepEqual(await run(["allow", "--account", "Me@Example.com"]), [{ accounts: ["me@example.com"], calendars: [] }]);
  assert.deepEqual(await run(["allow", "--calendar", "primary"]), [{ accounts: ["me@example.com"], calendars: ["primary"] }]);
  writeToken(env, "me@example.com");
  assert.deepEqual(await run(["accounts"]), [{ accounts: ["me@example.com"] }]);
  assert.ok(!JSON.stringify(await run(["accounts"])).includes("WRITE-"));
  await assert.rejects(run(["allow"]), { code: "usage" });
  await assert.rejects(run(["allow", "--account", "me@example.com", "--calendar", "primary"]), { code: "usage" });
  await assert.rejects(run(["allow", "--account", "../x"]), { code: "bad_email" });
  await assert.rejects(run([]), { code: "usage" });
  await assert.rejects(run(["calendar-delete"]), { code: "usage" });
});

/** read token + write token for two accounts, the allow-list, a write log and a client file. */
function populated() {
  const { dir, env } = sandbox();
  for (const who of ["me@example.com", "you@example.com"]) {
    config.saveToken(who, { account: who, scope: SCOPE, access_token: `READ-ACCESS-${who}`, refresh_token: `READ-REFRESH-${who}`, expires_at: FAR }, env);
    writeToken(env, who);
  }
  allowAccount("me@example.com", env);
  writeFileSync(join(dir, "write.log"), "");
  return { dir, env };
}
const recorder = () => {
  const tokens = [];
  return { tokens, fetchFn: async (url, init) => (tokens.push(new URLSearchParams(init.body).get("token")), jsonResponse({})) };
};

test("uninstall --account removes that account's read and write tokens, and only those", async () => {
  const { dir, env } = populated();
  const { tokens, fetchFn } = recorder();
  const out = await uninstall(" ME@example.com ", { yes: true, env, fetchFn });
  assert.deepEqual(out.removed.sort(), [`${"me@example.com"}.json`, `write/${"me@example.com"}.json`]);
  assert.deepEqual(tokens.sort(), ["READ-REFRESH-me@example.com", "WRITE-REFRESH-me@example.com"]);
  assert.equal(existsSync(writeTokenPath("me@example.com", env)), false);
  assert.ok(existsSync(writeTokenPath("you@example.com", env)) && existsSync(join(dir, "write.json")) && existsSync(join(dir, "client.json")));
  assert.ok(!JSON.stringify(out).includes("REFRESH"));
});

test("uninstall --all lists, revokes and removes write tokens, the allow-list, the log and the empty folders", async () => {
  const { dir, env } = populated();
  const dry = await uninstall("--all", { env, fetchFn: async () => assert.fail("a dry run makes no request") });
  for (const name of [`write/${"me@example.com"}.json`, `write/${"you@example.com"}.json`, "write.json", "write.log"]) assert.ok(dry.would_remove.includes(name), name);
  const { tokens, fetchFn } = recorder();
  const out = await uninstall("--all", { yes: true, env, fetchFn });
  assert.equal(tokens.filter((t) => t.startsWith("WRITE-")).length, 2);
  assert.equal(tokens.filter((t) => t.startsWith("READ-")).length, 2);
  assert.equal(out.folder_removed, true);
  assert.equal(existsSync(dir), false);
});

test("uninstall keeps a write folder that holds files it does not own", async () => {
  const { dir, env } = populated();
  writeFileSync(join(dir, "write", "notes.txt"), "mine");
  const out = await uninstall("--all", { yes: true, env, fetchFn: recorder().fetchFn });
  assert.equal(out.folder_removed, false);
  assert.ok(existsSync(join(dir, "write", "notes.txt")));
});
