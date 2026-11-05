// Accounts are discovered, not configured: an account is a token file named after the address Google reported at sign-in
// (~/.config/calma/<address>.json). This module validates addresses, lists the signed-in ones and picks the one a
// command should use.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ToolError, configDir, tokenPath } from "./config.mjs";

const ADDRESS = /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Trims and lower-cases an address, and refuses anything that is not a plain address. The result becomes part of a file
 * name, so this is what keeps it inside the config folder: no slashes, backslashes, spaces, "..", or a second "@".
 */
export function normalizeEmail(input) {
  const email = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (email.length === 0 || email.length > 254 || email.includes("..") || !ADDRESS.test(email)) {
    throw new ToolError("bad_email", "That is not a valid email address.");
  }
  return email;
}

/** Addresses with a calma token file (JSON with a `scope`), sorted. Files whose name is not a canonical address are ignored. */
export function listAccounts(env = process.env) {
  const dir = configDir(env);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .filter((stem) => {
      try {
        if (normalizeEmail(stem) !== stem) return false;
        return typeof JSON.parse(readFileSync(join(dir, `${stem}.json`), "utf8")).scope === "string";
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * The account a command should use. With `--account <email>`: that address (it must be signed in). Without: the only
 * signed-in account; none or several is an error that says what to do.
 */
export function resolveAccount(flag, env = process.env) {
  if (flag !== undefined) {
    const email = normalizeEmail(flag);
    if (!existsSync(tokenPath(email, env))) throw new ToolError("reauth_needed", "That account is not signed in. Run: calma auth");
    return email;
  }
  const accounts = listAccounts(env);
  if (accounts.length === 0) throw new ToolError("reauth_needed", "No account is signed in. Run: calma auth");
  if (accounts.length > 1) throw new ToolError("account_required", "More than one account is signed in. Use --account <email>; run `calma accounts` to list them.");
  return accounts[0];
}
