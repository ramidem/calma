import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as config from "../src/lib/config.ts";
import * as cli from "../src/calma.ts";
import { uninstall } from "../src/lib/uninstall.ts";
import { SCOPE, jsonResponse, sandbox } from "./helpers.ts";

const signIn = (env: any, who: any) => config.saveToken(who, { account: who, scope: SCOPE, access_token: `FAKE-ACCESS-${who}`, refresh_token: `FAKE-REFRESH-${who}`, expires_at: 0 }, env);

/** A config folder with two accounts, an old-version label token, client.json and a leftover accounts.env. */
function populated() {
  const { dir, env } = sandbox(); // gives client.json and a label token named "personal" (an old-version token)
  signIn(env, "me@example.com");
  signIn(env, "work@example.com");
  writeFileSync(join(dir, "accounts.env"), "MAIL_ACCOUNT_PERSONAL=someone@example.com\n", { mode: 0o600 });
  return { dir, env };
}
const name = (stem: any) => `${stem}.json`; // file names are built at run time so no address-like literal ends in ".json"
const file = (dir: any, stem: any) => join(dir, name(stem));
const recorder = (ok = true) => {
  const calls: any[] = [];
  const fetchFn = async (url: any, init: any) => {
    calls.push({ url: String(url), method: init.method, token: new URLSearchParams(init.body).get("token") });
    if (!ok) throw new Error("offline");
    return jsonResponse({}, 200);
  };
  return { calls, fetchFn };
};

test("without --yes it only lists what it would remove", async () => {
  const { dir, env } = populated();
  const { calls, fetchFn } = recorder();
  const out = await uninstall("--all", { env, fetchFn });
  assert.equal(out.event, "dry_run");
  assert.deepEqual(out.would_remove.sort(), ["accounts.env", "client.json", name("me@example.com"), "personal.json", name("work@example.com")]);
  assert.equal(calls.length, 0);
  assert.ok(existsSync(join(dir, "client.json")) && existsSync(file(dir, "me@example.com")));
});

test("one account: revokes at Google, removes only that token, leaves the rest", async () => {
  const { dir, env } = populated();
  const { calls, fetchFn } = recorder();
  const lines: any[] = [];
  await cli.run(["uninstall", "--account", "work@example.com", "--yes"], { env, fetchFn, emit: (o) => lines.push(o) });
  assert.deepEqual(calls, [{ url: "https://oauth2.googleapis.com/revoke", method: "POST", token: "FAKE-REFRESH-work@example.com" }]);
  assert.equal(existsSync(file(dir, "work@example.com")), false);
  for (const keep of ["me@example.com", "personal"]) assert.ok(existsSync(file(dir, keep)), keep);
  assert.ok(existsSync(join(dir, "client.json")) && existsSync(join(dir, "accounts.env")));
  assert.deepEqual(lines[0].removed, [name("work@example.com")]);
  assert.equal(lines[0].revoked["work@example.com"], true);
  assert.ok(!JSON.stringify(lines).includes("FAKE-"), "no token in the output");
});

test("two spellings of one address remove the same token", async () => {
  const { dir, env } = populated();
  await uninstall(" ME@Example.COM ", { yes: true, env, fetchFn: recorder().fetchFn });
  assert.equal(existsSync(file(dir, "me@example.com")), false);
  assert.ok(existsSync(file(dir, "work@example.com")));
});

test("an account that is not signed in removes nothing", async () => {
  const { dir, env } = populated();
  const { calls, fetchFn } = recorder();
  const out = await uninstall("nobody@example.com", { yes: true, env, fetchFn });
  assert.deepEqual(out.removed, []);
  assert.equal(calls.length, 0);
  assert.ok(existsSync(file(dir, "me@example.com")));
});

test("a failed revoke still removes the local file and says so", async () => {
  const { env } = populated();
  const out = await uninstall("work@example.com", { yes: true, env, fetchFn: recorder(false).fetchFn });
  assert.equal(out.revoked["work@example.com"], false);
  assert.match(out.note, /could not be revoked/);
  assert.equal(existsSync(config.tokenPath("work@example.com", env)), false);
});

test("--all --yes revokes and removes every token (old label tokens too), client.json, accounts.env and the empty folder", async () => {
  const { dir, env } = populated();
  const { calls, fetchFn } = recorder();
  const out = await uninstall("--all", { yes: true, env, fetchFn });
  assert.equal(calls.length, 3);
  assert.equal(out.folder_removed, true);
  assert.equal(existsSync(dir), false);
});

test("it never removes files it doesn't own, names them, and keeps the folder then", async () => {
  const { dir, env } = populated();
  writeFileSync(join(dir, "notes.txt"), "mine");
  writeFileSync(join(dir, "backup.json"), JSON.stringify({ hello: "world" })); // label-shaped, not a token
  writeFileSync(file(dir, "other@example.com"), JSON.stringify({ hello: "world" })); // address-shaped, not a token
  writeFileSync(join(dir, "Odd Name.json"), JSON.stringify({ scope: SCOPE })); // neither shape: not ours
  const out = await uninstall("--all", { yes: true, env, fetchFn: recorder().fetchFn });
  assert.equal(out.folder_removed, false);
  assert.deepEqual(out.kept_not_a_token, ["backup.json", name("other@example.com")]);
  for (const kept of ["notes.txt", "backup.json", name("other@example.com"), "Odd Name.json"]) assert.ok(existsSync(join(dir, kept)), kept);
  assert.equal(existsSync(join(dir, "client.json")), false);
});

test("a client file outside the config folder is kept and reported", async () => {
  const { env } = populated();
  const elsewhere = join(mkdtempSync(join(tmpdir(), "ro-client-")), "my-client.json");
  writeFileSync(elsewhere, "{}");
  const out = await uninstall("--all", { yes: true, env: { ...env, MAIL_CLIENT_FILE: elsewhere }, fetchFn: recorder().fetchFn });
  assert.ok(existsSync(elsewhere));
  assert.deepEqual(out.kept_outside_config_folder, ["my-client.json"]);
});

test("bad targets are refused before anything is touched", async () => {
  const { dir, env } = populated();
  const never = async () => assert.fail("no request expected");
  for (const bad of ["../etc", "client", "work", "a/b@example.com", ""]) {
    await assert.rejects(uninstall(bad, { yes: true, env, fetchFn: never }), { code: "bad_email" }, bad);
  }
  assert.ok(existsSync(file(dir, "me@example.com")) && existsSync(join(dir, "client.json")));
});

test("the command needs --account or --all, never both, and the old label form is refused", async () => {
  const { env } = populated();
  const run = (argv: any) => cli.run(argv, { env, fetchFn: recorder().fetchFn, emit() {} });
  await assert.rejects(run(["uninstall"]), { code: "usage" });
  await assert.rejects(run(["uninstall", "work"]), (e: any) => e.code === "usage" && /labels are gone/.test(e.message));
  await assert.rejects(run(["uninstall", "--all", "--account", "me@example.com"]), { code: "usage" });
  await assert.rejects(run(["uninstall", "--account", "work"]), { code: "bad_email" });
});
