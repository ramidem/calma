#!/usr/bin/env node
// The write side of calma: calendar events only, personal account only, only what write.json allows. calma.mjs never
// imports this file or lib/write/ (test/write-boundary.test.mjs). JSON on stdout only (errors too, with exit code 1).
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ToolError } from "./lib/config.ts";
import type { EventInput, IoDeps } from "./lib/types.ts";
import { allowAccount, allowCalendar, loadPolicy } from "./lib/write/policy.ts";
import { authorizeWrite } from "./lib/write/oauth.ts";
import { createEvent, deleteEvent, updateEvent } from "./lib/write/events.ts";
import { listWriteAccounts } from "./lib/write/tokens.ts";

const emit = (obj: unknown) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const USAGE = "Usage: calma-write auth [--no-open] | accounts | policy | allow --account <email> | allow --calendar <id> | calendar-create --title <text> --start <time> [--end <time>] [--all-day] --actor <label> [--yes] [options] | calendar-update <eventId> [--title <text>] [--start <time>] [--end <time>] [--all-day] [--description <text>] [--location <text>] [--free|--busy] [--private|--public] [--prop name=value] --actor <label> [--any-event] [--yes] | calendar-delete <eventId> --actor <label> [--account <email>] [--calendar <id>] [--any-event] [--yes]";

// Options that take a value, and plain switches. Anything else starting with "-" is refused, so a typo like --attendee
// fails loudly instead of being ignored.
const VALUE_OPTIONS = { "--account": "account", "-a": "account", "--calendar": "calendar", "--title": "title", "--start": "start", "--end": "end", "--description": "description", "--location": "location", "--actor": "actor", "--key": "key" } as const;
const SWITCHES = { "--no-open": "noOpen", "--yes": "yes", "--all-day": "allDay", "--free": "free", "--private": "private", "--busy": "busy", "--public": "public", "--any-event": "anyEvent" } as const;

type WriteFlags = {
  open: boolean;
  yes: boolean;
  allDay: boolean;
  free: boolean;
  private: boolean;
  busy: boolean;
  public: boolean;
  anyEvent: boolean;
  noOpen?: boolean;
  props: Record<string, string>;
  account?: string;
  calendar?: string;
  title?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  actor?: string;
  key?: string;
};

/** Splits the options from the positional words; `--prop name=value` can repeat. */
export function parseArgs(argv: readonly string[]) {
  const flags: WriteFlags = { open: true, yes: false, allDay: false, free: false, private: false, busy: false, public: false, anyEvent: false, props: {} };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a in VALUE_OPTIONS) {
      if (i + 1 >= argv.length) throw new ToolError("usage", `${a} needs a value. ${USAGE}`);
      flags[VALUE_OPTIONS[a as keyof typeof VALUE_OPTIONS]] = argv[++i];
    } else if (a === "--prop") {
      const [k, ...v] = String(argv[++i] ?? "").split("=");
      if (!k || v.length === 0) throw new ToolError("usage", "--prop needs name=value.");
      flags.props[k] = v.join("=");
    } else if (a in SWITCHES) {
      if (a === "--no-open") flags.open = false;
      else flags[SWITCHES[a as keyof typeof SWITCHES]] = true;
    } else if (a.startsWith("-")) throw new ToolError("usage", `Unknown option ${a}. ${USAGE}`);
    else words.push(a);
  }
  return { cmd: words[0], rest: words.slice(1), flags };
}

/** Options that belong to one command are refused on the others, so nothing is silently ignored. */
function refuseFor(cmd: string, flags: WriteFlags, names: readonly (readonly [string, keyof WriteFlags])[]) {
  for (const [name, flag] of names) if (flags[flag] !== undefined && flags[flag] !== false) throw new ToolError("usage", `${name} is not an option of ${cmd}. ${USAGE}`);
}

function eventInput(flags: WriteFlags, extra: EventInput = {}): EventInput {
  return {
    title: flags.title,
    start: flags.start,
    end: flags.end,
    allDay: flags.allDay,
    description: flags.description,
    location: flags.location,
    free: flags.free,
    busy: flags.busy,
    private: flags.private,
    public: flags.public,
    props: flags.props,
    actor: flags.actor,
    key: flags.key,
    account: flags.account,
    calendar: flags.calendar,
    anyEvent: flags.anyEvent,
    ...extra,
  };
}

export async function run(argv: readonly string[], deps: IoDeps = {}) {
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
      return out(await createEvent(eventInput(flags), { yes: flags.yes, ...deps }));
    case "calendar-update":
      if (rest.length !== 1) throw new ToolError("usage", `calendar-update needs one event id. ${USAGE}`);
      refuseFor(cmd, flags, [["--key", "key"]]);
      return out(await updateEvent(eventInput(flags, { id: rest[0] }), { yes: flags.yes, ...deps }));
    case "calendar-delete":
      if (rest.length !== 1) throw new ToolError("usage", `calendar-delete needs one event id. ${USAGE}`);
      refuseFor(cmd, flags, [["--title", "title"], ["--start", "start"], ["--end", "end"], ["--description", "description"], ["--location", "location"], ["--key", "key"], ["--all-day", "allDay"], ["--free", "free"], ["--busy", "busy"], ["--private", "private"], ["--public", "public"]]);
      if (Object.keys(flags.props).length > 0) throw new ToolError("usage", `--prop is not an option of ${cmd}. ${USAGE}`);
      return out(await deleteEvent({ id: rest[0], actor: flags.actor, anyEvent: flags.anyEvent, account: flags.account, calendar: flags.calendar }, { yes: flags.yes, ...deps }));
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
