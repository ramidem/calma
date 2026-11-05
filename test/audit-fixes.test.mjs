import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test } from "node:test";
import * as config from "../lib/config.mjs";
import * as google from "../lib/google.mjs";
import { fetchWithTimeout } from "../lib/net.mjs";
import * as oauth from "../lib/oauth.mjs";
import { SCOPE, jsonResponse, sandbox } from "./helpers.mjs";

const b64 = (s) => Buffer.from(s).toString("base64url");

test("a callback with the wrong state is ignored and sign-in keeps waiting", async () => {
  const { env } = sandbox({ token: false });
  rmSync(config.tokenPath("personal", env));
  const fetchFn = async (url) => (String(url).startsWith("https://oauth2.googleapis.com/token") ? jsonResponse({ access_token: "A1", refresh_token: "R1", expires_in: 3600, scope: SCOPE }) : jsonResponse({ emailAddress: "personal@example.com" }));
  let stray;
  const emit = (e) => {
    if (e.event !== "auth_url") return;
    const u = new URL(e.url);
    const cb = new URL(u.searchParams.get("redirect_uri"));
    const bad = new URL(cb);
    bad.searchParams.set("code", "EVIL");
    bad.searchParams.set("state", "wrong");
    stray = fetch(bad).then((r) => r.status);
    cb.searchParams.set("code", "CODE");
    cb.searchParams.set("state", u.searchParams.get("state"));
    setTimeout(() => fetch(cb), 60);
  };
  const result = await oauth.authorize("personal", { fetchFn, env, emit, timeoutMs: 5000 });
  assert.equal(result.event, "authorized");
  assert.equal(await stray, 400);
});

test("a stalled Google call ends with a timeout error instead of hanging", async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  // AbortSignal.timeout timers don't keep Node alive (a real socket would); hold the loop open for the fake one.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(fetchWithTimeout(hang, "https://example.com", {}, 20), { code: "timeout" });
  } finally {
    clearInterval(keepAlive);
  }
});

test("every Google call is made with a deadline", async () => {
  const { env } = sandbox({ expiresAt: 0 });
  const signals = [];
  const fetchFn = async (url, init) => {
    signals.push(init.signal instanceof AbortSignal);
    return String(url).includes("oauth2") ? jsonResponse({ access_token: "N", expires_in: 3600, scope: SCOPE }) : jsonResponse({ messages: [] });
  };
  await google.mailRecent("personal", "", { fetchFn, env });
  assert.deepEqual(signals, [true, true]);
});

test("mail-thread returns text for HTML-only mail, and prefers plain text when both exist", async () => {
  const { env } = sandbox();
  const html = "<html><style>p{}</style><body><p>Hello &amp; welcome</p><div>Line two<br>Line three</div><script>x()</script></body></html>";
  const only = async () => jsonResponse({ id: "1", messages: [{ id: "a", payload: { mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: b64(html) } }] } }] });
  const out = await google.mailThread("personal", "0a1b2c3d4e5f6a7b", { fetchFn: only, env });
  assert.equal(out.messages[0].body, "Hello & welcome\nLine two\nLine three");
  const both = async () => jsonResponse({ id: "1", messages: [{ id: "a", payload: { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("plain wins") } }, { mimeType: "text/html", body: { data: b64(html) } }] } }] });
  assert.equal((await google.mailThread("personal", "0a1b2c3d4e5f6a7b", { fetchFn: both, env })).messages[0].body, "plain wins");
});

test("a token response without access_token or a valid expires_in is rejected and not saved", async () => {
  for (const body of [{ scope: SCOPE }, { access_token: "N", scope: SCOPE }, { access_token: "N", expires_in: "soon", scope: SCOPE }, { access_token: "N", expires_in: 0, scope: SCOPE }]) {
    const { env } = sandbox({ expiresAt: 0 });
    const before = JSON.stringify(config.loadToken("personal", env));
    await assert.rejects(oauth.accessToken("personal", { fetchFn: async () => jsonResponse(body), env }), { code: "token_error" });
    assert.equal(JSON.stringify(config.loadToken("personal", env)), before);
  }
});

test("mail-recent fetches the messages in parallel and keeps their order", async () => {
  const { env } = sandbox();
  let inFlight = 0;
  let peak = 0;
  const fetchFn = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/messages")) return jsonResponse({ messages: [{ id: "0a1b2c" + "d1" }, { id: "0a1b2c" + "d2" }, { id: "0a1b2c" + "d3" }] });
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 15));
    inFlight--;
    const id = u.pathname.split("/").pop();
    return jsonResponse({ id, threadId: id, payload: { headers: [{ name: "Subject", value: id }] } });
  };
  const out = await google.mailRecent("personal", "", { fetchFn, env });
  assert.deepEqual(out.messages.map((m) => m.id), ["0a1b2cd1", "0a1b2cd2", "0a1b2cd3"]);
  assert.ok(peak > 1, `peak concurrency ${peak}`);
});
