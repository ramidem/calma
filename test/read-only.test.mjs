import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as accounts from "../lib/accounts.mjs";
import * as config from "../lib/config.mjs";
import * as google from "../lib/google.mjs";
import * as oauth from "../lib/oauth.mjs";
import * as uninstallMod from "../lib/uninstall.mjs";
import * as cli from "../calma.mjs";
import { jsonResponse, sandbox } from "./helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("only the two read-only scopes are allowed", () => {
  assert.deepEqual([...config.ALLOWED_SCOPES], ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.readonly"]);
  for (const bad of ["https://mail.google.com/", "https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/calendar.events", "openid"]) {
    assert.throws(() => config.assertScopes([bad]), { code: "scope_refused" });
    assert.throws(() => oauth.buildAuthUrl({ clientId: "x", redirectUri: "http://127.0.0.1:1/callback", state: "s", challenge: "c", scopes: [...config.ALLOWED_SCOPES, bad] }), { code: "scope_refused" });
  }
  assert.doesNotThrow(() => config.assertScopes(config.ALLOWED_SCOPES));
});

test("the auth URL asks for exactly the two read-only scopes", () => {
  const u = new URL(oauth.buildAuthUrl({ clientId: "x", redirectUri: "http://127.0.0.1:1/callback", state: "s", challenge: "c" }));
  assert.equal(u.searchParams.has("login_hint"), false);
  assert.deepEqual(u.searchParams.get("scope").split(" "), [...config.ALLOWED_SCOPES]);
});

test("the code has no send, draft, modify, label, delete or RSVP function", () => {
  const forbidden = /send|draft|modify|label|delete|trash|untrash|rsvp|respond|insert|patch|update|create|import|watch|archive|spam|star/i;
  for (const mod of [accounts, config, google, oauth, uninstallMod, cli]) {
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== "function") continue;
      assert.doesNotMatch(name, forbidden, `exported function ${name}`);
    }
  }
  const sources = ["calma.mjs", ...readdirSync(join(root, "lib")).map((f) => `lib/${f}`)].map((f) => [f, readFileSync(join(root, f), "utf8")]);
  for (const [file, src] of sources) {
    // No write endpoints or write-ish Google paths.
    assert.doesNotMatch(src, /messages\/send|\/drafts|batchModify|\/modify|\/trash|\/labels|\/rsvp|events\/[^"'`]*\/(move|import|quickAdd)|users\/me\/settings/i, `${file} mentions a write endpoint`);
    // The only non-GET method literal is the token exchange POST in oauth.mjs.
    const methods = [...src.matchAll(/(?<![\w])method:\s*["'](\w+)["']/g)].map((m) => m[1]);
    for (const m of methods) assert.ok(m === "GET" || (m === "POST" && file === "lib/oauth.mjs"), `${file} uses method ${m}`);
  }
  // Function declarations in the sources: none named like a write action.
  for (const [file, src] of sources) {
    for (const m of src.matchAll(/(?:function\s+|const\s+)([A-Za-z0-9_]+)\s*(?:=\s*(?:async\s*)?\(|\()/g)) {
      assert.doesNotMatch(m[1], forbidden, `${file}: ${m[1]}`);
    }
  }
});

test("readGet refuses non-GET methods and non-read endpoints", async () => {
  const never = async () => assert.fail("fetch must not be called");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await assert.rejects(google.readGet("https://gmail.googleapis.com/gmail/v1/users/me/messages", "t", { fetchFn: never, method }), { code: "read_only" });
  }
  for (const url of ["https://gmail.googleapis.com/gmail/v1/users/me/messages/send", "https://gmail.googleapis.com/gmail/v1/users/me/messages/0a1b2c3d4e5f6a7b/modify", "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify", "https://gmail.googleapis.com/gmail/v1/users/me/drafts", "https://gmail.googleapis.com/gmail/v1/users/me/labels", "https://www.googleapis.com/calendar/v3/calendars/primary/events/abc/instances", "https://evil.example/gmail/v1/users/me/messages", "http://gmail.googleapis.com/gmail/v1/users/me/messages"]) {
    await assert.rejects(google.readGet(url, "t", { fetchFn: never }), { code: "read_only" }, url);
  }
});

test("the OAuth client file comes from MAIL_CLIENT_FILE, else the config folder", () => {
  assert.equal(config.clientPath({ MAIL_CLIENT_FILE: "/somewhere/else.json", CALMA_DIR: "/cfg" }), "/somewhere/else.json");
  assert.equal(config.clientPath({ CALMA_DIR: "/cfg" }), join("/cfg", "client.json"));
});

test("mail-recent lists then reads metadata, GET only", async () => {
  const { env } = sandbox();
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    const u = new URL(url);
    if (u.pathname.endsWith("/messages")) return jsonResponse({ messages: [{ id: "0a1b2c3d4e5f6a7b" }] });
    return jsonResponse({ id: "0a1b2c3d4e5f6a7b", threadId: "0a1b2c3d4e5f6a7b", snippet: "hi", labelIds: ["INBOX"], payload: { headers: [{ name: "From", value: "sender@example.com" }, { name: "Subject", value: "Hello" }, { name: "Date", value: "Mon" }] } });
  };
  const out = await google.mailRecent("personal", "from:sender@example.com", { fetchFn, env });
  assert.equal(out.count, 1);
  assert.equal(out.messages[0].subject, "Hello");
  assert.ok(calls.every((c) => c.method === "GET"));
  assert.equal(new URL(calls[0].url).searchParams.get("q"), "from:sender@example.com");
});

test("mail-thread decodes the plain-text body and lists attachments by name only", async () => {
  const { env } = sandbox();
  const fetchFn = async () =>
    jsonResponse({ id: "0a1b2c3d4e5f6a7b", messages: [{ id: "0a1b2c3d4e5f6a7b", payload: { headers: [{ name: "Subject", value: "S" }], mimeType: "multipart/mixed", parts: [{ mimeType: "text/plain", body: { data: Buffer.from("hello body").toString("base64url") } }, { mimeType: "application/pdf", filename: "a.pdf", body: { size: 10, attachmentId: "X" } }] } }] });
  const out = await google.mailThread("personal", "0a1b2c3d4e5f6a7b", { fetchFn, env });
  assert.equal(out.messages[0].body, "hello body");
  assert.deepEqual(out.messages[0].attachments, [{ filename: "a.pdf", mimeType: "application/pdf", size: 10 }]);
  await assert.rejects(google.mailThread("personal", "send", { fetchFn, env }), { code: "bad_args" });
});

test("calendar-week asks for Monday to next Monday", async () => {
  const { env } = sandbox();
  let seen;
  const fetchFn = async (url) => {
    seen = new URL(url);
    return jsonResponse({ items: [{ id: "e1", summary: "Standup", start: { dateTime: "2026-11-05T09:00:00+08:00" }, end: { dateTime: "2026-11-05T09:30:00+08:00" }, attendees: [{}, {}] }, { id: "e2", start: { date: "2026-11-06" }, end: { date: "2026-11-07" } }] });
  };
  const out = await google.calendarWeek("personal", { fetchFn, env });
  assert.equal(out.count, 2);
  assert.equal(out.events[0].attendees, 2);
  assert.equal(out.events[1].allDay, true);
  assert.equal(seen.searchParams.get("singleEvents"), "true");
  const { start, end } = google.weekRange(new Date(2026, 10, 5, 15, 0)); // a Thursday
  assert.equal(start.getDay(), 1);
  assert.equal(end.getTime() - start.getTime(), 7 * 24 * 3600 * 1000 - (start.getTimezoneOffset() - end.getTimezoneOffset()) * 60_000);
});

test("the repo's .gitignore keeps token and credential files out", () => {
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  for (const pattern of ["tokens/", "client_secret*.json", "credentials*.json"]) assert.ok(ignore.split("\n").includes(pattern), pattern);
});
