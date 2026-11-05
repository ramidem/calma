import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as cli from "../calma-write.mjs";
import { deleteEvent, writeRequest } from "../lib/write/events.mjs";
import { logPath } from "../lib/write/log.mjs";
import { allowAccount, allowCalendar } from "../lib/write/policy.mjs";
import { WRITE_SCOPE } from "../lib/write/scopes.mjs";
import { saveWriteToken } from "../lib/write/tokens.mjs";
import { jsonResponse, sandbox } from "./helpers.mjs";

const NOW = Date.UTC(2026, 11, 7, 4, 0, 0);
const NOW_ISO = new Date(NOW).toISOString();
const FAR = Date.now() + 10 * 365 * 24 * 3600 * 1000;
const GRANT = `${WRITE_SCOPE} openid https://www.googleapis.com/auth/userinfo.email`;
const ACTAL = `actual-cal${"@"}example.com`;
const EID = "evt1abc2def3ghi4jkl";
const TITLE = "Quarterly lantern inspection with the harbour committee";
const BASE = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${EID}?sendUpdates=none`;

function ready({ calendars = ["primary", ACTAL], accounts = ["me@example.com"], tokens = accounts } = {}) {
  const { env } = sandbox();
  for (const a of accounts) allowAccount(a, env);
  for (const c of calendars) allowCalendar(c, env);
  for (const t of tokens) saveWriteToken(t, { account: t, scope: GRANT, access_token: `WRITE-ACCESS-${t}`, refresh_token: `WRITE-REFRESH-${t}`, expires_at: FAR }, env);
  return env;
}

const MARKER = { calma: "1", calma_actor: "schedule", calma_created: "2026-11-05T01:00:00.000Z" };

/** An event as Google returns it: a marked, timed, 90-minute event. */
const stored = (over = {}) => ({
  id: EID,
  etag: '"etag-5d2b8c1e7f90-unique-0002"',
  status: "confirmed",
  summary: TITLE,
  description: "private notes that must not be logged",
  start: { dateTime: "2026-12-08T09:00:00+08:00", timeZone: "Asia/Manila" },
  end: { dateTime: "2026-12-08T10:30:00+08:00", timeZone: "Asia/Manila" },
  extendedProperties: { private: { ...MARKER, src: "school" } },
  ...over,
});

/**
 * A fetch that records requests. Each GET answers the next item of `reads` (the last one repeats); an item can be an event
 * or a function that returns a response. DELETE answers 204 with no body unless `onDelete` says otherwise.
 */
const google = (reads = [stored()], { onDelete } = {}) => {
  const calls = [];
  let gets = 0;
  const fetchFn = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    if (init.method === "GET") {
      const next = reads[Math.min(gets++, reads.length - 1)];
      return typeof next === "function" ? next() : jsonResponse(next);
    }
    if (onDelete) return onDelete();
    return { ok: true, status: 204, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } };
  };
  return { calls, fetchFn };
};

const del = (over = {}) => ({ id: EID, actor: "schedule", ...over });
const never = async () => assert.fail("no request expected");
const logLines = (env) => readFileSync(logPath(env), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const methods = (calls) => calls.map((c) => c.method);

test("a dry run sends one GET, shows the event and what would go, and sends no DELETE or log line", async () => {
  const env = ready();
  const { calls, fetchFn } = google();
  const out = await deleteEvent(del(), { env, fetchFn, now: () => NOW });
  assert.equal(out.event, "dry_run");
  assert.equal(out.operation, "delete");
  assert.equal(out.account, "me@example.com");
  assert.equal(out.calendar, "primary");
  assert.equal(out.id, EID);
  assert.equal(out.summary, TITLE);
  assert.deepEqual(out.start, { dateTime: "2026-12-08T09:00:00+08:00" });
  assert.deepEqual(out.end, { dateTime: "2026-12-08T10:30:00+08:00" });
  assert.equal(out.calma_event, true);
  assert.equal(typeof out.would_delete, "string");
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [["GET", BASE]]);
  assert.equal(existsSync(logPath(env)), false);
  assert.ok(!JSON.stringify(out).includes("WRITE-") && !JSON.stringify(out).includes("etag"), "no token or etag in the output");
});

test("--yes sends GET, GET, DELETE in that order: exact DELETE URL, sendUpdates=none, no body, no If-Match", async () => {
  const env = ready();
  const { calls, fetchFn } = google();
  const out = await deleteEvent(del(), { yes: true, env, fetchFn, now: () => NOW });
  assert.deepEqual(methods(calls), ["GET", "GET", "DELETE"]);
  const [first, fresh, remove] = calls;
  assert.equal(first.url, BASE);
  assert.equal(fresh.url, BASE);
  assert.equal(remove.url, BASE);
  assert.equal(new URL(remove.url).searchParams.get("sendUpdates"), "none");
  assert.equal(remove.body, undefined);
  assert.equal(remove.headers["if-match"], undefined);
  assert.equal(remove.headers.authorization, "Bearer WRITE-ACCESS-me@example.com");
  assert.deepEqual(out, { event: "deleted", id: EID, summary: TITLE, start: { dateTime: "2026-12-08T09:00:00+08:00" }, end: { dateTime: "2026-12-08T10:30:00+08:00" }, calma_event: true });
  assert.ok(!JSON.stringify(out).includes("WRITE-"), "no token in the output");
});

test("the write log gets one line per applied delete: ids and actor, never the title; a dry run logs nothing", async () => {
  const env = ready();
  await deleteEvent(del(), { env, fetchFn: google().fetchFn, now: () => NOW }); // dry run
  assert.equal(existsSync(logPath(env)), false);
  await deleteEvent(del({ actor: "parenting" }), { yes: true, env, fetchFn: google().fetchFn, now: () => NOW });
  const raw = readFileSync(logPath(env), "utf8");
  assert.equal(raw.trim().split("\n").length, 1);
  assert.deepEqual(logLines(env)[0], { at: NOW_ISO, op: "delete", account: "me@example.com", calendar: "primary", event_id: EID, actor: "parenting" });
  assert.ok(!raw.includes("lantern") && !raw.includes("harbour") && !raw.includes("notes"), "no title or description in the log");
});

test("an unmarked event is refused unless --any-event, and --any-event does not add the marker", async () => {
  const env = ready();
  for (const priv of [undefined, { src: "school" }, { ...MARKER, calma: "0" }]) {
    const event = stored({ extendedProperties: priv ? { private: priv } : undefined });
    const { calls, fetchFn } = google([event]);
    await assert.rejects(deleteEvent(del(), { yes: true, env, fetchFn, now: () => NOW }), { code: "not_a_calma_event" });
    assert.deepEqual(methods(calls), ["GET"], "refused after the read, before any DELETE");
    await assert.rejects(deleteEvent(del(), { env, fetchFn, now: () => NOW }), { code: "not_a_calma_event" }, "a dry run is refused too");
  }
  assert.equal(existsSync(logPath(env)), false);
  const event = stored({ extendedProperties: { private: { src: "school" } } });
  const dry = await deleteEvent(del({ anyEvent: true }), { env, fetchFn: google([event]).fetchFn, now: () => NOW });
  assert.equal(dry.calma_event, false);
  const { calls, fetchFn } = google([event]);
  const out = await deleteEvent(del({ anyEvent: true }), { yes: true, env, fetchFn, now: () => NOW });
  assert.equal(out.event, "deleted");
  assert.equal(out.calma_event, false);
  assert.deepEqual(methods(calls), ["GET", "GET", "DELETE"]);
  assert.ok(calls.every((c) => c.body === undefined), "nothing was written to the event before it went");
  assert.equal(logLines(env).length, 1);
});

test("guests, repeating events and cancelled events are always refused, even with --any-event, and no DELETE is sent", async () => {
  const env = ready();
  const cases = [
    ["has_guests", { attendees: [{ email: "guest@example.com" }] }],
    ["has_guests", { attendees: [{ email: "me@example.com", self: true }] }],
    ["recurring_event", { recurrence: ["RRULE:FREQ=WEEKLY"] }],
    ["recurring_event", { recurringEventId: "evt9series0001" }],
    ["event_cancelled", { status: "cancelled" }],
  ];
  for (const [code, extra] of cases) {
    for (const anyEvent of [false, true]) {
      for (const yes of [false, true]) {
        const { calls, fetchFn } = google([stored(extra)]);
        await assert.rejects(deleteEvent(del({ anyEvent }), { yes, env, fetchFn, now: () => NOW }), { code }, `${code} anyEvent=${anyEvent} yes=${yes}`);
        assert.deepEqual(methods(calls), ["GET"]);
      }
    }
  }
  // Also when the event is not marked: the always-refused reason wins.
  const unmarked = google([stored({ extendedProperties: undefined, attendees: [{ email: "guest@example.com" }] })]);
  await assert.rejects(deleteEvent(del(), { yes: true, env, fetchFn: unmarked.fetchFn }), { code: "has_guests" });
  assert.equal(existsSync(logPath(env)), false);
});

test("the fresh read decides: an event that gained guests, a series or a cancellation after the preview is refused, and no DELETE is sent", async () => {
  const env = ready();
  const changed = [
    ["has_guests", stored({ attendees: [{ email: "guest@example.com" }] })],
    ["recurring_event", stored({ recurringEventId: "evt9series0001" })],
    ["event_cancelled", stored({ status: "cancelled" })],
    ["not_a_calma_event", stored({ extendedProperties: { private: { src: "school" } } })],
  ];
  for (const [code, after] of changed) {
    const { calls, fetchFn } = google([stored(), after]);
    await assert.rejects(deleteEvent(del(), { yes: true, env, fetchFn, now: () => NOW }), { code }, code);
    assert.deepEqual(methods(calls), ["GET", "GET"], "stopped at the fresh read");
  }
  // The output and the title shown come from the fresh read too.
  const { fetchFn } = google([stored(), stored({ summary: "Renamed after the preview" })]);
  const out = await deleteEvent(del(), { yes: true, env, fetchFn, now: () => NOW });
  assert.equal(out.summary, "Renamed after the preview");
  assert.equal(logLines(env).length, 1, "only the successful delete was logged");
});

test("404 or 410 on the first read, the fresh read or the DELETE is not_found, and nothing is logged", async () => {
  const env = ready();
  const missing = (status) => () => jsonResponse({ error: { code: status, status: "NOT_FOUND", message: "Bearer WRITE-ACCESS-LEAK" } }, status);
  for (const status of [404, 410]) {
    const msg = (e) => e.code === "not_found" && e.message === "That event does not exist or is already deleted." && !e.message.includes("LEAK");
    let { calls, fetchFn } = google([missing(status)]);
    await assert.rejects(deleteEvent(del(), { yes: true, env, fetchFn, now: () => NOW }), msg, `first read ${status}`);
    assert.deepEqual(methods(calls), ["GET"]);
    ({ calls, fetchFn } = google([stored(), missing(status)]));
    await assert.rejects(deleteEvent(del(), { yes: true, env, fetchFn, now: () => NOW }), msg, `fresh read ${status}`);
    assert.deepEqual(methods(calls), ["GET", "GET"]);
    ({ calls, fetchFn } = google([stored()], { onDelete: missing(status) }));
    await assert.rejects(deleteEvent(del(), { yes: true, env, fetchFn, now: () => NOW }), msg, `DELETE ${status}`);
    assert.deepEqual(methods(calls), ["GET", "GET", "DELETE"]);
  }
  assert.equal(existsSync(logPath(env)), false);
});

test("other Google errors map like the rest, on the reads and on the DELETE, and never echo a token", async () => {
  const env = ready();
  const failing = (status, body, where) => async (url, init) => (init.method === where ? jsonResponse(body, status) : jsonResponse(stored()));
  for (const where of ["GET", "DELETE"]) {
    const run = (status, body) => deleteEvent(del(), { yes: true, env, fetchFn: failing(status, body, where), now: () => NOW });
    await assert.rejects(run(401, {}), { code: "reauth_needed" }, where);
    await assert.rejects(run(403, { error: { status: "PERMISSION_DENIED", message: "Bearer WRITE-ACCESS-LEAK" } }), (e) => e.code === "google_error" && /PERMISSION_DENIED/.test(e.message) && !e.message.includes("LEAK"), where);
    await assert.rejects(run(500, {}), { code: "google_error" }, where);
  }
  assert.equal(existsSync(logPath(env)), false, "nothing logged for failures");
});

test("a 400 names the rejected field and never Google's message", async () => {
  const env = ready();
  const body = { error: { status: "INVALID_ARGUMENT", message: "Bearer WRITE-ACCESS-LEAK", errors: [{ reason: "invalid", location: "sendUpdates", message: "WRITE-ACCESS-LEAK" }] } };
  const fetchFn = async (url, init) => (init.method === "DELETE" ? jsonResponse(body, 400) : jsonResponse(stored()));
  await assert.rejects(deleteEvent(del(), { yes: true, env, fetchFn, now: () => NOW }), { code: "google_error", message: "Google answered 400 (invalid) for field sendUpdates." });
  assert.equal(existsSync(logPath(env)), false);
});

test("a stalled response body or request ends as a timeout, and nothing is logged", async () => {
  const env = ready();
  const stalled = { ok: true, status: 200, json: async () => { throw new DOMException("timeout", "TimeoutError"); } };
  await assert.rejects(deleteEvent(del(), { yes: true, env, fetchFn: async () => stalled }), { code: "timeout" }, "first read");
  await assert.rejects(deleteEvent(del(), { env, fetchFn: async () => stalled }), { code: "timeout" }, "dry run read");
  const second = google([stored(), () => stalled]);
  await assert.rejects(deleteEvent(del(), { yes: true, env, fetchFn: second.fetchFn }), { code: "timeout" }, "fresh read");
  const fetchFn = async (url, init) => {
    if (init.method === "GET") return jsonResponse(stored());
    throw new DOMException("timeout", "TimeoutError");
  };
  await assert.rejects(deleteEvent(del(), { yes: true, env, fetchFn }), { code: "timeout" }, "DELETE");
  assert.equal(existsSync(logPath(env)), false);
});

test("allow-list and input failures happen before any request", async () => {
  const bad = (over, code, opts) => assert.rejects(deleteEvent(del(over), { yes: true, fetchFn: never, now: () => NOW, ...opts }), { code }, JSON.stringify(over));
  const env = ready();
  await bad({ account: "you@example.com" }, "account_not_allowed", { env });
  await bad({}, "calendar_not_allowed", { env: ready({ calendars: [] }) });
  await bad({ calendar: "other-cal@example.com" }, "calendar_not_allowed", { env });
  await bad({ calendar: "../primary" }, "bad_calendar", { env });
  await bad({ calendar: "primary/acl" }, "bad_calendar", { env });
  await bad({}, "reauth_needed", { env: ready({ tokens: [] }) });
  await bad({}, "account_required", { env: ready({ accounts: ["me@example.com", "you@example.com"] }) });
  await bad({ actor: undefined }, "bad_event", { env });
  await bad({ actor: "Schedule Bot" }, "bad_event", { env });
  await bad({ actor: "" }, "bad_event", { env });
  // The chosen calendar is used, percent-encoded.
  const { calls, fetchFn } = google();
  await deleteEvent(del({ calendar: ACTAL }), { yes: true, env, fetchFn, now: () => NOW });
  const expected = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ACTAL)}/events/${EID}?sendUpdates=none`;
  assert.deepEqual(calls.map((c) => c.url), [expected, expected, expected]);
  assert.equal(logLines(env)[0].calendar, ACTAL);
});

test("a bad event id is refused before any request", async () => {
  const env = ready();
  for (const id of [undefined, "", "abc", "EVT1ABC2DEF3", "evt1/abc2def", "evt1abc2def3ghi4jklw", "../acl", "evt1abc2%2Fdef", "evt1abc2def?x=1", `${"a".repeat(1025)}`, 12345]) {
    await assert.rejects(deleteEvent(del({ id }), { yes: true, env, fetchFn: never }), { code: "bad_event" }, String(id));
  }
});

test("the request layer allows DELETE only on /events/<id>, with no body and no If-Match; PUT and every other path stay refused", async () => {
  const { calls, fetchFn } = google();
  const call = (over) => writeRequest({ method: "DELETE", calendar: "primary", rest: `/events/${EID}`, token: "T", ...over }, { fetchFn });
  for (const rest of ["/events", "/events/", "/events/abc", "/events/EVT1ABC2DEF3", `/events/${EID}/instances`, `/events/${EID}/move`, `/events/${EID}?x=1`, `/events/${EID}/../acl`, "/acl", "/acl/user:x", "/settings", "/clear", ""]) {
    await assert.rejects(call({ rest }), { code: "write_refused" }, rest);
  }
  for (const method of ["PUT", "HEAD", "delete", "Delete", "OPTIONS", ""]) await assert.rejects(call({ method }), { code: "write_refused" }, method);
  await assert.rejects(call({ body: {} }), { code: "write_refused" }, "no body on DELETE");
  await assert.rejects(call({ body: { summary: "x" } }), { code: "write_refused" }, "no body on DELETE");
  await assert.rejects(call({ ifMatch: '"etag-5d2b8c1e7f90-unique-0002"' }), { code: "write_refused" }, "no If-Match on DELETE");
  await assert.rejects(call({ calendar: "../acl" }), { code: "bad_calendar" });
  assert.equal(calls.length, 0, "nothing reached the network");
  assert.deepEqual(await call({ query: { sendUpdates: "all" } }), {}, "a 204 answer is an empty result");
  assert.equal(new URL(calls[0].url).searchParams.get("sendUpdates"), "none");
  assert.equal(calls[0].method, "DELETE");
});

test("the command: --yes applies, no --yes previews; options that do not belong to calendar-delete are refused", async () => {
  const env = ready();
  const { calls, fetchFn } = google();
  const run = async (argv) => {
    const lines = [];
    await cli.run(argv, { env, fetchFn, emit: (o) => lines.push(o), now: () => NOW });
    return lines;
  };
  const base = ["calendar-delete", EID, "--actor", "parenting"];
  assert.equal((await run(base))[0].event, "dry_run");
  assert.deepEqual(methods(calls), ["GET"]);
  const done = await run([...base, "--yes", "--calendar", "primary", "--account", "me@example.com"]);
  assert.equal(done[0].event, "deleted");
  assert.equal(done[0].summary, TITLE);
  assert.deepEqual(methods(calls), ["GET", "GET", "GET", "DELETE"]);
  assert.equal(logLines(env)[0].actor, "parenting");
  const before = calls.length;
  const withValue = ["--title", "--start", "--end", "--description", "--location", "--key", "--prop", "--attendee", "--attendees", "--recurrence", "--invite", "--send-updates", "--conference", "--status", "--id"];
  for (const unsafe of withValue) await assert.rejects(run([...base, unsafe, "x=1"]), { code: "usage" }, unsafe);
  for (const unsafe of ["--busy", "--public", "--free", "--private", "--all-day"]) await assert.rejects(run([...base, unsafe]), { code: "usage" }, unsafe);
  await assert.rejects(run(["calendar-delete", "--actor", "schedule"]), { code: "usage" }, "no event id");
  await assert.rejects(run([...base, "evt2abc3def4"]), { code: "usage" }, "two event ids");
  await assert.rejects(run(["calendar-delete", EID]), { code: "bad_event" }, "no actor");
  await assert.rejects(run(["calendar-delete", "abc", "--actor", "schedule", "--yes"]), { code: "bad_event" }, "bad event id");
  assert.equal(calls.length, before, "none of these reached the network");
  // Delete-only options are not silently accepted by the other commands; --any-event is update's and delete's only.
  await assert.rejects(run(["calendar-create", "--title", "x", "--start", "2026-12-08T09:00:00+08:00", "--end", "2026-12-08T10:00:00+08:00", "--actor", "schedule", "--any-event"]), { code: "usage" });
  assert.equal(calls.length, before);
});

test("--any-event on the command line lets an unmarked event through, and only that", async () => {
  const env = ready();
  const { calls, fetchFn } = google([stored({ extendedProperties: undefined })]);
  const argv = ["calendar-delete", EID, "--actor", "schedule", "--yes"];
  await assert.rejects(cli.run(argv, { env, fetchFn, emit() {}, now: () => NOW }), { code: "not_a_calma_event" });
  assert.deepEqual(methods(calls), ["GET"]);
  const out = [];
  await cli.run([...argv, "--any-event"], { env, fetchFn, emit: (o) => out.push(o), now: () => NOW });
  assert.deepEqual(methods(calls), ["GET", "GET", "GET", "DELETE"]);
  assert.equal(out[0].calma_event, false);
  assert.equal(logLines(env).length, 1);
  // Guests are still refused with --any-event on the command line.
  const guests = google([stored({ attendees: [{ email: "guest@example.com" }] })]);
  await assert.rejects(cli.run([...argv, "--any-event"], { env, fetchFn: guests.fetchFn, emit() {}, now: () => NOW }), { code: "has_guests" });
  assert.deepEqual(methods(guests.calls), ["GET"]);
});
