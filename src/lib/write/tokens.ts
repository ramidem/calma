// Write tokens live apart from read tokens: ~/.config/calma/write/<address>.json (folder 700, files 600). A read command
// never looks here and a write command never looks at the read token, so a read token can never carry a write scope.
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeEmail } from "../accounts.ts";
import { ToolError, ensureConfigDir, writeDir, writeSecretFile } from "../config.ts";
import type { Env, TokenInput } from "../types.ts";
import { assertWriteScopes } from "./scopes.ts";

const REAUTH = "Run: calma-write auth";

export const writeTokenPath = (email: string, env: Env = process.env) => join(writeDir(env), `${email}.json`);

export function saveWriteToken(email: string, token: TokenInput, env: Env = process.env) {
  assertWriteScopes(token.scope);
  ensureConfigDir(env);
  mkdirSync(writeDir(env), { recursive: true, mode: 0o700 });
  chmodSync(writeDir(env), 0o700);
  writeSecretFile(writeTokenPath(email, env), JSON.stringify(token, null, 2));
}

export function loadWriteToken(email: string, env: Env = process.env): Record<string, any> {
  const path = writeTokenPath(email, env);
  if (!existsSync(path)) throw new ToolError("reauth_needed", `No write token for this account. ${REAUTH}`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  } catch {
    throw new ToolError("reauth_needed", `The write token for this account is unreadable. ${REAUTH}`);
  }
}

/** Addresses with a write token (JSON with a scope), sorted. */
export function listWriteAccounts(env: Env = process.env): string[] {
  const dir = writeDir(env);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .filter((stem) => {
      try {
        return normalizeEmail(stem) === stem && typeof JSON.parse(readFileSync(join(dir, `${stem}.json`), "utf8")).scope === "string";
      } catch {
        return false;
      }
    })
    .sort();
}
