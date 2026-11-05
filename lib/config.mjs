// Accounts, scopes and where the secrets live. Nothing in this folder ever writes to the repo.
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The only scopes this tool will ever request or accept. Both are read-only. */
export const ALLOWED_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
]);

// Accounts are not in the code. Each one is an environment variable, MAIL_ACCOUNT_<NAME>=<address>, and <NAME> in
// lower case is the account label used on the command line. See .env.example.
const ACCOUNT_LABEL = /^[a-z][a-z0-9_]{0,30}$/;
const RESERVED_LABELS = new Set(["client", "accounts"]); // files that share the config folder
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/** Throws unless `name` is a valid account label (the shape only; whether it is configured is a separate check). */
export function assertAccountName(name) {
  if (typeof name !== "string" || !ACCOUNT_LABEL.test(name) || RESERVED_LABELS.has(name)) {
    throw new ToolError("unknown_account", "An account label is lower-case letters, digits and _, and must match a MAIL_ACCOUNT_<NAME> variable.");
  }
}

/** The address configured for an account label. Never printed: messages name the variable, not its value. */
export function accountEmail(name, env = process.env) {
  assertAccountName(name);
  const key = `MAIL_ACCOUNT_${name.toUpperCase()}`;
  const value = (env[key] ?? "").trim().toLowerCase();
  if (!value) throw new ToolError("missing_env", `${key} is not set. Set it to this account's address (see .env.example).`);
  if (!EMAIL.test(value)) throw new ToolError("bad_env", `${key} is not an email address.`);
  return value;
}

export const configDir = (env = process.env) => env.CALMA_DIR || join(homedir(), ".config", "calma");
export const tokenPath = (name, env = process.env) => join(configDir(env), `${name}.json`);
/** MAIL_CLIENT_FILE, else client.json in the config folder. */
export const clientPath = (env = process.env) => env.MAIL_CLIENT_FILE || join(configDir(env), "client.json");
export const envFilePath = (env = process.env) => env.MAIL_ENV_FILE || join(configDir(env), "accounts.env");

/** Loads the accounts env file (default: accounts.env in the config folder) into process.env without overriding what is already set. */
export function loadEnvFileIfPresent(env = process.env) {
  const path = envFilePath(env);
  if (!existsSync(path)) return false;
  if ((statSync(path).mode & 0o077) !== 0) process.stderr.write("warning: the accounts env file is readable by others; run chmod 600 on it\n");
  process.loadEnvFile(path);
  return true;
}

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
  if (!existsSync(path)) throw new ToolError("reauth_needed", `No token for "${name}". Run: calma auth ${name}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ToolError("reauth_needed", `The token file for "${name}" is unreadable. Run: calma auth ${name}`);
  }
}

export function saveToken(name, token, env = process.env) {
  assertScopes(token.scope);
  ensureConfigDir(env);
  writeSecretFile(tokenPath(name, env), JSON.stringify(token, null, 2));
}
