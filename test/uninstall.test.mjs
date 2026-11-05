import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as config from "../lib/config.mjs";
import * as cli from "../calma.mjs";
import { uninstall } from "../lib/uninstall.mjs";
import { SCOPE, jsonResponse, sandbox } from "./helpers.mjs";

/** A config folder with tokens for personal and work, client.json and accounts.env. */
function populated() {
  const { dir, env } = sandbox();
  config.saveToken("work", { account: "work", scope: SCOPE, access_token: "FAKE-ACCESS-W", refresh_token: "FAKE-REFRESH-W", expires_at: 0 }, env);
  writeFileSync(join(dir, "accounts.env"), "MAIL_ACCOUNT_PERSONAL=personal@example.com\n", { mode: 0o600 });
  return { dir, env };
}
const recorder = (ok = true) => {
  const calls = [];
  const fetchFn = async (url, init) => {
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
  assert.deepEqual(out.would_remove.sort(), ["accounts.env", "client.json", "personal.json", "work.json"]);
  assert.equal(calls.length, 0);
  assert.ok(existsSync(join(dir, "client.json")) && existsSync(config.tokenPath("work", env)));
});

test("one account: revokes at Google, removes only that token, leaves the rest", async () => {
  const { dir, env } = populated();
  const { calls, fetchFn } = recorder();
  const lines = [];
  await cli.run(["uninstall", "work", "--yes"], { env, fetchFn, emit: (o) => lines.push(o) });
  assert.deepEqual(calls, [{ url: "https://oauth2.googleapis.com/revoke", method: "POST", token: "FAKE-REFRESH-W" }]);
  assert.equal(existsSync(config.tokenPath("work", env)), false);
  assert.ok(existsSync(config.tokenPath("personal", env)) && existsSync(join(dir, "client.json")) && existsSync(join(dir, "accounts.env")));
  assert.deepEqual(lines[0].removed, ["work.json"]);
  assert.equal(lines[0].revoked.work, true);
  assert.ok(!JSON.stringify(lines).includes("FAKE-"), "no token in the output");
});

test("a failed revoke still removes the local file and says so", async () => {
  const { env } = populated();
  const { fetchFn } = recorder(false);
  const out = await uninstall("work", { yes: true, env, fetchFn });
  assert.equal(out.revoked.work, false);
  assert.match(out.note, /could not be revoked/);
  assert.equal(existsSync(config.tokenPath("work", env)), false);
});

test("--all --yes removes every token, the client file, the accounts file and the empty folder", async () => {
  const { dir, env } = populated();
  const { calls, fetchFn } = recorder();
  const out = await uninstall("--all", { yes: true, env, fetchFn });
  assert.equal(calls.length, 2);
  assert.equal(out.folder_removed, true);
  assert.equal(existsSync(dir), false);
});

test("it never removes files it doesn't own, and keeps the folder then", async () => {
  const { dir, env } = populated();
  writeFileSync(join(dir, "notes.txt"), "mine");
  writeFileSync(join(dir, "backup.json"), JSON.stringify({ hello: "world" })); // label-shaped, but not a token
  const out = await uninstall("--all", { yes: true, env, fetchFn: recorder().fetchFn });
  assert.equal(out.folder_removed, false);
  assert.deepEqual(out.kept_not_a_token, ["backup.json"]);
  assert.ok(existsSync(join(dir, "notes.txt")) && existsSync(join(dir, "backup.json")));
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

test("bad targets are refused", async () => {
  const { env } = populated();
  for (const bad of ["../etc", "client", "--yes", "Work", "", "work.json"]) {
    await assert.rejects(uninstall(bad, { yes: true, env, fetchFn: recorder().fetchFn }), { code: "unknown_account" }, bad);
  }
});
