#!/usr/bin/env node
// The write side of calma: calendar events only, personal account only, only what write.json allows. calma.mjs never
// imports this file or lib/write/ (test/write-boundary.test.mjs). JSON on stdout only (errors too, with exit code 1).
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ToolError } from "./lib/config.mjs";
import { allowAccount, allowCalendar, loadPolicy } from "./lib/write/policy.mjs";
import { authorizeWrite } from "./lib/write/oauth.mjs";
import { listWriteAccounts } from "./lib/write/tokens.mjs";

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const USAGE = "Usage: calma-write auth [--no-open] | accounts | policy | allow --account <email> | allow --calendar <id>";

/** Splits `--account <email>`, `--calendar <id>` and `--no-open` from the positional words. */
export function parseArgs(argv) {
  const flags = { account: undefined, calendar: undefined, open: true };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--account" || a === "-a" || a === "--calendar") {
      if (i + 1 >= argv.length) throw new ToolError("usage", `${a} needs a value. ${USAGE}`);
      flags[a === "--calendar" ? "calendar" : "account"] = argv[++i];
    } else if (a === "--no-open") flags.open = false;
    else words.push(a);
  }
  return { cmd: words[0], rest: words.slice(1), flags };
}

export async function run(argv, deps = {}) {
  const { cmd, flags } = parseArgs(argv);
  if (!cmd) throw new ToolError("usage", USAGE);
  const out = deps.emit ?? emit;
  const env = deps.env ?? process.env;
  switch (cmd) {
    case "auth":
      return out(await authorizeWrite({ emit: out, ...(flags.open ? {} : { open: null }), ...deps }));
    case "accounts":
      return out({ accounts: listWriteAccounts(env) });
    case "policy":
      return out(loadPolicy(env));
    case "allow": {
      if ((flags.account === undefined) === (flags.calendar === undefined)) throw new ToolError("usage", "allow needs exactly one of --account <email> or --calendar <id>.");
      return out(flags.account !== undefined ? allowAccount(flags.account, env) : allowCalendar(flags.calendar, env));
    }
    default:
      throw new ToolError("usage", `Unknown command "${cmd}". ${USAGE}`);
  }
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run(process.argv.slice(2)).catch((err) => {
    const known = err instanceof ToolError;
    emit({ error: known ? err.code : "unexpected", message: known ? err.message : "Unexpected error." });
    process.exit(1);
  });
}
