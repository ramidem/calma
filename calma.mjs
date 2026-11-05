#!/usr/bin/env node
// Read-only Gmail and Calendar for the accounts named in MAIL_ACCOUNT_<NAME> variables. JSON on stdout only (errors too, with exit code 1).
// Usage: see README.md.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ToolError, accountEmail, loadEnvFileIfPresent } from "./lib/config.mjs";
import { calendarWeek, mailRecent, mailThread } from "./lib/google.mjs";
import { authorize } from "./lib/oauth.mjs";
import { uninstall } from "./lib/uninstall.mjs";

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const USAGE = "Usage: calma auth <name> | mail-recent <name> [query] | mail-thread <name> <threadId> | calendar-week <name> | uninstall <name>|--all [--yes]   (<name> is the label of a MAIL_ACCOUNT_<NAME> variable)";

export async function run(argv, deps = {}) {
  const [cmd, name, ...rest] = argv;
  if (!cmd) throw new ToolError("usage", USAGE);
  if (name === undefined) throw new ToolError("usage", USAGE);
  const out = deps.emit ?? emit;
  if (cmd === "uninstall") return out(await uninstall(name, { yes: rest.includes("--yes"), ...deps }));
  accountEmail(name, deps.env ?? process.env);
  switch (cmd) {
    case "auth":
      return out(await authorize(name, { emit: out, ...deps }));
    case "mail-recent":
      return out(await mailRecent(name, rest.join(" ").trim(), deps));
    case "mail-thread":
      return out(await mailThread(name, rest[0], deps));
    case "calendar-week":
      return out(await calendarWeek(name, deps));
    default:
      throw new ToolError("usage", `Unknown command "${cmd}". ${USAGE}`);
  }
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  Promise.resolve()
    .then(() => loadEnvFileIfPresent())
    .then(() => run(process.argv.slice(2)))
    .catch((err) => {
      const known = err instanceof ToolError;
      emit({ error: known ? err.code : "unexpected", message: known ? err.message : "Unexpected error." });
      process.exit(1);
    });
}
