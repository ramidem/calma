// Calendar event writes. The only place in calma that can change a calendar. Every request goes through writeRequest, which
// allows exactly the calls listed in ALLOWED and nothing else; bodies are built from a fixed set of fields, so there is no
// way to add guests, recurrence, video calls or reminders, and sendUpdates is always "none".
import { createHash } from "node:crypto";
import { normalizeEmail } from "../accounts.mjs";
import { ToolError } from "../config.mjs";
import { fetchWithTimeout, readJson } from "../net.mjs";
import { accessWriteToken } from "./oauth.mjs";
import { appendWriteLog } from "./log.mjs";
import { loadPolicy, normalizeCalendarId } from "./policy.mjs";
import { listWriteAccounts } from "./tokens.mjs";

const API = "https://www.googleapis.com/calendar/v3/calendars";

/** The calls calma-write may make: method, and the path after /calendar/v3/calendars/<calendar>. */
const ALLOWED = [{ method: "POST", rest: /^\/events$/ }];

/** Every field an event body may contain. Anything else (attendees, recurrence, conferenceData, reminders...) is refused. */
const BODY_FIELDS = ["id", "summary", "description", "location", "start", "end", "transparency", "visibility", "extendedProperties"];
const EVENT_ID = /^[a-v0-9]{5,1024}$/;

/**
 * Sends one allowed request to the Calendar API for an allowed calendar. `calendar` is already validated; it is
 * percent-encoded into the path. Returns the parsed JSON body.
 */
export async function writeRequest({ method, calendar, rest, token, body, query = {} }, { fetchFn = fetch } = {}) {
  const call = ALLOWED.find((a) => a.method === method && a.rest.test(rest));
  if (!call) throw new ToolError("write_refused", `calma-write does not make ${method} requests to ${rest}.`);
  const cal = normalizeCalendarId(calendar);
  if (body !== undefined) {
    const extra = Object.keys(body).filter((k) => !BODY_FIELDS.includes(k));
    if (extra.length) throw new ToolError("write_refused", `Event fields not allowed: ${extra.join(", ")}.`);
  }
  const url = new URL(`${API}/${encodeURIComponent(cal)}${rest}`);
  if (url.protocol !== "https:" || url.host !== "www.googleapis.com" || !url.pathname.startsWith("/calendar/v3/calendars/")) throw new ToolError("write_refused", "Not an allowed Calendar URL.");
  url.searchParams.set("sendUpdates", "none"); // never email anyone, whatever the caller passes
  for (const [k, v] of Object.entries(query)) if (k !== "sendUpdates") url.searchParams.set(k, v);
  const res = await fetchWithTimeout(fetchFn, url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const err = await readJson(res);
    const reason = String(err?.error?.status ?? err?.error?.code ?? res.status).replace(/[^A-Za-z0-9_ -]/g, "");
    if (res.status === 401) throw new ToolError("reauth_needed", "Google rejected the write token. Run: calma-write auth");
    if (res.status === 409) throw new ToolError("already_exists", "An event with that id already exists.");
    throw new ToolError("google_error", `Google answered ${res.status} (${reason}).`);
  }
  return readJson(res, { strict: true });
}

// ---- validation -------------------------------------------------------------------------------------------------

const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACTOR = /^[a-z][a-z0-9_-]{0,29}$/;
const PROP_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,59}$/;

const bad = (message) => new ToolError("bad_event", message);

function text(value, name, max, { required = false } = {}) {
  if (value === undefined || value === "") {
    if (required) throw bad(`${name} is required.`);
    return undefined;
  }
  if (typeof value !== "string" || value.length > max) throw bad(`${name} must be text of at most ${max} characters.`);
  return value;
}

/** A real calendar date: month 1-12 and a day that exists in that month (JavaScript's own parser rolls 2026-02-30 over to March). */
function realDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** A real time of day and offset: hours under 24, minutes and seconds under 60. */
function realTime(hms, offset) {
  const [h, mi, se = "0"] = hms.split(":");
  const off = offset === "Z" ? [0, 0] : offset.slice(1).split(":").map(Number);
  return Number(h) < 24 && Number(mi) < 60 && Number(se) < 60 && off[0] < 24 && off[1] < 60;
}

function when(value, name, allDay) {
  if (typeof value !== "string") throw bad(`${name} is required.`);
  if (allDay) {
    if (!DATE.test(value) || !realDate(value)) throw bad(`${name} must be a date like 2026-11-06 for an all-day event.`);
    return { date: value, ms: Date.parse(`${value}T00:00:00Z`) };
  }
  const m = DATETIME.exec(value);
  if (!m || !realDate(value.slice(0, 10)) || !realTime(value.slice(11).replace(/(Z|[+-]\d{2}:\d{2})$/, ""), m[3]) || Number.isNaN(Date.parse(value))) {
    throw bad(`${name} must be a date and time with an offset, like 2026-11-06T09:00:00+08:00 (or Z).`);
  }
  return { dateTime: value, ms: Date.parse(value) };
}

const addDay = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** A deterministic event id from a key, so a retried create cannot make a duplicate (Google answers 409). Hex is valid event-id text. */
export function eventIdFromKey(calendar, key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 200) throw bad("--key must be 1 to 200 characters.");
  const id = createHash("sha256").update(`${calendar}|${key}`).digest("hex").slice(0, 40);
  if (!EVENT_ID.test(id)) throw bad("Could not make an event id from that key.");
  return id;
}

/**
 * The event body for a create, from validated input. The marker (calma, calma_actor, calma_created) is what later lets
 * update and delete tell events calma made from events Med made by hand.
 */
export function buildCreateBody(input, { calendar, now = () => Date.now() } = {}) {
  const summary = text(input.title, "title", 1000, { required: true });
  const description = text(input.description, "description", 8000);
  const location = text(input.location, "location", 1000);
  const allDay = Boolean(input.allDay);
  const start = when(input.start, "start", allDay);
  const end = input.end === undefined && allDay ? { date: addDay(start.date), ms: Date.parse(`${addDay(start.date)}T00:00:00Z`) } : when(input.end, "end", allDay);
  if (end.ms <= start.ms) throw bad("end must be after start.");
  const actor = typeof input.actor === "string" ? input.actor : "";
  if (!ACTOR.test(actor)) throw bad("--actor is required: a short lower-case label for who is asking, like schedule or parenting.");
  const props = {};
  for (const [k, v] of Object.entries(input.props ?? {})) {
    if (!PROP_KEY.test(k) || /^calma/i.test(k)) throw bad(`Property name "${k}" is not allowed (letters, digits, _ . -; not starting with calma).`);
    if (typeof v !== "string" || v.length > 200) throw bad(`Property "${k}" must be text of at most 200 characters.`);
    props[k] = v;
  }
  const body = {
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
export function resolveTarget({ account, calendar }, env = process.env) {
  const policy = loadPolicy(env);
  const cal = normalizeCalendarId(calendar ?? "primary");
  if (!policy.calendars.includes(cal)) throw new ToolError("calendar_not_allowed", "That calendar is not on the write allow-list. Run: calma-write allow --calendar <id>");
  let email;
  if (account !== undefined) email = normalizeEmail(account);
  else {
    const accounts = listWriteAccounts(env);
    if (accounts.length === 0) throw new ToolError("reauth_needed", "No account has a write token. Run: calma-write auth");
    if (accounts.length > 1) throw new ToolError("account_required", "More than one account has a write token. Use --account <email>.");
    email = accounts[0];
  }
  if (!policy.accounts.includes(email)) throw new ToolError("account_not_allowed", "That account is not on the write allow-list.");
  return { email, calendar: cal };
}

/** Creates an event, or with `yes` false only shows what it would create. Nothing is sent until `yes`. */
export async function createEvent(input, { yes = false, fetchFn = fetch, env = process.env, now = () => Date.now() } = {}) {
  const target = resolveTarget({ account: input.account, calendar: input.calendar }, env);
  const { body, actor } = buildCreateBody(input, { calendar: target.calendar, now });
  const shown = { summary: body.summary, start: body.start, end: body.end, transparency: body.transparency, visibility: body.visibility, id: body.id };
  if (!yes) return { event: "dry_run", operation: "create", account: target.email, calendar: target.calendar, would_create: shown, hint: "Add --yes to create it." };
  const token = await accessWriteToken(target.email, { fetchFn, env, now });
  const made = await writeRequest({ method: "POST", calendar: target.calendar, rest: "/events", token, body }, { fetchFn });
  appendWriteLog({ at: new Date(now()).toISOString(), op: "create", account: target.email, calendar: target.calendar, eventId: made.id, actor }, env);
  return { event: "created", account: target.email, calendar: target.calendar, id: made.id, summary: made.summary ?? body.summary, start: made.start ?? body.start, end: made.end ?? body.end, link: made.htmlLink };
}
