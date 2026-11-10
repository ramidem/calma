// Read-only Google API access. Every request is a GET to an allow-listed read endpoint.
import { ToolError } from "./config.mjs";
import { fetchWithTimeout, mapLimit, readJson } from "./net.mjs";
import { accessToken } from "./oauth.mjs";

// Calendar ids are validated first (no "%", no ".."), then percent-encoded into the path. The path allow-list
// therefore accepts primary or one encoded segment with no slash.
const ALLOWED = [
  // Gmail message and thread ids are hex, so no named action path can match.
  { host: "gmail.googleapis.com", path: /^\/gmail\/v1\/users\/me\/(profile|(messages|threads)(\/[0-9a-f]{6,32})?)$/i },
  { host: "www.googleapis.com", path: /^\/calendar\/v3\/calendars\/(primary|[A-Za-z0-9._~%-]+)\/events$/ },
];

const CALENDAR_ID = /^[A-Za-z0-9][A-Za-z0-9._+@-]{0,253}$/; // same rule as write; no "%": it could smuggle an encoded slash

/** "primary" or a calendar id such as "<hash>@group.calendar.google.com". */
export function normalizeCalendarId(input) {
  const id = typeof input === "string" ? input.trim() : "";
  if (!CALENDAR_ID.test(id) || id.includes("..")) throw new ToolError("bad_calendar", "That is not a valid calendar id. Use \"primary\" or the id shown in the calendar's settings.");
  return id;
}

/** The single doorway to Google's data APIs. Anything but a GET to an allow-listed read path throws. */
export async function readGet(url, token, { fetchFn = fetch, method = "GET" } = {}) {
  const u = new URL(url);
  if (method !== "GET") throw new ToolError("read_only", "This tool only makes GET requests.");
  if (u.protocol !== "https:" || !ALLOWED.some((a) => a.host === u.host && a.path.test(u.pathname))) throw new ToolError("read_only", `Not an allowed read endpoint: ${u.host}${u.pathname}`);
  const res = await fetchWithTimeout(fetchFn, u, { method: "GET", headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await readJson(res);
    const reason = body?.error?.status ?? body?.error?.code ?? res.status;
    if (res.status === 401) throw new ToolError("reauth_needed", "Google rejected the access token. Run auth for this account again.");
    throw new ToolError("google_error", `Google answered ${res.status} (${String(reason).replace(/[^A-Za-z0-9_ -]/g, "")}).`);
  }
  return readJson(res, { strict: true });
}

const header = (msg, name) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

export async function mailRecent(name, query, deps = {}) {
  const token = await accessToken(name, deps);
  const list = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  list.searchParams.set("maxResults", "20");
  list.searchParams.set("q", query || "newer_than:7d");
  const { messages = [], nextPageToken } = await readGet(list, token, deps);
  const out = await mapLimit(messages, 5, async ({ id }) => {
    const u = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
    u.searchParams.set("format", "metadata");
    for (const h of ["From", "To", "Subject", "Date"]) u.searchParams.append("metadataHeaders", h);
    const m = await readGet(u, token, deps);
    return { id: m.id, threadId: m.threadId, date: header(m, "Date"), from: header(m, "From"), to: header(m, "To"), subject: header(m, "Subject"), snippet: m.snippet ?? "", labels: m.labelIds ?? [] };
  });
  // `more` is true when the query matched more than the 20 listed.
  return { account: name, query: query || "newer_than:7d", count: out.length, more: Boolean(nextPageToken), messages: out };
}

/** Midnight at the start of the local day containing `now`. */
export function localMidnight(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Mail since local midnight. `extra` is more Gmail search terms (for example "in:inbox"), added to the date. */
export async function mailToday(name, extra, deps = {}) {
  const since = localMidnight(deps.now?.() ? new Date(deps.now()) : new Date());
  const query = [`after:${Math.floor(since.getTime() / 1000)}`, extra].filter(Boolean).join(" ");
  const result = await mailRecent(name, query, deps);
  return { account: result.account, since: since.toISOString(), query: result.query, count: result.count, more: result.more, messages: result.messages };
}

const decode = (part) => Buffer.from(part.body.data, "base64url").toString("utf8");

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", copy: "\u00a9", bull: "\u2022" };

function decodeEntity(ent) {
  if (ent[0] !== "#") return NAMED[ent.toLowerCase()];
  const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : undefined;
}

/** Crude HTML to text for mail that has no plain-text part: drops script and style, turns breaks into newlines, strips tags. */
export function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    // One pass, so "&amp;lt;" becomes "&lt;" and not "<".
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent) => decodeEntity(ent) ?? whole)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collect(part, mime) {
  if (!part) return [];
  const here = part.mimeType === mime && part.body?.data ? [decode(part)] : [];
  return [...here, ...(part.parts ?? []).flatMap((p) => collect(p, mime))];
}

/** The plain-text body; if the message has none, the HTML body converted to text. */
function textOf(part) {
  const plain = collect(part, "text/plain").join("\n");
  return plain || collect(part, "text/html").map(htmlToText).join("\n");
}
function attachmentsOf(part) {
  const here = part.filename ? [{ filename: part.filename, mimeType: part.mimeType, size: part.body?.size ?? 0 }] : [];
  return [...here, ...(part.parts ?? []).flatMap(attachmentsOf)];
}

export async function mailThread(name, threadId, deps = {}) {
  if (!/^[0-9a-f]{6,32}$/i.test(threadId ?? "")) throw new ToolError("bad_args", "threadId must be the hex id from mail-recent.");
  const token = await accessToken(name, deps);
  const u = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`);
  u.searchParams.set("format", "full");
  const t = await readGet(u, token, deps);
  const messages = (t.messages ?? []).map((m) => ({
    id: m.id,
    date: header(m, "Date"),
    from: header(m, "From"),
    to: header(m, "To"),
    cc: header(m, "Cc"),
    subject: header(m, "Subject"),
    body: textOf(m.payload).slice(0, 20_000),
    attachments: attachmentsOf(m.payload ?? {}),
  }));
  return { account: name, threadId: t.id, count: messages.length, messages };
}

/** Monday 00:00 of the current week (machine local time) to the next Monday 00:00. */
export function weekRange(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

const MAX_RANGE_MS = 31 * 24 * 3600 * 1000;

/** Resolve the [start, end) window: explicit from/to, else the current local week. */
export function calendarRange({ from, to, now = new Date() } = {}) {
  if (from === undefined && to === undefined) return weekRange(now);
  if (from === undefined || to === undefined) throw new ToolError("bad_args", "calendar-week needs both --from and --to, or neither.");
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new ToolError("bad_args", "--from and --to must be ISO datetimes or dates.");
  if (end <= start) throw new ToolError("bad_args", "--to must be after --from.");
  if (end - start > MAX_RANGE_MS) throw new ToolError("bad_args", "calendar-week range is at most 31 days.");
  return { start, end };
}

/**
 * List events on one calendar for a week (default) or an explicit range.
 * `calendar` defaults to primary; other ids must look like Google calendar ids (same rule as calma-write).
 */
export async function calendarWeek(name, deps = {}) {
  const token = await accessToken(name, deps);
  const calendar = normalizeCalendarId(deps.calendar ?? "primary");
  const { start, end } = calendarRange({
    from: deps.from,
    to: deps.to,
    now: deps.now?.() ? new Date(deps.now()) : new Date(),
  });
  const u = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events`);
  u.searchParams.set("timeMin", start.toISOString());
  u.searchParams.set("timeMax", end.toISOString());
  u.searchParams.set("singleEvents", "true");
  u.searchParams.set("orderBy", "startTime");
  u.searchParams.set("maxResults", "250");
  const { items = [] } = await readGet(u, token, deps);
  const events = items.map((e) => ({
    id: e.id,
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    allDay: Boolean(e.start?.date),
    location: e.location ?? null,
    status: e.status ?? null,
    attendees: (e.attendees ?? []).length,
  }));
  return { account: name, calendar, from: start.toISOString(), to: end.toISOString(), count: events.length, events };
}
