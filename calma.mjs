#!/usr/bin/env node
// Read-only Gmail and Calendar. JSON on stdout only (errors too, with exit code 1). Usage: see README.md.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listAccounts, resolveAccount } from "./lib/accounts.mjs";
import { ToolError } from "./lib/config.mjs";
import { calendarWeek, mailRecent, mailThread, mailToday } from "./lib/google.mjs";
import { authorize } from "./lib/oauth.mjs";
import { uninstall } from "./lib/uninstall.mjs";

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const USAGE = "Usage: calma auth [--no-open] | accounts | mail-recent [query] | mail-today [query] | mail-thread <threadId> | calendar-week [--calendar <id>] [--from <iso> --to <iso>] | uninstall --account <email>|--all [--yes]   (add --account <email> to the other commands when more than one account is signed in)";

/** Splits flag options from the positional words. */
export function parseArgs(argv) {
  const flags = { account: undefined, yes: false, all: false, open: true, calendar: undefined, from: undefined, to: undefined };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--account" || a === "-a") {
      if (i + 1 >= argv.length) throw new ToolError("usage", `${a} needs an email address. ${USAGE}`);
      flags.account = argv[++i];
    } else if (a === "--calendar") {
      if (i + 1 >= argv.length) throw new ToolError("usage", `${a} needs a calendar id. ${USAGE}`);
      flags.calendar = argv[++i];
    } else if (a === "--from") {
      if (i + 1 >= argv.length) throw new ToolError("usage", `${a} needs an ISO datetime. ${USAGE}`);
      flags.from = argv[++i];
    } else if (a === "--to") {
      if (i + 1 >= argv.length) throw new ToolError("usage", `${a} needs an ISO datetime. ${USAGE}`);
      flags.to = argv[++i];
    } else if (a === "--yes") flags.yes = true;
    else if (a === "--all") flags.all = true;
    else if (a === "--no-open") flags.open = false;
    else words.push(a);
  }
  return { cmd: words[0], rest: words.slice(1), flags };
}

export async function run(argv, deps = {}) {
  const { cmd, rest, flags } = parseArgs(argv);
  if (!cmd) throw new ToolError("usage", USAGE);
  const out = deps.emit ?? emit;
  const env = deps.env ?? process.env;
  switch (cmd) {
    case "auth":
      return out(await authorize({ emit: out, ...(flags.open ? {} : { open: null }), ...deps }));
    case "accounts":
      return out({ accounts: listAccounts(env) });
    case "uninstall": {
      if (flags.all && flags.account !== undefined) throw new ToolError("usage", "Use --account <email> or --all, not both.");
      if (!flags.all && flags.account === undefined) throw new ToolError("usage", "uninstall needs --account <email> or --all. Account labels are gone. " + USAGE);
      return out(await uninstall(flags.all ? "--all" : flags.account, { yes: flags.yes, ...deps }));
    }
    case "mail-recent":
      return out(await mailRecent(resolveAccount(flags.account, env), rest.join(" ").trim(), deps));
    case "mail-today":
      return out(await mailToday(resolveAccount(flags.account, env), rest.join(" ").trim(), deps));
    case "mail-thread":
      return out(await mailThread(resolveAccount(flags.account, env), rest[0], deps));
    case "calendar-week":
      return out(await calendarWeek(resolveAccount(flags.account, env), { calendar: flags.calendar, from: flags.from, to: flags.to, ...deps }));
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
