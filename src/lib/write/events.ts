// Calendar event writes. The only place in calma that can change a calendar. Every request goes through writeRequest, which
// allows exactly the calls listed in ALLOWED and nothing else (create, read one event, update one event, delete one event);
// bodies are built from a fixed set of fields, so there is no way to add guests, recurrence, video calls or reminders,
// and sendUpdates is always "none".
import { createHash } from "node:crypto";
import { normalizeEmail } from "../accounts.ts";
import { ToolError } from "../config.ts";
import { fetchWithTimeout, readJson } from "../net.ts";
import type { Env, EventInput, FetchLike, IoDeps } from "../types.ts";
import { accessWriteToken } from "./oauth.ts";
import { appendWriteLog } from "./log.ts";
import { loadPolicy, normalizeCalendarId } from "./policy.ts";
import { listWriteAccounts } from "./tokens.ts";

const API = "https://www.googleapis.com/calendar/v3/calendars";

/** Every field an event body may contain. Anything else (attendees, recurrence, conferenceData, reminders...) is refused. */
const CREATE_FIELDS = ["id", "summary", "description", "location", "start", "end", "transparency", "visibility", "extendedProperties"];
const UPDATE_FIELDS = CREATE_FIELDS.filter((f) => f !== "id"); // an update never changes the id
const EVENT_ID = /^[a-v0-9]{5,1024}$/;
const ETAG = /^(?:W\/)?"[\x21\x23-\x7e]{1,200}"$/;

/** The calls calma-write may make: method, the path after /calendar/v3/calendars/<calendar>, and the body fields allowed (null: no body). */
const ALLOWED: { method: string; rest: RegExp; fields: string[] | null }[] = [
  { method: "POST", rest: /^\/events$/, fields: CREATE_FIELDS },
  { method: "GET", rest: /^\/events\/[a-v0-9]{5,1024}$/, fields: null },
  { method: "PATCH", rest: /^\/events\/[a-v0-9]{5,1024}$/, fields: UPDATE_FIELDS },
  { method: "DELETE", rest: /^\/events\/[a-v0-9]{5,1024}$/, fields: null }, // no body and no If-Match
];

/** One word taken from Google's error body: only letters, digits and _ . [ ] -, at most 60 characters (never free text). */
const safeWord = (v: unknown) => (typeof v === "string" ? v.replace(/[^A-Za-z0-9_.[\]-]/g, "").slice(0, 60) : "");

/**
 * For a 400: a message naming the field Google rejected, built only from each error's reason and location (at most 3).
 * Never uses Google's free-text message. Returns null when Google names no field.
 */
function rejectedFields(err: any) {
  const list = Array.isArray(err?.error?.errors) ? err.error.errors : [];
  const found = list.map((e: any) => ({ reason: safeWord(e?.reason), location: safeWord(e?.location) })).filter((e: { location: string }) => e.location).slice(0, 3);
  if (found.length === 0) return null;
  const reasons = [...new Set(found.map((e: { reason: string }) => e.reason).filter(Boolean))];
  const locations = found.map((e: { location: string }) => e.location);
  return `Google answered 400${reasons.length ? ` (${reasons.join(", ")})` : ""} for field${locations.length > 1 ? "s" : ""} ${locations.join(", ")}.`;
}

/**
 * Sends one allowed request to the Calendar API for an allowed calendar. `calendar` is already validated; it is
 * percent-encoded into the path. Returns the parsed JSON body ({} for a DELETE, which Google answers with no body).
 * `missingIsNotFound` (delete only) turns Google's 404 and 410 into not_found.
 */
export async function writeRequest({ method, calendar, rest, token, body, ifMatch, query = {}, missingIsNotFound = false }: { method: string; calendar: string; rest: string; token: string; body?: any; ifMatch?: string; query?: Record<string, string>; missingIsNotFound?: boolean }, { fetchFn = fetch }: { fetchFn?: FetchLike } = {}): Promise<any> {
  const call = ALLOWED.find((a) => a.method === method && a.rest.test(rest));
  if (!call) throw new ToolError("write_refused", `calma-write does not make ${method} requests to ${rest}.`);
  const cal = normalizeCalendarId(calendar);
  const fields = call.fields;
  if (body !== undefined) {
    if (fields === null) throw new ToolError("write_refused", `${method} requests carry no body.`);
    const extra = Object.keys(body).filter((k) => !fields.includes(k));
    if (extra.length) throw new ToolError("write_refused", `Event fields not allowed: ${extra.join(", ")}.`);
  }
  if (method === "PATCH" && (body === undefined || !ETAG.test(ifMatch ?? ""))) throw new ToolError("write_refused", "An update needs a body and the etag it was read at.");
  if (method !== "PATCH" && ifMatch !== undefined) throw new ToolError("write_refused", "Only an update carries If-Match.");
  const url = new URL(`${API}/${encodeURIComponent(cal)}${rest}`);
  if (url.protocol !== "https:" || url.host !== "www.googleapis.com" || !url.pathname.startsWith("/calendar/v3/calendars/")) throw new ToolError("write_refused", "Not an allowed Calendar URL.");
  url.searchParams.set("sendUpdates", "none"); // never email anyone, whatever the caller passes
  for (const [k, v] of Object.entries(query)) if (k !== "sendUpdates") url.searchParams.set(k, v);
  const res = await fetchWithTimeout(fetchFn, url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(ifMatch ? { "if-match": ifMatch } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const err: any = await readJson(res);
    const reason = String(err?.error?.status ?? err?.error?.code ?? res.status).replace(/[^A-Za-z0-9_ -]/g, "");
    if (res.status === 400) {
      const fields = rejectedFields(err);
      if (fields) throw new ToolError("google_error", fields);
    }
    if (missingIsNotFound && (res.status === 404 || res.status === 410)) throw new ToolError("not_found", "That event does not exist or is already deleted.");
    if (res.status === 401) throw new ToolError("reauth_needed", "Google rejected the write token. Run: calma-write auth");
    if (res.status === 412) throw new ToolError("changed_meanwhile", "The event changed since it was read. Nothing was changed; read it again and retry.");
    if (res.status === 409) throw new ToolError("already_exists", "An event with that id already exists.");
    throw new ToolError("google_error", `Google answered ${res.status} (${reason}).`);
  }
  if (method === "DELETE") return {}; // 204 No Content: there is no body to read
  return readJson(res, { strict: true });
}

// ---- validation -------------------------------------------------------------------------------------------------

const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACTOR = /^[a-z][a-z0-9_-]{0,29}$/;
const PROP_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,59}$/;

const bad = (message: string) => new ToolError("bad_event", message);

function text(value: unknown, name: string, max: number, opts: { required: true }): string;
function text(value: unknown, name: string, max: number, opts?: { required?: boolean }): string | undefined;
function text(value: unknown, name: string, max: number, { required = false }: { required?: boolean } = {}) {
  if (value === undefined || value === "") {
    if (required) throw bad(`${name} is required.`);
    return undefined;
  }
  if (typeof value !== "string" || value.length > max) throw bad(`${name} must be text of at most ${max} characters.`);
  return value;
}

/** A real calendar date: month 1-12 and a day that exists in that month (JavaScript's own parser rolls 2026-02-30 over to March). */
function realDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** A real time of day and offset: hours under 24, minutes and seconds under 60. */
function realTime(hms: string, offset: string) {
  const [h, mi, se = "0"] = hms.split(":");
  const off = offset === "Z" ? [0, 0] : offset.slice(1).split(":").map(Number);
  const oh = off[0] ?? Number.NaN;
  const om = off[1] ?? Number.NaN;
  return Number(h) < 24 && Number(mi) < 60 && Number(se) < 60 && oh < 24 && om < 60;
}

/** Full RFC 3339 for Google: a time without seconds gets :00 before the offset. Anything else is returned unchanged. */
const withSeconds = (value: string) => value.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/, "$1:00$2");

/** Validates one start or end and returns it normalised: { date, ms } for all-day, { dateTime (always with seconds), ms } otherwise. */
type Moment = { date?: string; dateTime?: string; ms: number };

export function when(value: unknown, name: string, allDay: boolean): Moment {
  if (typeof value !== "string") throw bad(`${name} is required.`);
  if (allDay) {
    if (!DATE.test(value) || !realDate(value)) throw bad(`${name} must be a date like 2026-11-06 for an all-day event.`);
    return { date: value, ms: Date.parse(`${value}T00:00:00Z`) };
  }
  const m = DATETIME.exec(value);
  if (!m || !realDate(value.slice(0, 10)) || !realTime(value.slice(11).replace(/(Z|[+-]\d{2}:\d{2})$/, ""), m[3]) || Number.isNaN(Date.parse(value))) {
    throw bad(`${name} must be a date and time with an offset, like 2026-11-06T09:00:00+08:00 (or Z).`);
  }
  const dateTime = withSeconds(value);
  return { dateTime, ms: Date.parse(dateTime) };
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const addDay = (date: string) => addDays(date, 1);

function cleanActor(value: unknown) {
  const actor = typeof value === "string" ? value : "";
  if (!ACTOR.test(actor)) throw bad("--actor is required: a short lower-case label for who is asking, like schedule or parenting.");
  return actor;
}

/** Caller properties: valid names and values, and never one that starts with "calma" (the marker and update stamps are calma's alone). */
function cleanProps(raw?: object) {
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!PROP_KEY.test(k) || /^calma/i.test(k)) throw bad(`Property name "${k}" is not allowed (letters, digits, _ . -; not starting with calma).`);
    if (typeof v !== "string" || v.length > 200) throw bad(`Property "${k}" must be text of at most 200 characters.`);
    props[k] = v;
  }
  return props;
}

/** A deterministic event id from a key, so a retried create cannot make a duplicate (Google answers 409). Hex is valid event-id text. */
export function eventIdFromKey(calendar: string, key: unknown) {
  if (typeof key !== "string" || key.length === 0 || key.length > 200) throw bad("--key must be 1 to 200 characters.");
  const id = createHash("sha256").update(`${calendar}|${key}`).digest("hex").slice(0, 40);
  if (!EVENT_ID.test(id)) throw bad("Could not make an event id from that key.");
  return id;
}

/**
 * The event body for a create, from validated input. The marker (calma, calma_actor, calma_created) is what later lets
 * update and delete tell events calma made from events Med made by hand.
 */
export function buildCreateBody(input: EventInput, { calendar, now = () => Date.now() }: { calendar: string; now?: () => number }) {
  const summary = text(input.title, "title", 1000, { required: true });
  const description = text(input.description, "description", 8000);
  const location = text(input.location, "location", 1000);
  const allDay = Boolean(input.allDay);
  const start = when(input.start, "start", allDay);
  const end = input.end === undefined && allDay ? { date: addDay(start.date!), ms: Date.parse(`${addDay(start.date!)}T00:00:00Z`) } : when(input.end, "end", allDay);
  if (end.ms <= start.ms) throw bad("end must be after start.");
  const actor = cleanActor(input.actor);
  const props = cleanProps(input.props);
  const body: any = {
    ...(input.key !== undefined ? { id: eventIdFromKey(calendar, input.key) } : {}),
    summary,
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    start: start.date ? { date: start.date } : { dateTime: start.dateTime },
    end: end.date ? { date: end.date } : { dateTime: end.dateTime },
    transparency: input.free ? "transparent" : "opaque",
    visibility: input.private ? "private" : "default",
    extendedProperties: { private: { ...props, calma: "1", calma_actor: actor, calma_created: new Date(now()).toISOString() } },
  };
  return { body, actor };
}

// ---- the command ------------------------------------------------------------------------------------------------

/** The account and calendar a write may use: both must be allowed in write.json, and the account must have a write token. */
export function resolveTarget({ account, calendar }: { account?: unknown; calendar?: unknown }, env: Env = process.env) {
  const policy = loadPolicy(env);
  const cal = normalizeCalendarId(calendar ?? "primary");
  if (!policy.calendars.includes(cal)) throw new ToolError("calendar_not_allowed", "That calendar is not on the write allow-list. Run: calma-write allow --calendar <id>");
  let email: string;
  if (account !== undefined) email = normalizeEmail(account);
  else {
    const accounts = listWriteAccounts(env);
    if (accounts.length === 0) throw new ToolError("reauth_needed", "No account has a write token. Run: calma-write auth");
    if (accounts.length > 1) throw new ToolError("account_required", "More than one account has a write token. Use --account <email>.");
    email = accounts[0] as string;
  }
  if (!policy.accounts.includes(email)) throw new ToolError("account_not_allowed", "That account is not on the write allow-list.");
  return { email, calendar: cal };
}

/** Creates an event, or with `yes` false only shows what it would create. Nothing is sent until `yes`. */
export async function createEvent(input: EventInput, { yes = false, fetchFn = fetch, env = process.env, now = () => Date.now() }: IoDeps = {}): Promise<any> {
  const target = resolveTarget({ account: input.account, calendar: input.calendar }, env);
  const { body, actor } = buildCreateBody(input, { calendar: target.calendar, now });
  const shown = { summary: body.summary, start: body.start, end: body.end, transparency: body.transparency, visibility: body.visibility, id: body.id };
  if (!yes) return { event: "dry_run", operation: "create", account: target.email, calendar: target.calendar, would_create: shown, hint: "Add --yes to create it." };
  const token = await accessWriteToken(target.email, { fetchFn, env, now });
  const made = await writeRequest({ method: "POST", calendar: target.calendar, rest: "/events", token, body }, { fetchFn });
  appendWriteLog({ at: new Date(now()).toISOString(), op: "create", account: target.email, calendar: target.calendar, eventId: made.id, actor }, env);
  return { event: "created", account: target.email, calendar: target.calendar, id: made.id, summary: made.summary ?? body.summary, start: made.start ?? body.start, end: made.end ?? body.end, link: made.htmlLink };
}

// ---- update -----------------------------------------------------------------------------------------------------

const MARKER_KEYS = ["calma", "calma_actor", "calma_created"];

/** Like text(), for an update: a field can be changed but not blanked (calma-write has no way to clear one). */
function changedText(value: unknown, name: string, max: number) {
  if (value === undefined) return undefined;
  if (value === "") throw bad(`${name} cannot be empty (calma-write cannot clear a field).`);
  return text(value, name, max);
}

/** The new times as sent by Google (date or dateTime only, so a time zone name does not matter). */
const shownTime = (t: any) => (t?.date ? { date: t.date } : t?.dateTime ? { dateTime: t.dateTime } : undefined);

/** A time from an event Google returned, in the shape `when` gives; null if it is not one calma can read. */
function eventTime(t: any): Moment | null {
  const x = t?.date ? { date: t.date, ms: Date.parse(`${t.date}T00:00:00Z`) } : t?.dateTime ? { dateTime: withSeconds(String(t.dateTime)), ms: Date.parse(t.dateTime) } : null;
  return x && !Number.isNaN(x.ms) ? x : null;
}

/** The instant `ms`, written with the same offset as `like` (a dateTime string that ends in Z or +hh:mm). */
function dateTimeLike(like: string, ms: number) {
  const off = /(Z|[+-]\d{2}:\d{2})$/.exec(like)![1] as string;
  const minutes = off === "Z" ? 0 : (off[0] === "-" ? -1 : 1) * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4, 6)));
  return `${new Date(ms + minutes * 60_000).toISOString().slice(0, 19)}${off}`;
}

/** What the caller asked to change, checked without talking to Google. */
function parseChanges(input: EventInput) {
  if (input.free && input.busy) throw bad("--free and --busy cannot be used together.");
  if (input.private && input.public) throw bad("--private and --public cannot be used together.");
  const allDay = Boolean(input.allDay);
  const want = {
    title: changedText(input.title, "title", 1000),
    description: changedText(input.description, "description", 8000),
    location: changedText(input.location, "location", 1000),
    start: input.start === undefined ? undefined : when(input.start, "start", allDay),
    end: input.end === undefined ? undefined : when(input.end, "end", allDay),
    allDay,
    transparency: input.free ? "transparent" : input.busy ? "opaque" : undefined,
    visibility: input.private ? "private" : input.public ? "public" : undefined,
    props: cleanProps(input.props),
  };
  if (allDay && !want.start && !want.end) throw bad("--all-day goes with --start or --end.");
  const any = [want.title, want.description, want.location, want.start, want.end, want.transparency, want.visibility].some((v) => v !== undefined) || Object.keys(want.props).length > 0;
  if (!any) throw new ToolError("nothing_to_change", "Nothing to change: give at least one of --title, --start, --end, --description, --location, --free/--busy, --private/--public, --prop.");
  return want;
}

/**
 * The start and end an update leads to. Same kind of event (timed or all-day): what is not given stays, and a new start
 * without an end keeps the event's length. Switching kind needs --start (and --end unless the result is all-day).
 */
function planTimes(ev: any, want: ReturnType<typeof parseChanges>) {
  const oldStart = eventTime(ev.start);
  const oldEnd = eventTime(ev.end);
  if (!oldStart || !oldEnd) throw new ToolError("google_error", "Google sent an event with times calma cannot read.");
  const wasAllDay = Boolean(oldStart.date);
  let start: Moment;
  let end: Moment | undefined;
  if (want.allDay !== wasAllDay) {
    if (!want.start) throw bad("--start is needed to switch between a timed and an all-day event.");
    start = want.start;
    end = want.end ?? (want.allDay ? { date: addDay(start.date!), ms: Date.parse(`${addDay(start.date!)}T00:00:00Z`) } : undefined);
    if (!end) throw bad("end is required.");
  } else {
    start = want.start ?? oldStart;
    if (want.end) end = want.end;
    else if (!want.start) end = oldEnd;
    else if (wasAllDay) {
      const to = addDays(start.date!, Math.round((oldEnd.ms - oldStart.ms) / 86_400_000));
      end = { date: to, ms: Date.parse(`${to}T00:00:00Z`) };
    } else {
      const ms = start.ms + (oldEnd.ms - oldStart.ms);
      end = { dateTime: dateTimeLike(start.dateTime!, ms), ms };
    }
  }
  if (end === undefined || end.ms <= start.ms) throw bad("end must be after start.");
  const kindChanged = want.allDay !== wasAllDay;
  const same = (a: Moment, b: Moment) => (a.date ? a.date === b.date : a.ms === b.ms);
  return {
    start: kindChanged || !same(start, oldStart) ? { time: start, before: shownTime(ev.start) } : undefined,
    end: kindChanged || !same(end, oldEnd) ? { time: end, before: shownTime(ev.end) } : undefined,
    kindChanged,
  };
}

/** The part of an event body for one time. When the kind changes, the other field is cleared (null) so Google does not keep both. */
const timeBody = (t: Moment, kindChanged: boolean) => (t.date ? { date: t.date, ...(kindChanged ? { dateTime: null } : {}) } : { dateTime: t.dateTime, ...(kindChanged ? { date: null } : {}) });

/** Refuses what no flag may touch: cancelled, recurring and guest events. */
function assertEditable(ev: any) {
  if (ev.status === "cancelled") throw new ToolError("event_cancelled", "That event is cancelled; calma-write does not touch it.");
  if (ev.recurrence !== undefined || ev.recurringEventId !== undefined) throw new ToolError("recurring_event", "That event is part of a repeating series; calma-write never changes or deletes those.");
  if (ev.attendees !== undefined && ev.attendees !== null && (!Array.isArray(ev.attendees) || ev.attendees.length > 0)) throw new ToolError("has_guests", "That event has guests; calma-write never changes or deletes those.");
}

/**
 * Updates one event: reads it, refuses what must not be changed, and PATCHes only what differs (with the etag it read, so
 * a change made in between fails instead of being overwritten). With `yes` false it shows before and after and sends no PATCH.
 */
export async function updateEvent(input: EventInput, { yes = false, fetchFn = fetch, env = process.env, now = () => Date.now() }: IoDeps = {}): Promise<any> {
  const target = resolveTarget({ account: input.account, calendar: input.calendar }, env);
  if (typeof input.id !== "string" || !EVENT_ID.test(input.id)) throw bad("The event id must be 5 to 1024 characters of a-v and 0-9.");
  const actor = cleanActor(input.actor);
  const want = parseChanges(input);
  const rest = `/events/${encodeURIComponent(input.id)}`;
  const token = await accessWriteToken(target.email, { fetchFn, env, now });
  const ev = await writeRequest({ method: "GET", calendar: target.calendar, rest, token }, { fetchFn });
  assertEditable(ev);
  if (typeof ev.etag !== "string") throw new ToolError("google_error", "Google did not send an etag for that event, so it cannot be updated safely.");
  const priv = ev.extendedProperties?.private ?? {};
  const marked = priv.calma === "1";
  if (!marked && !input.anyEvent) throw new ToolError("not_a_calma_event", "That event was not created by calma. Only the owner can allow changing it (--any-event).");

  const changes: Record<string, any> = {}; // field -> { before, after }, for what really differs
  const patch: Record<string, any> = {};
  const set = (field: string, before: any, after: any, bodyValue = after) => {
    changes[field] = { before, after };
    patch[field] = bodyValue;
  };
  if (want.title !== undefined && want.title !== (ev.summary ?? "")) set("summary", ev.summary ?? "", want.title);
  if (want.description !== undefined && want.description !== (ev.description ?? "")) set("description", ev.description ?? "", want.description);
  if (want.location !== undefined && want.location !== (ev.location ?? "")) set("location", ev.location ?? "", want.location);
  if (want.start !== undefined || want.end !== undefined) {
    const times = planTimes(ev, want);
    if (times.start) set("start", times.start.before, shownTime(times.start.time), timeBody(times.start.time, times.kindChanged));
    if (times.end) set("end", times.end.before, shownTime(times.end.time), timeBody(times.end.time, times.kindChanged));
  }
  if (want.transparency !== undefined && want.transparency !== (ev.transparency ?? "opaque")) set("transparency", ev.transparency ?? "opaque", want.transparency);
  if (want.visibility !== undefined && want.visibility !== (ev.visibility ?? "default")) set("visibility", ev.visibility ?? "default", want.visibility);
  const changedProps = Object.keys(want.props).filter((k) => priv[k] !== want.props[k]);
  if (changedProps.length) {
    changes.properties = { before: Object.fromEntries(changedProps.map((k) => [k, priv[k] ?? null])), after: Object.fromEntries(changedProps.map((k) => [k, want.props[k]])) };
  }
  if (Object.keys(changes).length === 0) throw new ToolError("nothing_to_change", "The event already looks like that; nothing to change.");

  const changed = Object.keys(changes);
  if (!yes) return { event: "dry_run", operation: "update", account: target.email, calendar: target.calendar, id: input.id, calma_event: marked, changes, hint: "Add --yes to apply it." };

  // The full private map is sent (not a nested merge), with the marker as read and the update stamps set.
  const merged: Record<string, any> = { ...priv, ...want.props, calma_updated: new Date(now()).toISOString(), calma_updated_by: actor };
  for (const k of MARKER_KEYS) if (k in priv) merged[k] = priv[k];
  const body = { ...patch, extendedProperties: { private: merged } };
  const done = await writeRequest({ method: "PATCH", calendar: target.calendar, rest, token, body, ifMatch: ev.etag }, { fetchFn });
  appendWriteLog({ at: new Date(now()).toISOString(), op: "update", account: target.email, calendar: target.calendar, eventId: input.id, actor }, env);
  return { event: "updated", id: done.id ?? input.id, changed, summary: done.summary ?? patch.summary ?? ev.summary, start: done.start ?? changes.start?.after ?? ev.start, end: done.end ?? changes.end?.after ?? ev.end };
}

// ---- delete -----------------------------------------------------------------------------------------------------

/**
 * Deletes one event. A dry run (the default) reads it and shows what would go; nothing is sent and nothing is logged.
 * With `yes` it reads the event again right before the DELETE and judges that fresh copy, so an event that changed
 * since the preview is checked as it is now. Guests, repeating and cancelled events are refused whatever flags are
 * given (assertEditable, shared with update); an event calma did not create needs `anyEvent`. The tool asks for nothing
 * more: the owner's per-operation yes for bots is an instruction rule, not a check made here.
 */
export async function deleteEvent(input: EventInput, { yes = false, fetchFn = fetch, env = process.env, now = () => Date.now() }: IoDeps = {}): Promise<any> {
  const target = resolveTarget({ account: input.account, calendar: input.calendar }, env);
  if (typeof input.id !== "string" || !EVENT_ID.test(input.id)) throw bad("The event id must be 5 to 1024 characters of a-v and 0-9.");
  const actor = cleanActor(input.actor);
  const rest = `/events/${encodeURIComponent(input.id)}`;
  const token = await accessWriteToken(target.email, { fetchFn, env, now });
  const read = async () => {
    const ev = await writeRequest({ method: "GET", calendar: target.calendar, rest, token, missingIsNotFound: true }, { fetchFn });
    assertEditable(ev);
    const marked = ev.extendedProperties?.private?.calma === "1";
    if (!marked && !input.anyEvent) throw new ToolError("not_a_calma_event", "That event was not created by calma. Only the owner can allow deleting it (--any-event).");
    return { summary: ev.summary ?? "", start: shownTime(ev.start), end: shownTime(ev.end), calma_event: marked };
  };
  const first = await read();
  if (!yes) return { event: "dry_run", operation: "delete", account: target.email, calendar: target.calendar, id: input.id, ...first, would_delete: "This one event. Nobody is emailed (sendUpdates=none).", hint: "Add --yes to delete it." };

  const fresh = await read(); // judged as it is now, not as it was at the preview
  await writeRequest({ method: "DELETE", calendar: target.calendar, rest, token, missingIsNotFound: true }, { fetchFn });
  appendWriteLog({ at: new Date(now()).toISOString(), op: "delete", account: target.email, calendar: target.calendar, eventId: input.id, actor }, env);
  return { event: "deleted", id: input.id, ...fresh };
}
