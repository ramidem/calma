import assert from "node:assert/strict";
import { test } from "node:test";
import * as config from "../lib/config.mjs";
import * as cli from "../calma.mjs";
import { SCOPE, jsonResponse, sandbox } from "./helpers.mjs";

/** A config folder with no accounts; signIn adds one whose access token is "TOKEN-<address>" so a request shows which account it used. */
function folder() {
  const { dir, env } = sandbox();
  config.writeSecretFile(config.tokenPath("personal", env), "{}"); // sandbox's placeholder, not an account
  return { dir, env };
}
const signIn = (env, email) => config.saveToken(email, { account: email, scope: SCOPE, access_token: `TOKEN-${email}`, refresh_token: "FAKE", expires_at: Date.now() + 3_600_000 }, env);
const run = async (argv, env, fetchFn) => {
  const lines = [];
  await cli.run(argv, { env, fetchFn, emit: (o) => lines.push(o) });
  return lines;
};
const used = [];
const fetchFn = async (url, init) => {
  used.push(init.headers.authorization);
  return String(url).includes("calendar") ? jsonResponse({ items: [] }) : jsonResponse({ messages: [] });
};

test("parseArgs splits the account flag, --yes and --all from the words", () => {
  assert.deepEqual(cli.parseArgs(["mail-recent", "from:x@example.com", "newer_than:2d", "--account", "me@example.com"]), { cmd: "mail-recent", rest: ["from:x@example.com", "newer_than:2d"], flags: { account: "me@example.com", yes: false, all: false, open: true, calendar: undefined, from: undefined, to: undefined } });
  assert.deepEqual(cli.parseArgs(["-a", "me@example.com", "uninstall", "--all", "--yes"]), { cmd: "uninstall", rest: [], flags: { account: "me@example.com", yes: true, all: true, open: true, calendar: undefined, from: undefined, to: undefined } });
  assert.throws(() => cli.parseArgs(["mail-recent", "--account"]), { code: "usage" });
  assert.equal(cli.parseArgs(["auth", "--no-open"]).flags.open, false);
  assert.equal(cli.parseArgs(["auth"]).flags.open, true);
});

test("parseArgs accepts calendar-week --calendar --from --to", () => {
  const out = cli.parseArgs(["calendar-week", "--calendar", "actual-cal@example.com", "--from", "2026-11-10T00:00:00+08:00", "--to", "2026-11-17T00:00:00+08:00"]);
  assert.equal(out.cmd, "calendar-week");
  assert.equal(out.flags.calendar, "actual-cal@example.com");
  assert.equal(out.flags.from, "2026-11-10T00:00:00+08:00");
  assert.equal(out.flags.to, "2026-11-17T00:00:00+08:00");
  assert.throws(() => cli.parseArgs(["calendar-week", "--calendar"]), { code: "usage" });
  assert.throws(() => cli.parseArgs(["calendar-week", "--from"]), { code: "usage" });
});

test("accounts lists the signed-in addresses and never a token", async () => {
  const { env } = folder();
  assert.deepEqual(await run(["accounts"], env), [{ accounts: [] }]);
  signIn(env, "b@example.com");
  signIn(env, "a@example.com");
  const out = await run(["accounts"], env);
  assert.deepEqual(out, [{ accounts: ["a@example.com", "b@example.com"] }]);
  assert.ok(!JSON.stringify(out).includes("TOKEN-"));
});

test("with one account signed in, commands need no --account", async () => {
  const { env } = folder();
  signIn(env, "me@example.com");
  used.length = 0;
  for (const argv of [["mail-recent"], ["mail-recent", "from:x@example.com"], ["calendar-week"]]) await run(argv, env, fetchFn);
  assert.deepEqual([...new Set(used)], ["Bearer TOKEN-me@example.com"]);
});

test("with several accounts, a command without --account is refused and --account picks one", async () => {
  const { env } = folder();
  signIn(env, "a@example.com");
  signIn(env, "b@example.com");
  for (const argv of [["mail-recent"], ["mail-thread", "0a1b2c3d4e5f6a7b"], ["calendar-week"]]) await assert.rejects(run(argv, env, fetchFn), { code: "account_required" });
  used.length = 0;
  await run(["mail-recent", "--account", " B@Example.com "], env, fetchFn);
  await run(["calendar-week", "-a", "a@example.com"], env, fetchFn);
  assert.deepEqual(used, ["Bearer TOKEN-b@example.com", "Bearer TOKEN-a@example.com"]);
});

test("no account, an unknown account or a malformed one is refused before any request", async () => {
  const { env } = folder();
  const never = async () => assert.fail("no request expected");
  await assert.rejects(run(["mail-recent"], env, never), { code: "reauth_needed" });
  signIn(env, "a@example.com");
  await assert.rejects(run(["mail-recent", "--account", "other@example.com"], env, never), { code: "reauth_needed" });
  await assert.rejects(run(["mail-recent", "--account", "../a@example.com"], env, never), { code: "bad_email" });
});

test("the old label form is not an account: a label is not an address", async () => {
  const { env } = folder();
  await assert.rejects(run(["mail-recent", "--account", "personal"], env, async () => assert.fail("no request")), { code: "bad_email" });
});

test("no command, or an unknown one, gets the usage text", async () => {
  const { env } = folder();
  await assert.rejects(run([], env), { code: "usage" });
  await assert.rejects(run(["send"], env), { code: "usage" });
});
