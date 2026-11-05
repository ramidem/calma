// Removes calma's local files and revokes the Google grants. Touches only files this tool owns inside its own config
// folder; anything else in that folder (and the folder itself, then) is left alone.
import { existsSync, readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { normalizeEmail } from "./accounts.mjs";
import { clientPath, configDir, tokenPath } from "./config.mjs";
import { revokeToken } from "./oauth.mjs";

// Token files are named <address>.json. Versions before address sign-in named them <label>.json and kept the account
// list in accounts.env; `--all` still cleans those up.
const LEGACY_LABEL = /^[a-z][a-z0-9_]{0,30}$/;
const legacyEnvPath = (env) => join(configDir(env), "accounts.env");

/** A calma token file: JSON with a granted scope. Anything else in the folder is not ours to remove. */
function isTokenFile(stem, env) {
  try {
    return typeof JSON.parse(readFileSync(tokenPath(stem, env), "utf8")).scope === "string";
  } catch {
    return false;
  }
}

function ownedName(stem) {
  if (stem === "client") return false;
  if (LEGACY_LABEL.test(stem)) return true;
  try {
    return normalizeEmail(stem) === stem;
  } catch {
    return false;
  }
}

const inConfigDir = (path, env) => resolve(dirname(path)) === resolve(configDir(env));

/**
 * What an uninstall would remove, by file name only. `target` is an address (that account's token) or "--all".
 * `kept_not_a_token` names address- or label-shaped .json files that are not calma tokens.
 */
export function planUninstall(target, env = process.env) {
  if (target !== "--all") {
    const email = normalizeEmail(target);
    return { tokens: isTokenFile(email, env) ? [email] : [], others: [], outside: [], unrecognized: [] };
  }
  const dir = configDir(env);
  const stems = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)).filter(ownedName) : [];
  const tokens = stems.filter((s) => isTokenFile(s, env)).sort();
  const unrecognized = stems.filter((s) => !tokens.includes(s)).sort().map((s) => `${s}.json`);
  const others = [];
  const outside = [];
  for (const path of [clientPath(env), legacyEnvPath(env)]) {
    if (!existsSync(path)) continue;
    (inConfigDir(path, env) ? others : outside).push(basename(path));
  }
  return { tokens, others, outside, unrecognized };
}

/** Dry run unless `yes`. With `yes`: revoke each token at Google (best effort), then remove the files. */
export async function uninstall(target, { yes = false, fetchFn = fetch, env = process.env } = {}) {
  const { tokens, others, outside, unrecognized } = planUninstall(target, env);
  const names = [...tokens.map((t) => `${t}.json`), ...others];
  if (!yes) return { event: "dry_run", would_remove: names, kept_outside_config_folder: outside, kept_not_a_token: unrecognized, hint: "Add --yes to do it." };

  const revoked = {};
  for (const stem of tokens) {
    let secret = null;
    try {
      const tok = JSON.parse(readFileSync(tokenPath(stem, env), "utf8"));
      secret = tok.refresh_token || tok.access_token || null;
    } catch {
      /* unreadable token file: nothing to revoke, still remove it */
    }
    revoked[stem] = secret ? await revokeToken(secret, { fetchFn }) : false;
    rmSync(tokenPath(stem, env), { force: true });
  }
  for (const path of [clientPath(env), legacyEnvPath(env)]) {
    if (target === "--all" && inConfigDir(path, env)) rmSync(path, { force: true });
  }
  let folderRemoved = false;
  if (target === "--all") {
    try {
      rmdirSync(configDir(env)); // only succeeds when empty
      folderRemoved = true;
    } catch {
      /* not empty or already gone */
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
