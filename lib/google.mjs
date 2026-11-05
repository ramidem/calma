// Read-only Google API access. Every request is a GET to an allow-listed read endpoint.
import { ToolError } from "./config.mjs";
import { accessToken } from "./oauth.mjs";

const ALLOWED = [
  // Gmail message and thread ids are hex, so no named action path can match.
  { host: "gmail.googleapis.com", path: /^\/gmail\/v1\/users\/me\/(profile|(messages|threads)(\/[0-9a-f]{6,32})?)$/i },
  { host: "www.googleapis.com", path: /^\/calendar\/v3\/calendars\/primary\/events$/ },
];

/** The single doorway to Google's data APIs. Anything but a GET to an allow-listed read path throws. */
export async function readGet(url, token, { fetchFn = fetch, method = "GET" } = {}) {
  const u = new URL(url);
  if (method !== "GET") throw new ToolError("read_only", "This tool only makes GET requests.");
  if (u.protocol !== "https:" || !ALLOWED.some((a) => a.host === u.host && a.path.test(u.pathname))) throw new ToolError("read_only", `Not an allowed read endpoint: ${u.host}${u.pathname}`);
  const res = await fetchFn(u, { method: "GET", headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const reason = body?.error?.status ?? body?.error?.code ?? res.status;
    if (res.status === 401) throw new ToolError("reauth_needed", "Google rejected the access token. Run auth for this account again.");
    throw new ToolError("google_error", `Google answered ${res.status} (${String(reason).replace(/[^A-Za-z0-9_ -]/g, "")}).`);
  }
  return res.json();
}

const header = (msg, name) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

export async function mailRecent(name, query, deps = {}) {
  const token = await accessToken(name, deps);
  const list = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  list.searchParams.set("maxResults", "20");
  list.searchParams.set("q", query || "newer_than:7d");
  const { messages = [] } = await readGet(list, token, deps);
  const out = [];
  for (const { id } of messages) {
    const u = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
    u.searchParams.set("format", "metadata");
    for (const h of ["From", "To", "Subject", "Date"]) u.searchParams.append("metadataHeaders", h);
    const m = await readGet(u, token, deps);
    out.push({ id: m.id, threadId: m.threadId, date: header(m, "Date"), from: header(m, "From"), to: header(m, "To"), subject: header(m, "Subject"), snippet: m.snippet ?? "", labels: m.labelIds ?? [] });
  }
  return { account: name, query: query || "newer_than:7d", count: out.length, messages: out };
}

function textOf(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  return (part.parts ?? []).map(textOf).filter(Boolean).join("\n");
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

export async function calendarWeek(name, deps = {}) {
  const token = await accessToken(name, deps);
  const { start, end } = weekRange(deps.now?.() ? new Date(deps.now()) : new Date());
  const u = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
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
  return { account: name, from: start.toISOString(), to: end.toISOString(), count: events.length, events };
}
