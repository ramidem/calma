// Fails the run if anything in this folder holds personal information: an email address other than example.com, or a
// hardcoded name. Accounts and names come from environment variables; code, tests and docs use placeholders only.
//
// Names are checked two ways without writing a name in plain text here:
//  1. a baseline of SHA-256 hashes of lower-case words (a hash match means a known personal name is in a file);
//  2. at run time, the addresses signed in on this machine (their local parts and pieces) and the optional PII_DENYLIST
//     variable (comma-separated words).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { listAccounts } from "../src/lib/accounts.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (w: any) => createHash("sha256").update(w).digest("hex");

const NAME_HASHES = new Set([
  "60dc0edb71e86d75b2966b09757a84b8e7d20378285635859fda314424036457",
  "d6fdb75d3c489d82f53fc6f30ffc4de27ee23242ff7e22f9d1f0e4705ae2f2a2",
  "0e5d0f21af6f65cbaef9a33f9c64319b5f4c0482c4ad8f3fe01b6518f04b7365",
  "2f8dd1468518c24edd52697fdd83182d58dbce2c203d91e752b5471da51770bb",
  "aa12642837d7ffd1fa95e548acd85f57d648b93cfd9e53c42d126a19d9aef277",
  "be1a9863760a099c526268311d4aadd4fee1dd4554f472fa27cf64ef0caa1e89",
]);

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

/** Problems in one text: emails outside example.com, words whose hash is a known name, words from the run-time denylist. */
export function findPii(text: any, { hashes = NAME_HASHES, words = [] }: { hashes?: Set<string>; words?: string[] } = {}) {
  const problems = [];
  for (const m of text.matchAll(EMAIL)) if (m[1].toLowerCase() !== "example.com") problems.push("an email address that is not @example.com");
  const deny = new Set(words.map((w) => w.toLowerCase()).filter((w) => w.length >= 4));
  for (const word of new Set<string>(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])) {
    if (hashes.has(sha(word))) problems.push("a hardcoded personal name (matches the baseline hashes)");
    if (deny.has(word)) problems.push("a signed-in address of this machine or a PII_DENYLIST word");
  }
  return problems;
}

/**
 * The words that identify a person in an address: its local part and the pieces of it. Not the domain: "gmail" or "edu"
 * are ordinary words in the docs, and the email check already catches any address that is not @example.com.
 */
export function identifyingWords(address: any) {
  const local = address.split("@")[0].toLowerCase();
  return [local, ...local.split(/[^a-z0-9]+/)].filter(Boolean);
}

function runtimeWords() {
  const words = (process.env.PII_DENYLIST ?? "").split(",").map((w) => w.trim());
  for (const address of listAccounts(process.env)) {
    if (address.endsWith("@example.com")) continue; // placeholders used by the tests
    words.push(...identifyingWords(address));
  }
  return words.filter(Boolean);
}

function files(dir: any): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e): string[] => {
    if (e.name === "node_modules" || e.name === ".git") return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}

test("the scanner flags what it should (so it can't pass by being blind)", () => {
  // Fixtures are assembled at run time so this file itself holds no email-shaped string.
  const at = (local: any, domain: any) => `${local}@${domain}`;
  assert.equal(findPii(`write to ${at("jane.doe", "gmail.com")}`).length, 1);
  assert.equal(findPii(`write to ${at("person", "example.com")}`).length, 0);
  assert.equal(findPii(`write to ${at("person", "mail.example.com")}`).length, 1);
  assert.equal(findPii("hello zzname", { words: ["zzname"] }).length, 1);
  assert.equal(findPii("hello zzname", { hashes: new Set([sha("zzname")]) }).length, 1);
  assert.equal(findPii("hello world", { words: ["zzname"], hashes: new Set([sha("zzname")]) }).length, 0);
  assert.equal(NAME_HASHES.size, 6);
});

test("only the local part of a signed-in address is a denied word, never its domain", () => {
  const at = (local: any, domain: any) => `${local}@${domain}`;
  assert.deepEqual(identifyingWords(at("Jane.Doe", "gmail.com")), ["jane.doe", "jane", "doe"]);
  assert.deepEqual(identifyingWords(at("zz-name_x", "school.edu.ph")), ["zz-name_x", "zz", "name", "x"]);
  // So a machine signed in with a webmail or school address does not make "gmail", "school" or "edu" fail the scan.
  const text = "Gmail and Calendar. school edu";
  assert.equal(findPii(text, { words: identifyingWords(at("jane.doe", "gmail.com")) }).length, 0);
  assert.equal(findPii("jane wrote this", { words: identifyingWords(at("jane.doe", "gmail.com")) }).length, 1);
});

test("this folder holds no email address except example.com and no hardcoded name", () => {
  const words = runtimeWords();
  const found = files(root)
    .filter((p: any) => statSync(p).size < 1_000_000)
    .flatMap((p: any) => findPii(readFileSync(p, "utf8"), { words }).map((what) => `${relative(root, p)}: ${what}`));
  assert.deepEqual(found, []);
});

test("real env and credential files are ignored by git", () => {
  const ignore = readFileSync(join(root, ".gitignore"), "utf8").split("\n");
  for (const pattern of [".env", "*.env", "accounts.env", "client.json", "tokens/"]) assert.ok(ignore.includes(pattern), `${pattern} must be ignored`);
});
