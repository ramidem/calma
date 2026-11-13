import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { listAccounts, normalizeEmail, resolveAccount } from "../src/lib/accounts.ts";
import * as config from "../src/lib/config.ts";
import { SCOPE, sandbox } from "./helpers.ts";

const signIn = (env: any, email: any) => config.saveToken(email, { account: email, scope: SCOPE, access_token: "FAKE", refresh_token: "FAKE", expires_at: 0 }, env);
const empty = () => {
  const { dir, env } = sandbox();
  writeFileSync(join(dir, "personal.json"), "{}"); // sandbox's placeholder token is named by label; the tests below start clean
  return { dir, env };
};

test("normalizeEmail trims and lower-cases, and two spellings of one address are the same", () => {
  assert.equal(normalizeEmail("Me@Example.com"), "me@example.com");
  assert.equal(normalizeEmail("  me@example.com \n"), "me@example.com");
  assert.equal(normalizeEmail(" ME@EXAMPLE.COM "), normalizeEmail("me@example.com"));
  assert.equal(normalizeEmail("first.last+tag@example.com"), "first.last+tag@example.com");
});

test("normalizeEmail refuses anything that could leave the config folder or is not an address", () => {
  const bad = ["", " ", "../x@example.com", "a/b@example.com", "a\\b@example.com", "a b@example.com", "a@@example.com", "a@b@example.com", "@example.com", "me@", "me@example", "me@example..com", ".me@example.com", "me@exa mple.com", `${"a".repeat(250)}@example.com`, "..", "con/../../etc@example.com"];
  for (const b of bad) assert.throws(() => normalizeEmail(b), { code: "bad_email" }, JSON.stringify(b));
  for (const nonString of [undefined, null, 5, {}, ["me@example.com"]]) assert.throws(() => normalizeEmail(nonString), { code: "bad_email" });
});

test("the token file for an address is named after the normalised address and stays in the config folder", () => {
  const { dir, env } = sandbox();
  const email = normalizeEmail(" Me@Example.com ");
  assert.equal(config.tokenPath(email, env), join(dir, `${"me@example.com"}.json`));
});

test("listAccounts finds signed-in addresses only, sorted, and ignores labels, other files and non-tokens", () => {
  const { dir, env } = empty();
  signIn(env, "zed@example.com");
  signIn(env, "amy@example.com");
  writeFileSync(join(dir, "work.json"), JSON.stringify({ scope: SCOPE })); // an old <label>.json
  writeFileSync(join(dir, `${"Mixed@Example.com"}.json`), JSON.stringify({ scope: SCOPE })); // not canonical
  writeFileSync(join(dir, `${"other@example.com"}.json`), JSON.stringify({ hello: "world" })); // not a calma token
  writeFileSync(join(dir, `${"broken@example.com"}.json`), "not json");
  writeFileSync(join(dir, "notes.txt"), "x");
  assert.deepEqual(listAccounts(env), ["amy@example.com", "zed@example.com"]);
  assert.deepEqual(listAccounts({ CALMA_DIR: join(dir, "missing") }), []);
});

test("resolveAccount: one account needs no flag", () => {
  const { env } = empty();
  signIn(env, "me@example.com");
  assert.equal(resolveAccount(undefined, env), "me@example.com");
  assert.equal(resolveAccount(" ME@example.com ", env), "me@example.com");
});

test("resolveAccount: several accounts need the flag, none says to sign in", () => {
  const { env } = empty();
  assert.throws(() => resolveAccount(undefined, env), { code: "reauth_needed" });
  signIn(env, "a@example.com");
  signIn(env, "b@example.com");
  assert.throws(() => resolveAccount(undefined, env), { code: "account_required" });
  assert.equal(resolveAccount("b@example.com", env), "b@example.com");
  assert.throws(() => resolveAccount("c@example.com", env), { code: "reauth_needed" });
  assert.throws(() => resolveAccount("../c@example.com", env), { code: "bad_email" });
});
