#!/usr/bin/env node
// The write side of calma: calendar events only, personal account only, only what write.json allows. calma.mjs never
// imports this file or lib/write/ (test/write-boundary.test.mjs). JSON on stdout only (errors too, with exit code 1).
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ToolError } from "./lib/config.mjs";
import { allowAccount, allowCalendar, loadPolicy } from "./lib/write/policy.mjs";
import { authorizeWrite } from "./lib/write/oauth.mjs";
import { createEvent, updateEvent } from "./lib/write/events.mjs";
import { listWriteAccounts } from "./lib/write/tokens.mjs";

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const USAGE = "Usage: calma-write auth [--no-open] | accounts | policy | allow --account <email> | allow --calendar <id> | calendar-create --title <text> --start <time> [--end <time>] [--all-day] --actor <label> [--yes] [options] | calendar-update <eventId> [--title <text>] [--start <time>] [--end <time>] [--all-day] [--description <text>] [--location <text>] [--free|--busy] [--private|--public] [--prop name=value] --actor <label> [--any-event] [--yes]";

// Options that take a value, and plain switches. Anything else starting with "-" is refused, so a typo like --attendee
// fails loudly instead of being ignored.
const VALUE_OPTIONS = { "--account": "account", "-a": "account", "--calendar": "calendar", "--title": "title", "--start": "start", "--end": "end", "--description": "description", "--location": "location", "--actor": "actor", "--key": "key" };
const SWITCHES = { "--no-open": "noOpen", "--yes": "yes", "--all-day": "allDay", "--free": "free", "--private": "private", "--busy": "busy", "--public": "public", "--any-event": "anyEvent" };

/** Splits the options from the positional words; `--prop name=value` can repeat. */
export function parseArgs(argv) {
  const flags = { open: true, yes: false, allDay: false, free: false, private: false, busy: false, public: false, anyEvent: false, props: {} };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in VALUE_OPTIONS) {
      if (i + 1 >= argv.length) throw new ToolError("usage", `${a} needs a value. ${USAGE}`);
      flags[VALUE_OPTIONS[a]] = argv[++i];
    } else if (a === "--prop") {
      const [k, ...v] = String(argv[++i] ?? "").split("=");
      if (!k || v.length === 0) throw new ToolError("usage", "--prop needs name=value.");
      flags.props[k] = v.join("=");
    } else if (a in SWITCHES) {
      if (a === "--no-open") flags.open = false;
      else flags[SWITCHES[a]] = true;
    } else if (a.startsWith("-")) throw new ToolError("usage", `Unknown option ${a}. ${USAGE}`);
    else words.push(a);
  }
  return { cmd: words[0], rest: words.slice(1), flags };
}

/** Options that belong to one command are refused on the others, so nothing is silently ignored. */
function refuseFor(cmd, flags, names) {
  for (const [name, flag] of names) if (flags[flag] !== undefined && flags[flag] !== false) throw new ToolError("usage", `${name} is not an option of ${cmd}. ${USAGE}`);
}

export async function run(argv, deps = {}) {
  const { cmd, rest, flags } = parseArgs(argv);
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
    case "calendar-create":
      refuseFor(cmd, flags, [["--busy", "busy"], ["--public", "public"], ["--any-event", "anyEvent"]]);
      return out(await createEvent({ title: flags.title, start: flags.start, end: flags.end, allDay: flags.allDay, description: flags.description, location: flags.location, free: flags.free, private: flags.private, props: flags.props, actor: flags.actor, key: flags.key, account: flags.account, calendar: flags.calendar }, { yes: flags.yes, ...deps }));
    case "calendar-update":
      if (rest.length !== 1) throw new ToolError("usage", `calendar-update needs one event id. ${USAGE}`);
      refuseFor(cmd, flags, [["--key", "key"]]);
      return out(await updateEvent({ id: rest[0], title: flags.title, start: flags.start, end: flags.end, allDay: flags.allDay, description: flags.description, location: flags.location, free: flags.free, busy: flags.busy, private: flags.private, public: flags.public, props: flags.props, actor: flags.actor, anyEvent: flags.anyEvent, account: flags.account, calendar: flags.calendar }, { yes: flags.yes, ...deps }));
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
