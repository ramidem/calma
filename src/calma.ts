#!/usr/bin/env node
// Read-only Gmail and Calendar. JSON on stdout only (errors too, with exit code 1). Usage: see README.md.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listAccounts, resolveAccount } from "./lib/accounts.ts";
import { ToolError } from "./lib/config.ts";
import { calendarWeek, mailRecent, mailThread, mailToday } from "./lib/google.ts";
import { authorize } from "./lib/oauth.ts";
import { uninstall } from "./lib/uninstall.ts";
import type { IoDeps } from "./lib/types.ts";

const emit = (obj: unknown) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const USAGE = "Usage: calma auth [--no-open] | accounts | mail-recent [query] | mail-today [query] | mail-thread <threadId> | calendar-week [--calendar <id>] [--from <iso> --to <iso>] | uninstall --account <email>|--all [--yes]   (add --account <email> to the other commands when more than one account is signed in)";

type ReadFlags = {
  account?: string;
  yes: boolean;
  all: boolean;
  open: boolean;
  calendar?: string;
  from?: string;
  to?: string;
};

/** Splits flag options from the positional words. */
export function parseArgs(argv: readonly string[]) {
  const flags: ReadFlags = { account: undefined, yes: false, all: false, open: true, calendar: undefined, from: undefined, to: undefined };
  const words: string[] = [];
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

export async function run(argv: readonly string[], deps: IoDeps = {}) {
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
      const target = flags.all ? "--all" : flags.account;
      if (target === undefined) throw new ToolError("usage", "uninstall needs --account <email> or --all. Account labels are gone. " + USAGE);
      return out(await uninstall(target, { yes: flags.yes, ...deps }));
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
  run(process.argv.slice(2)).catch((err: unknown) => {
    const known = err instanceof ToolError;
    emit({ error: known ? err.code : "unexpected", message: known ? err.message : "Unexpected error." });
    process.exit(1);
  });
}
