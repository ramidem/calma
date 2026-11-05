import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as cli from "../calma-write.mjs";
import { updateEvent, writeRequest } from "../lib/write/events.mjs";
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
const ETAG = '"etag-7c1d9e4f2a8b-unique-0001"';
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
  etag: ETAG,
  status: "confirmed",
  summary: "Focus block",
  description: "old notes",
  location: "Room one",
  start: { dateTime: "2026-12-08T09:00:00+08:00", timeZone: "Asia/Manila" },
  end: { dateTime: "2026-12-08T10:30:00+08:00", timeZone: "Asia/Manila" },
  transparency: "opaque",
  visibility: "default",
  extendedProperties: { private: { ...MARKER, src: "school" }, shared: { other: "keep" } },
  ...over,
});

const allDayStored = (over = {}) => stored({ start: { date: "2026-12-08" }, end: { date: "2026-12-10" }, ...over });

/** A fetch that records requests; GET answers `event`, PATCH answers the event with the body applied. */
const google = (event = stored(), { onPatch } = {}) => {
  const calls = [];
  const fetchFn = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method: init.method, headers: init.headers, body });
    if (init.method === "GET") return jsonResponse(event);
    if (onPatch) return onPatch(body);
    return jsonResponse({ ...event, ...body });
  };
  return { calls, fetchFn };
};

const update = (over = {}) => ({ id: EID, actor: "schedule", ...over });
const never = async () => assert.fail("no request expected");
const logLines = (env) => readFileSync(logPath(env), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a dry run reads the event, shows before and after, and sends no PATCH or log line", async () => {
  const env = ready();
  const { calls, fetchFn } = google();
  const out = await updateEvent(update({ title: "Deep work", description: "new notes", free: true }), { env, fetchFn, now: () => NOW });
  assert.equal(out.event, "dry_run");
  assert.equal(out.operation, "update");
  assert.equal(out.account, "me@example.com");
  assert.equal(out.calendar, "primary");
  assert.equal(out.id, EID);
  assert.equal(out.calma_event, true);
  assert.deepEqual(out.changes, {
    summary: { before: "Focus block", after: "Deep work" },
    description: { before: "old notes", after: "new notes" },
    transparency: { before: "opaque", after: "transparent" },
  });
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [["GET", BASE]]);
  assert.equal(existsSync(logPath(env)), false);
  assert.ok(!JSON.stringify(out).includes("WRITE-"), "no token in the output");
});

test("--yes sends one GET then one PATCH: exact URL, If-Match from the GET, only the changed fields, merged private map", async () => {
  const env = ready();
  const { calls, fetchFn } = google();
  const out = await updateEvent(update({ title: "Deep work", location: "Room two", private: true, props: { src: "home", extra: "v1" } }), { yes: true, env, fetchFn, now: () => NOW });
  assert.deepEqual(calls.map((c) => c.method), ["GET", "PATCH"]);
  const [, patch] = calls;
  assert.equal(patch.url, BASE);
  assert.equal(patch.headers["if-match"], ETAG);
  assert.equal(patch.headers.authorization, "Bearer WRITE-ACCESS-me@example.com");
  assert.equal(calls[0].headers["if-match"], undefined, "the GET carries no If-Match");
  assert.deepEqual(patch.body, {
    summary: "Deep work",
    location: "Room two",
    visibility: "private",
    extendedProperties: { private: { ...MARKER, src: "home", extra: "v1", calma_updated: NOW_ISO, calma_updated_by: "schedule" } },
  });
  assert.deepEqual(out.changed, ["summary", "location", "visibility", "properties"]);
  assert.equal(out.event, "updated");
  assert.equal(out.id, EID);
  assert.equal(out.summary, "Deep work");
  assert.deepEqual(Object.keys(out).sort(), ["changed", "end", "event", "id", "start", "summary"]);
  assert.ok(!JSON.stringify(out).includes("WRITE-") && !JSON.stringify(out).includes("etag"), "no token or etag in the output");
});

test("the write log gets one line per applied update: ids and actor, never a title", async () => {
  const env = ready();
  await updateEvent(update({ title: "Secret meeting title", actor: "parenting" }), { yes: true, env, fetchFn: google().fetchFn, now: () => NOW });
  await updateEvent(update({ title: "Another secret title" }), { env, fetchFn: google().fetchFn, now: () => NOW }); // dry run
  const lines = readFileSync(logPath(env), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { at: NOW_ISO, op: "update", account: "me@example.com", calendar: "primary", event_id: EID, actor: "parenting" });
  assert.ok(!lines[0].includes("secret") && !lines[0].includes("Secret"));
});

test("a marked event is updated freely; an unmarked one needs --any-event and does not gain the marker", async () => {
  const env = ready();
  for (const priv of [undefined, { src: "school" }, { ...MARKER, calma: "0" }]) {
    const event = stored({ extendedProperties: priv ? { private: priv } : undefined });
    const { calls, fetchFn } = google(event);
    await assert.rejects(updateEvent(update({ title: "New" }), { yes: true, env, fetchFn, now: () => NOW }), { code: "not_a_calma_event" });
    assert.deepEqual(calls.map((c) => c.method), ["GET"], "refused after the read, before any PATCH");
    await assert.rejects(updateEvent(update({ title: "New" }), { env, fetchFn, now: () => NOW }), { code: "not_a_calma_event" }, "a dry run is refused too");
  }
  const { calls, fetchFn } = google(stored({ extendedProperties: { private: { src: "school" } } }));
  const out = await updateEvent(update({ title: "New", anyEvent: true }), { yes: true, env, fetchFn, now: () => NOW });
  assert.equal(out.event, "updated");
  assert.deepEqual(calls[1].body.extendedProperties.private, { src: "school", calma_updated: NOW_ISO, calma_updated_by: "schedule" });
});

test("guests, repeating events and cancelled events are always refused, even with --any-event, and nothing is patched", async () => {
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
      const { calls, fetchFn } = google(stored(extra));
      await assert.rejects(updateEvent(update({ title: "New", anyEvent }), { yes: true, env, fetchFn, now: () => NOW }), { code }, `${code} anyEvent=${anyEvent}`);
      assert.deepEqual(calls.map((c) => c.method), ["GET"]);
    }
  }
  // Also when the event is not marked: the always-refused reason wins.
  const unmarked = google(stored({ extendedProperties: undefined, attendees: [{ email: "guest@example.com" }] }));
  await assert.rejects(updateEvent(update({ title: "New" }), { yes: true, env, fetchFn: unmarked.fetchFn }), { code: "has_guests" });
  assert.equal(existsSync(logPath(env)), false);
});

test("--prop can never touch the marker or the update stamps; they are refused before any request", async () => {
  const env = ready();
  for (const name of ["calma", "calma_actor", "calma_created", "calma_updated", "calma_updated_by", "CALMA", "calma_other"]) {
    await assert.rejects(updateEvent(update({ props: { [name]: "x" } }), { yes: true, env, fetchFn: never }), { code: "bad_event" }, name);
  }
  for (const [k, v] of [["bad key", "v"], ["k", "x".repeat(201)]]) await assert.rejects(updateEvent(update({ props: { [k]: v } }), { env, fetchFn: never }), { code: "bad_event" }, k);
  // Even a hostile stored marker is kept as read, never replaced by caller input.
  const { calls, fetchFn } = google();
  await updateEvent(update({ props: { src: "x" } }), { yes: true, env, fetchFn, now: () => NOW });
  const sent = calls[1].body.extendedProperties.private;
  for (const k of Object.keys(MARKER)) assert.equal(sent[k], MARKER[k]);
  assert.equal(sent.calma_updated, NOW_ISO);
  assert.equal(sent.calma_updated_by, "schedule");
});

test("a 412 on the PATCH becomes changed_meanwhile and is not logged", async () => {
  const env = ready();
  const { calls, fetchFn } = google(stored(), { onPatch: () => jsonResponse({ error: { code: 412, status: "FAILED_PRECONDITION", message: "Bearer WRITE-ACCESS-LEAK" } }, 412) });
  await assert.rejects(updateEvent(update({ title: "New" }), { yes: true, env, fetchFn, now: () => NOW }), (e) => e.code === "changed_meanwhile" && /changed since it was read/.test(e.message) && !e.message.includes("LEAK"));
  assert.equal(calls.length, 2);
  assert.equal(existsSync(logPath(env)), false);
});

test("Google errors map like create, on the read and on the update, and never echo a token", async () => {
  const env = ready();
  const failing = (status, body, where) => async (url, init) => (init.method === where ? jsonResponse(body, status) : jsonResponse(stored()));
  for (const where of ["GET", "PATCH"]) {
    const run = (status, body) => updateEvent(update({ title: "New" }), { yes: true, env, fetchFn: failing(status, body, where), now: () => NOW });
    await assert.rejects(run(401, {}), { code: "reauth_needed" }, where);
    await assert.rejects(run(403, { error: { status: "PERMISSION_DENIED", message: "Bearer WRITE-ACCESS-LEAK" } }), (e) => e.code === "google_error" && /PERMISSION_DENIED/.test(e.message) && !e.message.includes("LEAK"), where);
    await assert.rejects(run(404, {}), { code: "google_error" }, where);
  }
  assert.equal(existsSync(logPath(env)), false, "nothing logged for failures");
});

test("a stalled response body ends as a timeout, on the read and on the update", async () => {
  const env = ready();
  const stalled = { ok: true, status: 200, json: async () => { throw new DOMException("timeout", "TimeoutError"); } };
  await assert.rejects(updateEvent(update({ title: "New" }), { yes: true, env, fetchFn: async () => stalled }), { code: "timeout" });
  const fetchFn = async (url, init) => (init.method === "GET" ? jsonResponse(stored()) : stalled);
  await assert.rejects(updateEvent(update({ title: "New" }), { yes: true, env, fetchFn }), { code: "timeout" });
  assert.equal(existsSync(logPath(env)), false);
});

test("a change that changes nothing is nothing_to_change (no options at all fails before any request)", async () => {
  const env = ready();
  await assert.rejects(updateEvent(update(), { yes: true, env, fetchFn: never }), { code: "nothing_to_change" });
  const same = [
    { title: "Focus block" },
    { description: "old notes", location: "Room one" },
    { start: "2026-12-08T09:00:00+08:00" },
    { start: "2026-12-08T01:00:00Z", end: "2026-12-08T02:30:00Z" }, // the same instants in another offset
    { busy: true, public: false },
    { props: { src: "school" } },
  ];
  for (const over of same) {
    const { calls, fetchFn } = google();
    await assert.rejects(updateEvent(update({ ...over, visibility: undefined }), { yes: true, env, fetchFn, now: () => NOW }), { code: "nothing_to_change" }, JSON.stringify(over));
    assert.deepEqual(calls.map((c) => c.method), ["GET"], "no PATCH for a no-op");
  }
  // Only the fields that really differ are sent.
  const { calls, fetchFn } = google();
  const out = await updateEvent(update({ title: "Focus block", location: "Room two" }), { yes: true, env, fetchFn, now: () => NOW });
  assert.deepEqual(out.changed, ["location"]);
  assert.deepEqual(Object.keys(calls[1].body).sort(), ["extendedProperties", "location"]);
  assert.equal(existsSync(logPath(env)), true);
  assert.equal(logLines(env).length, 1);
});

test("an empty value is refused, not used to clear a field; contradictory switches are refused", async () => {
  const env = ready();
  for (const over of [{ title: "" }, { description: "" }, { location: "" }, { title: "x".repeat(1001) }, { description: "x".repeat(8001) }, { free: true, busy: true }, { private: true, public: true }, { allDay: true }]) {
    await assert.rejects(updateEvent(update(over), { yes: true, env, fetchFn: never }), { code: "bad_event" }, JSON.stringify(over));
  }
});

test("a new start without an end keeps the event's length (timed: in the new offset; all-day: the same number of days)", async () => {
  const env = ready();
  const go = async (event, over) => {
    const { calls, fetchFn } = google(event);
    const out = await updateEvent(update(over), { yes: true, env, fetchFn, now: () => NOW });
    return { body: calls[1].body, out };
  };
  // 90 minutes: 09:00+08:00 -> 14:00+08:00 gives 15:30+08:00.
  let r = await go(stored(), { start: "2026-12-09T14:00:00+08:00" });
  assert.deepEqual(r.body.start, { dateTime: "2026-12-09T14:00:00+08:00" });
  assert.deepEqual(r.body.end, { dateTime: "2026-12-09T15:30:00+08:00" });
  assert.deepEqual(r.out.changed, ["start", "end"]);
  // The new start is in UTC: the end is written in UTC too, and crosses midnight correctly.
  r = await go(stored(), { start: "2026-12-09T23:00:00Z" });
  assert.deepEqual(r.body.end, { dateTime: "2026-12-10T00:30:00Z" });
  // A negative offset.
  r = await go(stored(), { start: "2026-12-09T20:15:00-05:00" });
  assert.deepEqual(r.body.end, { dateTime: "2026-12-09T21:45:00-05:00" });
  // All-day, two days long.
  r = await go(allDayStored(), { start: "2026-12-30", allDay: true });
  assert.deepEqual(r.body.start, { date: "2026-12-30" });
  assert.deepEqual(r.body.end, { date: "2027-01-01" });
  // An explicit end wins; an end alone keeps the start.
  r = await go(stored(), { start: "2026-12-09T14:00:00+08:00", end: "2026-12-09T14:30:00+08:00" });
  assert.deepEqual(r.body.end, { dateTime: "2026-12-09T14:30:00+08:00" });
  r = await go(stored(), { end: "2026-12-08T12:00:00+08:00" });
  assert.equal(r.body.start, undefined);
  assert.deepEqual(r.body.end, { dateTime: "2026-12-08T12:00:00+08:00" });
  r = await go(allDayStored(), { end: "2026-12-11", allDay: true });
  assert.equal(r.body.start, undefined);
  assert.deepEqual(r.body.end, { date: "2026-12-11" });
});

test("times are validated like create: offset required, real dates, end after start", async () => {
  const env = ready();
  const bad = async (over) => assert.rejects(updateEvent(update(over), { yes: true, env, fetchFn: google().fetchFn, now: () => NOW }), { code: "bad_event" }, JSON.stringify(over));
  await bad({ start: "2026-12-09 14:00" });
  await bad({ start: "2026-12-09T14:00:00" });
  await bad({ start: "soon" });
  await bad({ start: "2026-02-30T09:00:00+08:00" });
  await bad({ start: "2026-12-09T24:00:00+08:00" });
  await bad({ end: "2026-12-08T09:00:00+08:00" }); // equals the start
  await bad({ end: "2026-12-08T08:00:00+08:00" }); // before the start
  await bad({ start: "2026-12-09T14:00:00+08:00", end: "2026-12-09T13:00:00+08:00" });
  await bad({ start: "2026-12-09T14:00:00+08:00", allDay: true }); // a time given with --all-day
  await bad({ start: "2026-02-30", allDay: true });
  await bad({ start: "2026-12-09" }); // a date without --all-day
});

test("switching between timed and all-day needs --start, and clears the other field", async () => {
  const env = ready();
  // timed -> all-day: end defaults to the next day.
  let { calls, fetchFn } = google();
  await updateEvent(update({ start: "2026-12-12", allDay: true }), { yes: true, env, fetchFn, now: () => NOW });
  assert.deepEqual(calls[1].body.start, { date: "2026-12-12", dateTime: null });
  assert.deepEqual(calls[1].body.end, { date: "2026-12-13", dateTime: null });
  // all-day -> timed: both times are needed.
  ({ calls, fetchFn } = google(allDayStored()));
  await assert.rejects(updateEvent(update({ start: "2026-12-12T09:00:00+08:00" }), { yes: true, env, fetchFn }), { code: "bad_event" });
  await assert.rejects(updateEvent(update({ end: "2026-12-12T10:00:00+08:00" }), { yes: true, env, fetchFn }), { code: "bad_event" });
  await updateEvent(update({ start: "2026-12-12T09:00:00+08:00", end: "2026-12-12T10:00:00+08:00" }), { yes: true, env, fetchFn, now: () => NOW });
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 1, "the refused attempts sent no PATCH");
  const sent = calls.at(-1).body;
  assert.deepEqual(sent.start, { dateTime: "2026-12-12T09:00:00+08:00", date: null });
  assert.deepEqual(sent.end, { dateTime: "2026-12-12T10:00:00+08:00", date: null });
});

test("allow-list and input failures happen before any request", async () => {
  const bad = (over, code, opts) => assert.rejects(updateEvent(update(over), { yes: true, fetchFn: never, now: () => NOW, ...opts }), { code }, JSON.stringify(over));
  const env = ready();
  await bad({ title: "x", account: "you@example.com" }, "account_not_allowed", { env });
  await bad({ title: "x" }, "calendar_not_allowed", { env: ready({ calendars: [] }) });
  await bad({ title: "x", calendar: "other-cal@example.com" }, "calendar_not_allowed", { env });
  await bad({ title: "x", calendar: "../primary" }, "bad_calendar", { env });
  await bad({ title: "x", calendar: "primary/acl" }, "bad_calendar", { env });
  await bad({ title: "x" }, "reauth_needed", { env: ready({ tokens: [] }) });
  await bad({ title: "x" }, "account_required", { env: ready({ accounts: ["me@example.com", "you@example.com"] }) });
  for (const id of [undefined, "", "abc", "EVT1ABC2DEF3", "evt1/abc2def", "evt1abc2def3ghi4jklw", "../acl", "evt1abc2%2Fdef", `${"a".repeat(1025)}`]) await bad({ id, title: "x" }, "bad_event", { env });
  await bad({ title: "x", actor: undefined }, "bad_event", { env });
  await bad({ title: "x", actor: "Schedule Bot" }, "bad_event", { env });
  // The chosen calendar is used, percent-encoded.
  const { calls, fetchFn } = google();
  await updateEvent(update({ title: "x", calendar: ACTAL }), { yes: true, env, fetchFn, now: () => NOW });
  assert.equal(calls[0].url, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ACTAL)}/events/${EID}?sendUpdates=none`);
  assert.equal(calls[1].url, calls[0].url);
});

test("the request layer allows GET and PATCH of one event; DELETE only on /events/<id>, PUT never, and every other path is refused", async () => {
  const { calls, fetchFn } = google();
  const call = (over) => writeRequest({ method: "GET", calendar: "primary", rest: `/events/${EID}`, token: "T", ...over }, { fetchFn });
  const patch = (over) => call({ method: "PATCH", body: { summary: "x" }, ifMatch: ETAG, ...over });
  for (const method of ["PUT", "HEAD", "get", "delete"]) await assert.rejects(call({ method }), { code: "write_refused" }, method);
  await assert.rejects(call({ method: "DELETE", rest: "/events" }), { code: "write_refused" }, "DELETE of the collection");
  await assert.rejects(call({ method: "DELETE", rest: "/acl" }), { code: "write_refused" }, "DELETE of another path");
  await assert.rejects(call({ method: "DELETE", rest: `/events/${EID}/instances` }), { code: "write_refused" }, "DELETE below an event");
  for (const rest of ["/events", "/events/", "/events/abc", "/events/EVT1ABC2DEF3", `/events/${EID}/instances`, `/events/${EID}/move`, `/events/${EID}?x=1`, `/events/${EID}/../acl`, "/acl", "/settings", ""]) {
    await assert.rejects(call({ rest }), { code: "write_refused" }, rest);
    await assert.rejects(patch({ rest }), { code: "write_refused" }, rest);
  }
  await assert.rejects(call({ method: "POST" }), { code: "write_refused" }, "POST to an event id");
  await assert.rejects(call({ body: { summary: "x" } }), { code: "write_refused" }, "a GET carries no body");
  await assert.rejects(call({ ifMatch: ETAG }), { code: "write_refused" }, "If-Match only on PATCH");
  await assert.rejects(patch({ ifMatch: undefined }), { code: "write_refused" }, "PATCH needs the etag");
  await assert.rejects(patch({ ifMatch: 'x"\r\ninjected: 1' }), { code: "write_refused" }, "etag shape");
  await assert.rejects(patch({ ifMatch: "*" }), { code: "write_refused" }, "no wildcard");
  await assert.rejects(patch({ body: undefined }), { code: "write_refused" }, "PATCH needs a body");
  for (const field of ["id", "attendees", "recurrence", "conferenceData", "reminders", "guestsCanModify", "attachments", "source", "organizer", "status"]) {
    await assert.rejects(patch({ body: { summary: "x", [field]: [] } }), { code: "write_refused" }, field);
  }
  await assert.rejects(call({ calendar: "../acl" }), { code: "bad_calendar" });
  assert.equal(calls.length, 0, "nothing reached the network");
  await call({ query: { sendUpdates: "all" } });
  await patch({ query: { sendUpdates: "all" } });
  assert.deepEqual(calls.map((c) => new URL(c.url).searchParams.get("sendUpdates")), ["none", "none"]);
});

test("the command: --yes applies, no --yes previews; unknown or unsafe options are refused", async () => {
  const env = ready();
  const { calls, fetchFn } = google();
  const run = async (argv) => {
    const lines = [];
    await cli.run(argv, { env, fetchFn, emit: (o) => lines.push(o), now: () => NOW });
    return lines;
  };
  const base = ["calendar-update", EID, "--title", "Deep work", "--actor", "parenting"];
  assert.equal((await run(base))[0].event, "dry_run");
  assert.deepEqual(calls.map((c) => c.method), ["GET"]);
  const done = await run([...base, "--yes", "--busy", "--public", "--prop", "src=home", "--location", "Room two", "--calendar", "primary", "--account", "me@example.com"]);
  assert.equal(done[0].event, "updated");
  assert.deepEqual(calls.map((c) => c.method), ["GET", "GET", "PATCH"]);
  assert.equal(calls[2].body.summary, "Deep work");
  assert.equal(calls[2].body.visibility, "public");
  assert.equal(calls[2].body.location, "Room two");
  assert.equal(calls[2].body.transparency, undefined, "already busy: not sent");
  assert.equal(calls[2].body.extendedProperties.private.calma_updated_by, "parenting");
  const before = calls.length;
  for (const unsafe of ["--attendee", "--attendees", "--recurrence", "--invite", "--send-updates", "--conference", "--rrule", "--status", "--id"]) {
    await assert.rejects(run([...base, unsafe, "x"]), { code: "usage" }, unsafe);
  }
  await assert.rejects(run([...base, "--key", "k1"]), { code: "usage" }, "--key belongs to create");
  await assert.rejects(run(["calendar-update", "--title", "x", "--actor", "schedule"]), { code: "usage" }, "no event id");
  await assert.rejects(run([...base, "evt2abc3def4"]), { code: "usage" }, "two event ids");
  await assert.rejects(run([...base, "--prop", "novalue"]), { code: "usage" });
  await assert.rejects(run(["calendar-update", EID, "--title", "x"]), { code: "bad_event" }, "no actor");
  await assert.rejects(run(["calendar-update", EID, "--actor", "schedule"]), { code: "nothing_to_change" });
  await assert.rejects(run([...base, "--free", "--busy"]), { code: "bad_event" });
  assert.equal(calls.length, before, "none of these reached the network");
  // Update-only options are not silently accepted by create.
  for (const only of ["--busy", "--public", "--any-event"]) {
    await assert.rejects(run(["calendar-create", "--title", "x", "--start", "2026-12-08T09:00:00+08:00", "--end", "2026-12-08T10:00:00+08:00", "--actor", "schedule", only]), { code: "usage" }, only);
  }
  assert.equal(calls.length, before);
});

test("--any-event on the command line lets an unmarked event through, and only that", async () => {
  const env = ready();
  const { calls, fetchFn } = google(stored({ extendedProperties: undefined }));
  const argv = ["calendar-update", EID, "--title", "Renamed", "--actor", "schedule", "--yes"];
  await assert.rejects(cli.run(argv, { env, fetchFn, emit() {}, now: () => NOW }), { code: "not_a_calma_event" });
  await cli.run([...argv, "--any-event"], { env, fetchFn, emit() {}, now: () => NOW });
  assert.deepEqual(calls.map((c) => c.method), ["GET", "GET", "PATCH"]);
  assert.equal(logLines(env).length, 1);
});

// ---- times are normalised to full seconds ----------------------------------------------------------------------

test("--start and --end without seconds are shown and sent with :00 (offset and Z forms)", async () => {
  const env = ready();
  const dry = await updateEvent(update({ start: "2026-12-09T13:00+08:00", end: "2026-12-09T14:15Z" }), { env, fetchFn: google().fetchFn, now: () => NOW });
  assert.deepEqual(dry.changes.start.after, { dateTime: "2026-12-09T13:00:00+08:00" });
  assert.deepEqual(dry.changes.end.after, { dateTime: "2026-12-09T14:15:00Z" });
  const { calls, fetchFn } = google();
  const out = await updateEvent(update({ start: "2026-12-09T13:00+08:00", end: "2026-12-09T14:15Z" }), { yes: true, env, fetchFn, now: () => NOW });
  assert.deepEqual(calls[1].body.start, { dateTime: "2026-12-09T13:00:00+08:00" });
  assert.deepEqual(calls[1].body.end, { dateTime: "2026-12-09T14:15:00Z" });
  assert.equal(out.event, "updated");
  // fractional seconds are left as given
  const frac = await updateEvent(update({ start: "2026-12-09T13:00:00.500+08:00" }), { env, fetchFn: google().fetchFn, now: () => NOW });
  assert.deepEqual(frac.changes.start.after, { dateTime: "2026-12-09T13:00:00.500+08:00" });
});

test("a new --start without seconds keeps the event's length, and the computed end has seconds", async () => {
  const env = ready();
  const { calls, fetchFn } = google();
  await updateEvent(update({ start: "2026-12-09T13:00-05:30" }), { yes: true, env, fetchFn, now: () => NOW });
  assert.deepEqual(calls[1].body.start, { dateTime: "2026-12-09T13:00:00-05:30" });
  assert.deepEqual(calls[1].body.end, { dateTime: "2026-12-09T14:30:00-05:30" });
  const dry = await updateEvent(update({ start: "2026-12-09T13:00Z" }), { env, fetchFn: google().fetchFn, now: () => NOW });
  assert.deepEqual(dry.changes.end.after, { dateTime: "2026-12-09T14:30:00Z" });
});

test("the same instant given without seconds, in another offset or with seconds is nothing_to_change", async () => {
  const env = ready();
  for (const over of [{ start: "2026-12-08T09:00+08:00" }, { start: "2026-12-08T01:00Z" }, { end: "2026-12-08T10:30+08:00" }, { start: "2026-12-08T01:00Z", end: "2026-12-08T02:30Z" }, { start: "2026-12-08T09:00:00+08:00" }]) {
    const { calls, fetchFn } = google();
    await assert.rejects(updateEvent(update(over), { yes: true, env, fetchFn, now: () => NOW }), { code: "nothing_to_change" }, JSON.stringify(over));
    assert.deepEqual(calls.map((c) => c.method), ["GET"], "no PATCH for an unchanged time");
  }
});

test("a stored time Google gave without seconds still produces full seconds for a kept-length start", async () => {
  const env = ready();
  const event = stored({ start: { dateTime: "2026-12-08T09:00+08:00" }, end: { dateTime: "2026-12-08T10:30+08:00" } });
  const { calls, fetchFn } = google(event);
  await updateEvent(update({ start: "2026-12-09T09:00+08:00" }), { yes: true, env, fetchFn, now: () => NOW });
  assert.deepEqual(calls[1].body.start, { dateTime: "2026-12-09T09:00:00+08:00" });
  assert.deepEqual(calls[1].body.end, { dateTime: "2026-12-09T10:30:00+08:00" });
});

test("switching an all-day event to timed with times without seconds sends full seconds", async () => {
  const env = ready();
  const { calls, fetchFn } = google(allDayStored());
  await updateEvent(update({ start: "2026-12-08T09:00+08:00", end: "2026-12-08T10:00+08:00" }), { yes: true, env, fetchFn, now: () => NOW });
  assert.deepEqual(calls[1].body.start, { dateTime: "2026-12-08T09:00:00+08:00", date: null });
  assert.deepEqual(calls[1].body.end, { dateTime: "2026-12-08T10:00:00+08:00", date: null });
});

test("invalid times without seconds are still refused on update, before any request", async () => {
  const env = ready();
  for (const over of [{ start: "2026-12-09T13:00" }, { end: "2026-12-09T24:00Z" }, { start: "2026-02-30T13:00Z" }]) {
    await assert.rejects(updateEvent(update(over), { yes: true, env, fetchFn: never, now: () => NOW }), { code: "bad_event" }, JSON.stringify(over));
  }
});

test("a 400 on the update names the rejected field and never Google's message", async () => {
  const env = ready();
  const body = { error: { status: "INVALID_ARGUMENT", message: "Bearer WRITE-ACCESS-LEAK", errors: [{ reason: "invalid", location: "start.dateTime", message: "WRITE-ACCESS-LEAK" }] } };
  const fetchFn = async (url, init) => (init.method === "PATCH" ? jsonResponse(body, 400) : jsonResponse(stored()));
  await assert.rejects(updateEvent(update({ title: "New" }), { yes: true, env, fetchFn, now: () => NOW }), { code: "google_error", message: "Google answered 400 (invalid) for field start.dateTime." });
  assert.equal(existsSync(logPath(env)), false, "nothing logged for the failure");
});
