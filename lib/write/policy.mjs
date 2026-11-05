// What calma-write may touch, kept in ~/.config/calma/write.json (never in the repo: it holds addresses and calendar ids):
//   { "accounts": ["<address>", ...], "calendars": ["primary", "<calendar id>", ...] }
// Nothing is writable until Med has allowed it here. This file is a guard inside the tool, not a lock: any process
// running as the same user can edit it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeEmail } from "../accounts.mjs";
import { ToolError, configDir, ensureConfigDir, writeSecretFile } from "../config.mjs";

export const policyPath = (env = process.env) => join(configDir(env), "write.json");

const CALENDAR_ID = /^[A-Za-z0-9][A-Za-z0-9._+@-]{0,253}$/; // no "%": it could smuggle an encoded slash

/** "primary" or a calendar id such as "<hash>@group.calendar.google.com". No slashes, spaces or "..": it goes into a URL path. */
export function normalizeCalendarId(input) {
  const id = typeof input === "string" ? input.trim() : "";
  if (!CALENDAR_ID.test(id) || id.includes("..")) throw new ToolError("bad_calendar", "That is not a valid calendar id. Use \"primary\" or the id shown in the calendar's settings.");
  return id;
}

export function loadPolicy(env = process.env) {
  const path = policyPath(env);
  if (!existsSync(path)) return { accounts: [], calendars: [] };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ToolError("bad_policy", "write.json is not valid JSON.");
  }
  const list = (v) => (Array.isArray(v) ? v : []);
  return { accounts: [...new Set(list(raw.accounts).map(normalizeEmail))], calendars: [...new Set(list(raw.calendars).map(normalizeCalendarId))] };
}

function savePolicy(policy, env) {
  ensureConfigDir(env);
  writeSecretFile(policyPath(env), JSON.stringify(policy, null, 2));
}

/** Adds an address to the allow-list (idempotent). */
export function allowAccount(address, env = process.env) {
  const policy = loadPolicy(env);
  const email = normalizeEmail(address);
  if (!policy.accounts.includes(email)) savePolicy({ ...policy, accounts: [...policy.accounts, email] }, env);
  return loadPolicy(env);
}

/** Adds a calendar id to the allow-list (idempotent). */
export function allowCalendar(id, env = process.env) {
  const policy = loadPolicy(env);
  const calendar = normalizeCalendarId(id);
  if (!policy.calendars.includes(calendar)) savePolicy({ ...policy, calendars: [...policy.calendars, calendar] }, env);
  return loadPolicy(env);
}
