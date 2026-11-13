import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isGoogleSignInUrl, openUrl, openerFor } from "../src/lib/browser.ts";
import { buildAuthUrl, authorize } from "../src/lib/oauth.ts";
import { SCOPE, jsonResponse, sandbox, visit } from "./helpers.ts";

const GOOD = buildAuthUrl({ clientId: "x", redirectUri: "http://127.0.0.1:1/callback", state: "s", challenge: "c" });

/** A fake child process: emits "spawn" (or "error") on the next tick. */
const fakeSpawn = (outcome = "spawn") => {
  const calls: any[] = [];
  const spawnFn = (cmd: any, args: any, options: any) => {
    calls.push({ cmd, args, options });
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => {};
    setImmediate(() => child.emit(outcome, outcome === "error" ? new Error("ENOENT") : undefined));
    return child;
  };
  return { calls, spawnFn };
};

test("only Google's sign-in page may be opened", () => {
  assert.equal(isGoogleSignInUrl(GOOD), true);
  const bad = ["http://accounts.google.com/o/oauth2/v2/auth", "https://accounts.google.com.evil.example/o/oauth2/v2/auth", "https://evil.example/accounts.google.com/o/oauth2/v2/auth", `https://accounts.google.com${"@"}evil.example/o/oauth2/v2/auth`, "https://accounts.google.com/other", "https://example.com", "file:///etc/passwd", "javascript:alert(1)", "calc.exe", "", undefined, null, 5];
  for (const b of bad) assert.equal(isGoogleSignInUrl(b), false, String(b));
});

test("each platform has its own opener, and the URL is one argument (no shell)", async () => {
  assert.deepEqual(openerFor("darwin"), ["open"]);
  assert.deepEqual(openerFor("linux"), ["xdg-open"]);
  assert.deepEqual(openerFor("win32"), ["rundll32", "url.dll,FileProtocolHandler"]);
  const { calls, spawnFn } = fakeSpawn();
  assert.equal(await openUrl(GOOD, { platform: "darwin", spawnFn }), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [GOOD], "the whole URL, with its & characters, is a single argument");
  assert.equal(calls[0].cmd, "open");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, "ignore");
});

test("openUrl says false when the opener is missing, and never spawns for a refused URL", async () => {
  assert.equal(await openUrl(GOOD, { platform: "linux", spawnFn: fakeSpawn("error").spawnFn }), false);
  const { calls, spawnFn } = fakeSpawn();
  assert.equal(await openUrl("https://evil.example/", { spawnFn }), false);
  assert.equal(calls.length, 0);
  assert.equal(await openUrl(GOOD, { spawnFn: () => { throw new Error("boom"); } }), false);
});

/** Runs authorize with a simulated browser callback; `open` is what the test injects. */
async function signIn(open: any) {
  const { env } = sandbox({ token: false });
  const events: any[] = [];
  const pending: any[] = [];
  const fetchFn = async (url: any) => (String(url).startsWith("https://oauth2.googleapis.com/token") ? jsonResponse({ access_token: "FAKE-ACCESS-TOKEN-1", refresh_token: "FAKE-REFRESH-TOKEN-1", expires_in: 3600, scope: SCOPE }) : jsonResponse({ emailAddress: "me@example.com" }));
  const emit = (e: any) => {
    events.push(e);
    if (e.event !== "auth_url") return;
    const u = new URL(e.url);
    const cb = new URL(u.searchParams.get("redirect_uri")!);
    cb.searchParams.set("code", "CODE");
    cb.searchParams.set("state", u.searchParams.get("state")!);
    pending.push(visit(cb, 20));
  };
  const result = await authorize({ fetchFn, env, emit, open, timeoutMs: 5000 });
  await Promise.all(pending);
  return { result, events };
}

test("auth opens the browser with the sign-in URL and still prints it", async () => {
  const opened: any[] = [];
  const { result, events } = await signIn(async (url: any) => (opened.push(url), true));
  assert.equal(result.event, "authorized");
  assert.equal(opened.length, 1);
  assert.equal(opened[0], events[0].url);
  assert.equal(events[0].opened, true);
  assert.ok(isGoogleSignInUrl(events[0].url));
});

test("if the browser cannot be opened, the URL is printed with opened:false and sign-in still works", async () => {
  const { result, events } = await signIn(async () => false);
  assert.equal(events[0].opened, false);
  assert.ok(events[0].url.startsWith("https://accounts.google.com/"));
  assert.equal(result.event, "authorized");
});

test("open: null (--no-open) never opens anything", async () => {
  const { events } = await signIn(null);
  assert.equal(events[0].opened, false);
});

test("no test can open a real browser: every authorize() call in the tests passes `open`", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".test.ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/authorize(?:Write)?\(\{[^)]*\}\)/g)) assert.match(m[0], /\bopen\b/, `${f}: ${m[0].slice(0, 60)}`);
  }
});
