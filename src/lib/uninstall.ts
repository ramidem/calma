// Removes calma's local files and revokes the Google grants. Touches only files this tool owns inside its own config
// folder; anything else in that folder (and the folder itself, then) is left alone.
import { existsSync, readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { normalizeEmail } from "./accounts.ts";
import { clientPath, configDir, tokenPath, writeDir } from "./config.ts";
import { revokeToken } from "./oauth.ts";
import type { Env, FetchLike } from "./types.ts";

// Token files are named <address>.json. Versions before address sign-in named them <label>.json and kept the account
// list in accounts.env; `--all` still cleans those up. Write tokens (calma-write) sit in write/, next to write.json (the
// allow-list) and write.log; they are removed and revoked here too, so one uninstall cuts all access.
const LEGACY_LABEL = /^[a-z][a-z0-9_]{0,30}$/;
const legacyEnvPath = (env: Env) => join(configDir(env), "accounts.env");
const OWN_FILES = ["write.json", "write.log"];
const writeTokenFile = (stem: string, env: Env) => join(writeDir(env), `${stem}.json`);

const hasScope = (path: string) => {
  try {
    return typeof JSON.parse(readFileSync(path, "utf8")).scope === "string";
  } catch {
    return false;
  }
};

/** A calma token file: JSON with a granted scope. Anything else in the folder is not ours to remove. */
const isTokenFile = (stem: string, env: Env) => hasScope(tokenPath(stem, env));
const isWriteTokenFile = (stem: string, env: Env) => hasScope(writeTokenFile(stem, env));

function ownedName(stem: string) {
  if (stem === "client") return false;
  if (LEGACY_LABEL.test(stem)) return true;
  try {
    return normalizeEmail(stem) === stem;
  } catch {
    return false;
  }
}

const jsonStems = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)) : []);
const inConfigDir = (path: string, env: Env) => resolve(dirname(path)) === resolve(configDir(env));

/**
 * What an uninstall would remove, by file name only. `target` is an address (that account's tokens, read and write) or
 * "--all". `unrecognized` names address- or label-shaped .json files that are not calma tokens.
 */
export function planUninstall(target: string, env: Env = process.env) {
  if (target !== "--all") {
    const email = normalizeEmail(target);
    return { tokens: isTokenFile(email, env) ? [email] : [], writeTokens: isWriteTokenFile(email, env) ? [email] : [], others: [] as string[], outside: [] as string[], unrecognized: [] as string[] };
  }
  const stems = jsonStems(configDir(env)).filter(ownedName);
  const tokens = stems.filter((s) => isTokenFile(s, env)).sort();
  const unrecognized = stems.filter((s) => !tokens.includes(s)).sort().map((s) => `${s}.json`);
  const writeTokens = jsonStems(writeDir(env)).filter((s) => ownedName(s) && isWriteTokenFile(s, env)).sort();
  const others: string[] = [];
  const outside: string[] = [];
  for (const path of [clientPath(env), legacyEnvPath(env), ...OWN_FILES.map((f) => join(configDir(env), f))]) {
    if (!existsSync(path)) continue;
    (inConfigDir(path, env) ? others : outside).push(basename(path));
  }
  return { tokens, writeTokens, others, outside, unrecognized };
}

function secretOf(path: string): string | null {
  try {
    const tok = JSON.parse(readFileSync(path, "utf8")) as { refresh_token?: unknown; access_token?: unknown };
    const secret = tok.refresh_token || tok.access_token || null;
    if (typeof secret === "string") return secret;
    return secret ? String(secret) : null;
  } catch {
    return null; // unreadable token file: nothing to revoke, still remove it
  }
}

/** Dry run unless `yes`. With `yes`: revoke each token at Google (best effort), then remove the files. */
export async function uninstall(target: string, { yes = false, fetchFn = fetch, env = process.env }: { yes?: boolean; fetchFn?: FetchLike; env?: Env } = {}): Promise<any> {
  const { tokens, writeTokens, others, outside, unrecognized } = planUninstall(target, env);
  const names = [...tokens.map((t) => `${t}.json`), ...writeTokens.map((t) => `write/${t}.json`), ...others];
  if (!yes) return { event: "dry_run", would_remove: names, kept_outside_config_folder: outside, kept_not_a_token: unrecognized, hint: "Add --yes to do it." };

  const revoked: Record<string, boolean> = {};
  const drop = async (key: string, path: string) => {
    const secret = secretOf(path);
    revoked[key] = secret ? await revokeToken(secret, { fetchFn }) : false;
    rmSync(path, { force: true });
  };
  for (const stem of tokens) await drop(stem, tokenPath(stem, env));
  for (const stem of writeTokens) await drop(`write/${stem}`, writeTokenFile(stem, env));
  if (target === "--all") {
    for (const path of [clientPath(env), legacyEnvPath(env), ...OWN_FILES.map((f) => join(configDir(env), f))]) {
      if (inConfigDir(path, env)) rmSync(path, { force: true });
    }
  }
  let folderRemoved = false;
  if (target === "--all") {
    for (const dir of [writeDir(env), configDir(env)]) {
      try {
        rmdirSync(dir); // only succeeds when empty
        folderRemoved = dir === configDir(env);
      } catch {
        /* not empty or already gone */
      }
    }
  }
  const notRevoked = Object.keys(revoked).filter((s) => !revoked[s]);
  return {
    event: "uninstalled",
    removed: names,
    revoked,
    folder_removed: folderRemoved,
    kept_outside_config_folder: outside,
    kept_not_a_token: unrecognized,
    note: notRevoked.length ? "Some grants could not be revoked (already expired or offline). Remove calma under Third-party access in the Google account to be sure." : undefined,
  };
}
