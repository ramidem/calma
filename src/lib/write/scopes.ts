// The write side of calma (calma-write.mjs and lib/write/*) is the only code that may ask for, hold or use a scope that can
// change anything. The read side (calma.mjs and what it imports) refuses these scopes, and test/write-boundary.test.mjs
// checks that it never imports this folder.
import { ToolError } from "../config.ts";

/** Create, read, update and delete events. Google has no narrower scope for events, and none limited to one calendar. */
export const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Identity only (no mailbox, no calendar): used to learn which address signed in. Google reports `email` back as the userinfo URL. */
const IDENTITY_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/userinfo.email"];
const IDENTITY = new Set<string>(IDENTITY_SCOPES);

/** What calma-write requests. */
export const REQUESTED_WRITE_SCOPES = Object.freeze([WRITE_SCOPE, "openid", "email"]);

/** Throws unless the token carries calendar.events and nothing but identity scopes besides it (no Gmail, no other calendar scope). */
export function assertWriteScopes(scopes: unknown): string[] {
  const raw: unknown[] = Array.isArray(scopes) ? scopes : String(scopes ?? "").split(/\s+/).filter(Boolean);
  const bad = raw.filter((s) => typeof s !== "string" || (s !== WRITE_SCOPE && !IDENTITY.has(s)));
  if (bad.length) throw new ToolError("scope_refused", `Refusing scope(s) other than calendar.events (and identity): ${bad.join(", ")}`);
  const list = raw as string[];
  if (!list.includes(WRITE_SCOPE)) throw new ToolError("scope_refused", "The token does not carry the calendar.events scope.");
  return list;
}
