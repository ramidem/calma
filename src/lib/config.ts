// Accounts, scopes and where the secrets live. Nothing in this folder ever writes to the repo.
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { asRec } from "./record.ts";
import type { Env, TokenInput, ToolErrorCode } from "./types.ts";

/** The only scopes this tool will ever request or accept. Both are read-only. */
export const ALLOWED_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
]);

const ALLOWED = new Set<string>(ALLOWED_SCOPES);

export class ToolError extends Error {
  code: ToolErrorCode;
  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Throws unless every scope is one of the two read-only scopes. */
export function assertScopes(scopes: unknown): string[] {
  const raw: unknown[] = Array.isArray(scopes) ? scopes : String(scopes ?? "").split(/\s+/).filter(Boolean);
  const bad = raw.filter((s) => typeof s !== "string" || !ALLOWED.has(s));
  if (bad.length) throw new ToolError("scope_refused", `Refusing scope(s) outside gmail.readonly and calendar.readonly: ${bad.join(", ")}`);
  return raw as string[];
}

export const configDir = (env: Env = process.env) => env.CALMA_DIR || join(homedir(), ".config", "calma");
/** Where write tokens live (see lib/write/tokens.mjs). The read side only needs the path, to remove them on uninstall. */
export const writeDir = (env: Env = process.env) => join(configDir(env), "write");
export const tokenPath = (name: string, env: Env = process.env) => join(configDir(env), `${name}.json`);
/** MAIL_CLIENT_FILE, else client.json in the config folder. */
export const clientPath = (env: Env = process.env) => env.MAIL_CLIENT_FILE || join(configDir(env), "client.json");

/** Creates the folder with mode 700 (and tightens it if it already exists). */
export function ensureConfigDir(env: Env = process.env) {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

/** Writes a file with mode 600, never wider, even if it already existed. */
export function writeSecretFile(path: string, text: string) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Reads the OAuth client from client.json: Google's download ("installed" or "web") or a flat {client_id, client_secret}. */
export function loadClient(env: Env = process.env) {
  const path = clientPath(env);
  if (!existsSync(path)) throw new ToolError("no_client", "No OAuth client file found (MAIL_CLIENT_FILE, or client.json in the config folder). See README.md, setup.");
  if ((statSync(path).mode & 0o077) !== 0) process.stderr.write("warning: the OAuth client file is readable by others; run chmod 600 on it\n");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ToolError("bad_client", "The OAuth client file is not valid JSON.");
  }
  const root = asRec(raw);
  const c = asRec(root.installed ?? root.web ?? raw);
  if (!c.client_id || !c.client_secret) throw new ToolError("bad_client", "The OAuth client file needs client_id and client_secret.");
  return { client_id: String(c.client_id), client_secret: String(c.client_secret) };
}

export function loadToken(name: string, env: Env = process.env): Record<string, any> {
  const path = tokenPath(name, env);
  if (!existsSync(path)) throw new ToolError("reauth_needed", "No token for this account. Run: calma auth");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  } catch {
    throw new ToolError("reauth_needed", "The token file for this account is unreadable. Run: calma auth");
  }
}

export function saveToken(name: string, token: TokenInput, env: Env = process.env) {
  assertScopes(token.scope);
  ensureConfigDir(env);
  writeSecretFile(tokenPath(name, env), JSON.stringify(token, null, 2));
}
