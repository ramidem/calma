// Removes calma's local files and revokes the Google grants. Touches only files this tool owns inside its own config
// folder; anything else in that folder (and the folder itself, then) is left alone.
import { existsSync, readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { ToolError, assertAccountName, clientPath, configDir, envFilePath, tokenPath } from "./config.mjs";
import { revokeToken } from "./oauth.mjs";

const TOKEN_FILE = /^([a-z][a-z0-9_]{0,30})\.json$/;

/** A calma token file: JSON with a granted scope. Anything else in the folder is not ours to remove. */
function isTokenFile(label, env) {
  try {
    return typeof JSON.parse(readFileSync(tokenPath(label, env), "utf8")).scope === "string";
  } catch {
    return false;
  }
}

const inConfigDir = (path, env) => resolve(dirname(path)) === resolve(configDir(env));

/** What an uninstall would remove, by file name only. `target` is an account label or "--all". */
export function planUninstall(target, env = process.env) {
  const dir = configDir(env);
  if (target !== "--all") {
    assertAccountName(target);
    return { tokens: isTokenFile(target, env) ? [target] : [], others: [], outside: [] };
  }
  const tokens = existsSync(dir) ? readdirSync(dir).map((f) => TOKEN_FILE.exec(f)?.[1]).filter((l) => l && l !== "client" && l !== "accounts" && isTokenFile(l, env)) : [];
  const others = [];
  const outside = [];
  for (const path of [clientPath(env), envFilePath(env)]) {
    if (!existsSync(path)) continue;
    (inConfigDir(path, env) ? others : outside).push(basename(path));
  }
  return { tokens, others, outside };
}

/** Dry run unless `yes`. With `yes`: revoke each token at Google (best effort), then remove the files. */
export async function uninstall(target, { yes = false, fetchFn = fetch, env = process.env } = {}) {
  const { tokens, others, outside } = planUninstall(target, env);
  const names = [...tokens.map((t) => `${t}.json`), ...others];
  if (!yes) return { event: "dry_run", would_remove: names, kept_outside_config_folder: outside, hint: "Add --yes to do it." };

  const revoked = {};
  for (const label of tokens) {
    let secret = null;
    try {
      const tok = JSON.parse(readFileSync(tokenPath(label, env), "utf8"));
      secret = tok.refresh_token || tok.access_token || null;
    } catch {
      /* unreadable token file: nothing to revoke, still remove it */
    }
    revoked[label] = secret ? await revokeToken(secret, { fetchFn }) : false;
    rmSync(tokenPath(label, env), { force: true });
  }
  for (const path of [clientPath(env), envFilePath(env)]) {
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
  const notRevoked = Object.keys(revoked).filter((l) => !revoked[l]);
  return {
    event: "uninstalled",
    removed: names,
    revoked,
    folder_removed: folderRemoved,
    kept_outside_config_folder: outside,
    note: notRevoked.length ? "Some grants could not be revoked (already expired or offline). Remove calma under Third-party access in the Google account to be sure." : undefined,
  };
}
