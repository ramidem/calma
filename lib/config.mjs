// Accounts, scopes and where the secrets live. Nothing in this folder ever writes to the repo.
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The only scopes this tool will ever request or accept. Both are read-only. */
export const ALLOWED_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
]);

export class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Throws unless every scope is one of the two read-only scopes. */
export function assertScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes : String(scopes ?? "").split(/\s+/).filter(Boolean);
  const bad = list.filter((s) => !ALLOWED_SCOPES.includes(s));
  if (bad.length) throw new ToolError("scope_refused", `Refusing scope(s) outside gmail.readonly and calendar.readonly: ${bad.join(", ")}`);
  return list;
}

export const configDir = (env = process.env) => env.CALMA_DIR || join(homedir(), ".config", "calma");
/** Where write tokens live (see lib/write/tokens.mjs). The read side only needs the path, to remove them on uninstall. */
export const writeDir = (env = process.env) => join(configDir(env), "write");
export const tokenPath = (name, env = process.env) => join(configDir(env), `${name}.json`);
/** MAIL_CLIENT_FILE, else client.json in the config folder. */
export const clientPath = (env = process.env) => env.MAIL_CLIENT_FILE || join(configDir(env), "client.json");

/** Creates the folder with mode 700 (and tightens it if it already exists). */
export function ensureConfigDir(env = process.env) {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

/** Writes a file with mode 600, never wider, even if it already existed. */
export function writeSecretFile(path, text) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Reads the OAuth client from client.json: Google's download ("installed" or "web") or a flat {client_id, client_secret}. */
export function loadClient(env = process.env) {
  const path = clientPath(env);
  if (!existsSync(path)) throw new ToolError("no_client", "No OAuth client file found (MAIL_CLIENT_FILE, or client.json in the config folder). See README.md, setup.");
  if ((statSync(path).mode & 0o077) !== 0) process.stderr.write("warning: the OAuth client file is readable by others; run chmod 600 on it\n");
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ToolError("bad_client", "The OAuth client file is not valid JSON.");
  }
  const c = raw.installed ?? raw.web ?? raw;
  if (!c.client_id || !c.client_secret) throw new ToolError("bad_client", "The OAuth client file needs client_id and client_secret.");
  return { client_id: c.client_id, client_secret: c.client_secret };
}

export function loadToken(name, env = process.env) {
  const path = tokenPath(name, env);
  if (!existsSync(path)) throw new ToolError("reauth_needed", "No token for this account. Run: calma auth");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ToolError("reauth_needed", "The token file for this account is unreadable. Run: calma auth");
  }
}

export function saveToken(name, token, env = process.env) {
  assertScopes(token.scope);
  ensureConfigDir(env);
  writeSecretFile(tokenPath(name, env), JSON.stringify(token, null, 2));
}
