import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import * as cli from "../calma-write.mjs";
import { buildCreateBody, createEvent, eventIdFromKey, resolveTarget, when, writeRequest } from "../lib/write/events.mjs";
import { logPath } from "../lib/write/log.mjs";
import { allowAccount, allowCalendar } from "../lib/write/policy.mjs";
import { WRITE_SCOPE } from "../lib/write/scopes.mjs";
import { saveWriteToken } from "../lib/write/tokens.mjs";
import { jsonResponse, sandbox } from "./helpers.mjs";

const NOW = Date.UTC(2026, 10, 5, 4, 0, 0);
const FAR = Date.now() + 10 * 365 * 24 * 3600 * 1000;
const GRANT = `${WRITE_SCOPE} openid https://www.googleapis.com/auth/userinfo.email`;
const ACTAL = `actual-cal${"@"}example.com`;

/** A sandbox with one allowed account that has a write token, and the allowed calendars. */
function ready({ calendars = ["primary", ACTAL], accounts = ["me@example.com"], tokens = accounts } = {}) {
  const { env } = sandbox();
  for (const a of accounts) allowAccount(a, env);
  for (const c of calendars) allowCalendar(c, env);
  for (const t of tokens) saveWriteToken(t, { account: t, scope: GRANT, access_token: `WRITE-ACCESS-${t}`, refresh_token: `WRITE-REFRESH-${t}`, expires_at: FAR }, env);
  return env;
}

const input = (over = {}) => ({ title: "Focus block", start: "2026-11-06T09:00:00+08:00", end: "2026-11-06T10:30:00+08:00", actor: "schedule", ...over });

/** A fetch that records requests and answers a created event. */
const google = (reply = (body) => jsonResponse({ id: body.id ?? "newid12345", summary: body.summary, start: body.start, end: body.end, htmlLink: "https://calendar.example/evt" })) => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    return reply(init.body ? JSON.parse(init.body) : undefined);
  };
  return { calls, fetchFn };
};

test("a dry run validates, shows what it would create, and sends nothing", async () => {
  const env = ready();
  const { calls, fetchFn } = google();
  const out = await createEvent(input({ free: true, private: true }), { env, fetchFn, now: () => NOW });
  assert.equal(out.event, "dry_run");
  assert.equal(out.account, "me@example.com");
  assert.equal(out.calendar, "primary");
  assert.deepEqual(out.would_create, { summary: "Focus block", start: { dateTime: "2026-11-06T09:00:00+08:00" }, end: { dateTime: "2026-11-06T10:30:00+08:00" }, transparency: "transparent", visibility: "private", id: undefined });
  assert.equal(calls.length, 0);
  assert.equal(existsSync(logPath(env)), false, "a dry run writes no log line");
});

test("--yes creates the event with exactly one POST: marker, no guests, no recurrence, sendUpdates none", async () => {
  const env = ready();
  const { calls, fetchFn } = google();
  const out = await createEvent(input({ description: "d", location: "l", props: { aw: "2026-11-05", awr: "k1" } }), { yes: true, env, fetchFn, now: () => NOW });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none");
  assert.equal(call.headers.authorization, "Bearer WRITE-ACCESS-me@example.com");
  assert.deepEqual(Object.keys(call.body).sort(), ["description", "end", "extendedProperties", "location", "start", "summary", "transparency", "visibility"]);
  assert.deepEqual(call.body.extendedProperties, { private: { aw: "2026-11-05", awr: "k1", calma: "1", calma_actor: "schedule", calma_created: new Date(NOW).toISOString() } });
  assert.equal(call.body.transparency, "opaque");
  assert.equal(call.body.visibility, "default");
  assert.equal(out.event, "created");
  assert.equal(out.id, "newid12345");
  assert.equal(out.link, "https://calendar.example/evt");
  assert.ok(!JSON.stringify(out).includes("WRITE-"), "no token in the output");
});

test("the write log gets one line per applied change: id and actor, never the title", async () => {
  const env = ready();
  await createEvent(input({ title: "Secret meeting title" }), { yes: true, env, fetchFn: google().fetchFn, now: () => NOW });
  await createEvent(input(), { env, fetchFn: google().fetchFn, now: () => NOW }); // dry run: no line
  const lines = readFileSync(logPath(env), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { at: new Date(NOW).toISOString(), op: "create", account: "me@example.com", calendar: "primary", event_id: "newid12345", actor: "schedule" });
  assert.ok(!lines[0].includes("Secret"));
  assert.equal(statSync(logPath(env)).mode & 0o777, 0o600);
});

test("the Actual calendar id goes into the path percent-encoded; calendars off the allow-list are refused before any request", async () => {
  const env = ready();
  const { calls, fetchFn } = google();
  await createEvent(input({ calendar: ACTAL }), { yes: true, env, fetchFn, now: () => NOW });
  assert.equal(calls[0].url, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ACTAL)}/events?sendUpdates=none`);
  for (const calendar of ["other-cal@example.com", "../primary", "primary/acl"]) {
    await assert.rejects(createEvent(input({ calendar }), { yes: true, env, fetchFn }), (e) => ["calendar_not_allowed", "bad_calendar"].includes(e.code), calendar);
  }
  assert.equal(calls.length, 1);
});

test("account rules: allowed and signed in for writing, the only one needs no flag, several need --account", async () => {
  const never = async () => assert.fail("no request expected");
  assert.equal(resolveTarget({}, ready()).email, "me@example.com");
  assert.throws(() => resolveTarget({ account: "you@example.com" }, ready()), { code: "account_not_allowed" });
  assert.throws(() => resolveTarget({}, ready({ tokens: [] })), { code: "reauth_needed" });
  const two = ready({ accounts: ["me@example.com", "you@example.com"] });
  assert.throws(() => resolveTarget({}, two), { code: "account_required" });
  assert.equal(resolveTarget({ account: " YOU@example.com " }, two).email, "you@example.com");
  // A token left behind for an address that is no longer allowed is not used.
  const env = ready({ accounts: ["me@example.com"], tokens: ["me@example.com"] });
  saveWriteToken("old@example.com", { account: "old@example.com", scope: GRANT, access_token: "X", refresh_token: "Y", expires_at: FAR }, env);
  await assert.rejects(createEvent(input({ account: "old@example.com" }), { yes: true, env, fetchFn: never }), { code: "account_not_allowed" });
  await assert.rejects(createEvent(input({ calendar: "primary" }), { yes: true, env: ready({ calendars: [] }), fetchFn: never }), { code: "calendar_not_allowed" });
});

test("event input is validated: title, times with an offset, end after start, all-day dates, actor, properties", () => {
  const ok = (over) => buildCreateBody(input(over), { calendar: "primary", now: () => NOW }).body;
  const refused = (over, what) => assert.throws(() => ok(over), { code: "bad_event" }, what);
  refused({ title: "" }, "empty title");
  refused({ title: "x".repeat(1001) }, "long title");
  refused({ title: 5 }, "title not text");
  refused({ start: "2026-11-06 09:00" }, "no offset");
  refused({ start: "2026-11-06T09:00:00" }, "naive time");
  refused({ start: "yesterday" }, "not a time");
  refused({ start: "2026-13-40T09:00:00+08:00" }, "impossible date");
  refused({ end: "2026-11-06T09:00:00+08:00" }, "end equals start");
  refused({ end: "2026-11-06T08:00:00+08:00" }, "end before start");
  refused({ end: undefined }, "timed event needs an end");
  refused({ actor: undefined }, "actor required");
  refused({ actor: "Schedule Bot" }, "actor shape");
  refused({ description: "x".repeat(8001) }, "long description");
  refused({ props: { calma: "0" } }, "reserved property");
  refused({ props: { calma_actor: "x" } }, "reserved property prefix");
  refused({ props: { "bad key": "v" } }, "property key shape");
  refused({ props: { k: "x".repeat(201) } }, "property value length");
  assert.equal(ok({ start: "2026-11-06T01:00:00Z", end: "2026-11-06T02:00:00Z" }).start.dateTime, "2026-11-06T01:00:00Z");
  // All-day: dates only, end exclusive, defaults to the next day.
  const day = ok({ allDay: true, start: "2026-11-06", end: undefined });
  assert.deepEqual([day.start, day.end], [{ date: "2026-11-06" }, { date: "2026-11-07" }]);
  assert.deepEqual(ok({ allDay: true, start: "2026-11-06", end: "2026-11-09" }).end, { date: "2026-11-09" });
  assert.throws(() => ok({ allDay: true, start: "2026-11-06T09:00:00+08:00", end: undefined }), { code: "bad_event" });
  assert.equal(ok({ allDay: true, start: "2026-11-30", end: undefined }).end.date, "2026-12-01");
  for (const impossible of ["2026-02-30", "2026-04-31", "2026-00-10", "2026-13-01", "2026-11-00", "2026-11-32"]) assert.throws(() => ok({ allDay: true, start: impossible, end: undefined }), { code: "bad_event" }, impossible);
  assert.equal(ok({ allDay: true, start: "2028-02-29", end: undefined }).end.date, "2028-03-01", "a leap day is real");
  for (const impossible of ["2026-02-30T09:00:00+08:00", "2026-11-06T24:00:00+08:00", "2026-11-06T09:60:00+08:00", "2026-11-06T09:00:60+08:00", "2026-11-06T09:00:00+24:00", "2026-11-06T09:00:00+08:60"]) refused({ start: impossible, end: "2030-01-01T00:00:00Z" }, impossible);
});

test("the request layer refuses anything but the allowed create call, other fields, and other URLs", async () => {
  const { calls, fetchFn } = google();
  const call = (over) => writeRequest({ method: "POST", calendar: "primary", rest: "/events", token: "T", body: { summary: "x" }, ...over }, { fetchFn });
  for (const method of ["GET", "PATCH", "PUT", "DELETE"]) await assert.rejects(call({ method }), { code: "write_refused" }, method);
  for (const rest of ["/events/abc", "/acl", "/events/watch", "", "/events?x=1", "/../acl", "/settings"]) await assert.rejects(call({ rest }), { code: "write_refused" }, rest);
  for (const field of ["attendees", "recurrence", "conferenceData", "reminders", "guestsCanModify", "attachments", "source", "organizer", "anyoneCanAddSelf"]) {
    await assert.rejects(call({ body: { summary: "x", [field]: [] } }), { code: "write_refused" }, field);
  }
  await assert.rejects(call({ calendar: "../acl" }), { code: "bad_calendar" });
  await assert.rejects(call({ calendar: "a/b" }), { code: "bad_calendar" });
  assert.equal(calls.length, 0, "nothing reached the network");
  // sendUpdates is forced to none even if a caller passes something else.
  await call({ query: { sendUpdates: "all", supportsAttachments: "false" } });
  assert.equal(new URL(calls[0].url).searchParams.get("sendUpdates"), "none");
});

test("--key makes a deterministic id, so a retried create cannot duplicate (Google answers 409)", async () => {
  const env = ready();
  const a = eventIdFromKey("primary", "aw-2026-11-05");
  assert.equal(a, eventIdFromKey("primary", "aw-2026-11-05"));
  assert.notEqual(a, eventIdFromKey("primary", "aw-2026-11-06"));
  assert.notEqual(a, eventIdFromKey(ACTAL, "aw-2026-11-05"));
  assert.match(a, /^[a-v0-9]{40}$/);
  assert.throws(() => eventIdFromKey("primary", ""), { code: "bad_event" });
  const { calls, fetchFn } = google();
  await createEvent(input({ key: "aw-2026-11-05" }), { yes: true, env, fetchFn, now: () => NOW });
  assert.equal(calls[0].body.id, a);
  const conflict = google(() => jsonResponse({ error: { code: 409, status: "ALREADY_EXISTS", message: "Bearer WRITE-ACCESS-LEAK" } }, 409));
  await assert.rejects(createEvent(input({ key: "aw-2026-11-05" }), { yes: true, env, fetchFn: conflict.fetchFn, now: () => NOW }), (e) => e.code === "already_exists" && !e.message.includes("LEAK"));
  assert.equal(readFileSync(logPath(env), "utf8").trim().split("\n").length, 1, "a failed create is not logged as done");
});

test("Google errors become clear errors that never echo a token or the response", async () => {
  const env = ready();
  const fail = (status, body) => google(() => jsonResponse(body, status)).fetchFn;
  await assert.rejects(createEvent(input(), { yes: true, env, fetchFn: fail(401, {}) }), { code: "reauth_needed" });
  await assert.rejects(createEvent(input(), { yes: true, env, fetchFn: fail(403, { error: { status: "PERMISSION_DENIED", message: "Bearer WRITE-ACCESS-LEAK" } }) }), (e) => e.code === "google_error" && /PERMISSION_DENIED/.test(e.message) && !e.message.includes("LEAK"));
  await assert.rejects(createEvent(input(), { yes: true, env, fetchFn: fail(404, {}) }), { code: "google_error" });
  const stalled = async () => ({ ok: true, status: 200, json: async () => { throw new DOMException("timeout", "TimeoutError"); } });
  await assert.rejects(createEvent(input(), { yes: true, env, fetchFn: stalled }), { code: "timeout" });
  assert.equal(existsSync(logPath(env)), false, "nothing was logged for failures");
});

test("an expired write token is refreshed before the create", async () => {
  const env = ready();
  saveWriteToken("me@example.com", { account: "me@example.com", scope: GRANT, access_token: "OLD", refresh_token: "WRITE-REFRESH-me@example.com", expires_at: 0 }, env);
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push(String(url));
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) return jsonResponse({ access_token: "WRITE-FRESH-1", expires_in: 3600, scope: GRANT });
    assert.equal(init.headers.authorization, "Bearer WRITE-FRESH-1");
    return jsonResponse({ id: "newid12345", summary: "Focus block" });
  };
  await createEvent(input(), { yes: true, env, fetchFn, now: () => NOW });
  assert.equal(calls.length, 2);
});

test("the command: --yes applies, no --yes previews, and a typo'd or unsafe option is refused", async () => {
  const env = ready();
  const { calls, fetchFn } = google();
  const run = async (argv) => {
    const lines = [];
    await cli.run(argv, { env, fetchFn, emit: (o) => lines.push(o), now: () => NOW });
    return lines;
  };
  const base = ["calendar-create", "--title", "Standup", "--start", "2026-11-06T09:00:00+08:00", "--end", "2026-11-06T09:15:00+08:00", "--actor", "parenting"];
  assert.equal((await run(base))[0].event, "dry_run");
  assert.equal(calls.length, 0);
  const made = await run([...base, "--yes", "--prop", "src=school", "--private", "--free", "--calendar", "primary", "--key", "k1"]);
  assert.equal(made[0].event, "created");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.visibility, "private");
  assert.equal(calls[0].body.transparency, "transparent");
  assert.equal(calls[0].body.extendedProperties.private.src, "school");
  for (const unsafe of ["--attendee", "--attendees", "--recurrence", "--invite", "--send-updates", "--conference", "--rrule"]) {
    await assert.rejects(run([...base, unsafe, "x"]), { code: "usage" }, unsafe);
  }
  await assert.rejects(run(["calendar-create", "--title", "x", "--start", "2026-11-06T09:00:00+08:00", "--end", "2026-11-06T09:15:00+08:00"]), { code: "bad_event" }, "no actor");
  await assert.rejects(run([...base, "--prop", "novalue"]), { code: "usage" });
  assert.equal(calls.length, 1);
});

// ---- times are normalised to full seconds ----------------------------------------------------------------------

test("a time without seconds is shown and sent with :00, for offset and Z forms; fractional seconds stay as given", async () => {
  const env = ready();
  const cases = [
    [{ start: "2026-11-06T13:00+08:00", end: "2026-11-06T14:30+08:00" }, "2026-11-06T13:00:00+08:00", "2026-11-06T14:30:00+08:00"],
    [{ start: "2026-11-06T13:00Z", end: "2026-11-06T14:30Z" }, "2026-11-06T13:00:00Z", "2026-11-06T14:30:00Z"],
    [{ start: "2026-11-06T13:00-05:30", end: "2026-11-06T13:00:00.250-05:30" }, "2026-11-06T13:00:00-05:30", "2026-11-06T13:00:00.250-05:30"],
    [{ start: "2026-11-06T13:00:00.125Z", end: "2026-11-06T13:00:01Z" }, "2026-11-06T13:00:00.125Z", "2026-11-06T13:00:01Z"],
  ];
  for (const [times, start, end] of cases) {
    const dry = await createEvent(input(times), { env, fetchFn: google().fetchFn, now: () => NOW });
    assert.deepEqual([dry.would_create.start, dry.would_create.end], [{ dateTime: start }, { dateTime: end }]);
    const { calls, fetchFn } = google();
    await createEvent(input(times), { yes: true, env, fetchFn, now: () => NOW });
    assert.equal(calls.length, 1);
    assert.deepEqual([calls[0].body.start, calls[0].body.end], [{ dateTime: start }, { dateTime: end }]);
  }
});

test("the time normaliser: valid forms gain :00 only when seconds are missing; invalid ones are still refused", () => {
  const ok = [
    ["2026-11-06T13:00+08:00", "2026-11-06T13:00:00+08:00"],
    ["2026-11-06T13:00Z", "2026-11-06T13:00:00Z"],
    ["2026-11-06T00:00-12:00", "2026-11-06T00:00:00-12:00"],
    ["2026-11-06T23:59+14:00", "2026-11-06T23:59:00+14:00"],
    ["2028-02-29T09:30Z", "2028-02-29T09:30:00Z"],
    ["2026-11-06T13:00:00+08:00", "2026-11-06T13:00:00+08:00"],
    ["2026-11-06T13:00:59Z", "2026-11-06T13:00:59Z"],
    ["2026-11-06T13:00:00.5Z", "2026-11-06T13:00:00.5Z"],
    ["2026-11-06T13:00:00.123456+08:00", "2026-11-06T13:00:00.123456+08:00"],
  ];
  for (const [given, expected] of ok) assert.equal(when(given, "start", false).dateTime, expected, given);
  const invalid = [
    "2026-11-06T13:00", // no offset
    "2026-11-06T13+08:00", // no minutes
    "2026-11-06T24:00+08:00",
    "2026-11-06T13:60Z",
    "2026-11-06T13:00:60Z",
    "2026-11-06T13:00+24:00",
    "2026-11-06T13:00+08:60",
    "2026-02-30T13:00Z",
    "2027-02-29T13:00Z",
    "2026-13-06T13:00Z",
    "2026-11-06 13:00Z",
    "2026-11-06T13:00:00",
    "2026-11-06T13:00:Z",
    "2026-11-06T13:00+0800",
    "2026-11-06",
    "tomorrow 13:00",
    "",
  ];
  for (const given of invalid) assert.throws(() => when(given, "start", false), { code: "bad_event" }, JSON.stringify(given));
  assert.throws(() => when(undefined, "start", false), { code: "bad_event" });
  assert.throws(() => when(1762405200000, "start", false), { code: "bad_event" });
  assert.deepEqual(when("2026-11-06", "start", true).date, "2026-11-06"); // all-day dates are untouched
});

test("a rejected time without seconds is also refused through the create path (bad_event, nothing sent)", async () => {
  const env = ready();
  for (const start of ["2026-11-06T13:00", "2026-11-06T25:00Z", "2026-02-30T13:00Z"]) {
    await assert.rejects(createEvent(input({ start, end: "2026-12-06T10:00Z" }), { yes: true, env, fetchFn: async () => assert.fail("no request expected"), now: () => NOW }), { code: "bad_event" }, start);
  }
});

// ---- a 400 names the rejected field and nothing else -----------------------------------------------------------

test("a 400 names the field Google rejected, never Google's message, the body or a token", async () => {
  const env = ready();
  const fail400 = (error) => google(() => jsonResponse({ error }, 400)).fetchFn;
  const run = (error) => createEvent(input(), { yes: true, env, fetchFn: fail400(error), now: () => NOW });
  const SECRET = "WRITE-ACCESS-LEAK-4f9c1e7a2b8d-unique";
  await assert.rejects(run({ code: 400, status: "INVALID_ARGUMENT", message: `Bad value ${SECRET} in request`, errors: [{ domain: "global", reason: "invalid", location: "start.dateTime", locationType: "other", message: SECRET }] }), (e) => {
    assert.equal(e.code, "google_error");
    assert.equal(e.message, "Google answered 400 (invalid) for field start.dateTime.");
    assert.ok(!e.message.includes("LEAK") && !e.message.includes("Bad value"));
    return true;
  });
  // several fields: reasons are listed once, at most three fields
  await assert.rejects(run({ errors: [{ reason: "invalid", location: "start.dateTime" }, { reason: "invalid", location: "end.dateTime" }, { reason: "required", location: "summary" }, { reason: "invalid", location: "fourth.field" }] }), { code: "google_error", message: "Google answered 400 (invalid, required) for fields start.dateTime, end.dateTime, summary." });
});

test("a 400 with no field keeps the plain message and invents nothing", async () => {
  const env = ready();
  const run = (body) => createEvent(input(), { yes: true, env, fetchFn: google(() => jsonResponse(body, 400)).fetchFn, now: () => NOW });
  const plain = { code: "google_error", message: "Google answered 400 (INVALID_ARGUMENT)." };
  await assert.rejects(run({ error: { status: "INVALID_ARGUMENT", message: "WRITE-ACCESS-LEAK free text" } }), plain);
  await assert.rejects(run({ error: { status: "INVALID_ARGUMENT", errors: [] } }), plain);
  await assert.rejects(run({ error: { status: "INVALID_ARGUMENT", errors: [{ reason: "invalid" }] } }), plain);
  await assert.rejects(run({ error: { status: "INVALID_ARGUMENT", errors: [{ reason: "invalid", location: "  \"'<> " }] } }), plain);
  await assert.rejects(run({ error: { status: "INVALID_ARGUMENT", errors: [{ reason: "invalid", location: 42 }, null, "text"] } }), plain);
  await assert.rejects(run({ error: { status: "INVALID_ARGUMENT", errors: "start.dateTime" } }), plain);
  await assert.rejects(run(null), { code: "google_error", message: "Google answered 400 (400)." });
});

test("hostile reason and location text is sanitised and capped", async () => {
  const env = ready();
  const long = "a".repeat(500);
  const run = (errors) => createEvent(input(), { yes: true, env, fetchFn: google(() => jsonResponse({ error: { errors } }, 400)).fetchFn, now: () => NOW });
  await assert.rejects(run([{ reason: 'in valid"\'<script>', location: 'start. dateTime"; Bearer WRITE-ACCESS-LEAK /x\n' }]), (e) => {
    assert.match(e.message, /^Google answered 400 \([A-Za-z0-9_.[\]-]*\) for field [A-Za-z0-9_.[\]-]+\.$/);
    assert.ok(!/[ "'<>;\n/]/.test(e.message.replace(/^Google answered 400 \(|\) for field | |\.$/g, "")));
    return true;
  });
  await assert.rejects(run([{ reason: long, location: long }]), (e) => {
    assert.equal(e.message, `Google answered 400 (${"a".repeat(60)}) for field ${"a".repeat(60)}.`);
    return true;
  });
  await assert.rejects(run([{ reason: "r", location: "items[0].x-y_z" }]), { message: "Google answered 400 (r) for field items[0].x-y_z." });
});

test("other statuses keep their handling", async () => {
  const env = ready();
  const run = (status, body) => createEvent(input(), { yes: true, env, fetchFn: google(() => jsonResponse(body, status)).fetchFn, now: () => NOW });
  const named = { error: { status: "PERMISSION_DENIED", errors: [{ reason: "forbidden", location: "start.dateTime" }] } };
  await assert.rejects(run(403, named), { code: "google_error", message: "Google answered 403 (PERMISSION_DENIED)." });
  await assert.rejects(run(500, named), { code: "google_error", message: "Google answered 500 (PERMISSION_DENIED)." });
  await assert.rejects(run(401, named), { code: "reauth_needed" });
});
