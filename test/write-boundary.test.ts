// The promise of this repo: calma.mjs is read-only. These tests make that structural, not a convention: the read side
// (calma.mjs and everything it imports) must never reach the write side, and nothing that can change a calendar may hide
// in the read side.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The write side, listed on purpose: a new file there must be added here, in a PR a reviewer reads. */
const WRITE_FILES = ["src/calma-write.ts", "src/lib/write/events.ts", "src/lib/write/log.ts", "src/lib/write/oauth.ts", "src/lib/write/policy.ts", "src/lib/write/scopes.ts", "src/lib/write/tokens.ts"];

const read = (rel: any) => readFileSync(join(root, rel), "utf8");

/** Every file reachable from `entry` through static relative imports. Dynamic import(), require and createRequire are errors. */
function importGraph(entry: any) {
  const seen = new Set<string>();
  const visit = (rel: any) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = read(rel);
    assert.doesNotMatch(src, /\bimport\s*\(|\brequire\s*\(|createRequire/, `${rel}: dynamic loading would hide an import from this test`);
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']/g)) visit(relative(root, resolve(root, dirname(rel), m[1])));
  };
  visit(entry);
  return [...seen].sort();
}

test("the write side is exactly the files listed here", () => {
  const found = ["src/calma-write.ts", ...readdirSync(join(root, "src", "lib", "write")).filter((f) => f.endsWith(".ts")).map((f) => `src/lib/write/${f}`)].sort();
  assert.deepEqual(found, [...WRITE_FILES].sort());
});

test("src/calma.ts, the read-only entry point, never reaches the write side", () => {
  const graph = importGraph("src/calma.ts");
  assert.ok(graph.includes("src/lib/google.ts") && graph.includes("src/lib/oauth.ts"), "the walk found the real read modules");
  for (const f of graph) assert.ok(!WRITE_FILES.includes(f), `${f} is on the write side but src/calma.ts reaches it`);
  assert.ok(!graph.some((f) => f.startsWith("src/lib/write/")));
});

test("nothing in the read side holds the write scope or a calendar write call", () => {
  for (const f of importGraph("src/calma.ts")) {
    const src = read(f);
    assert.doesNotMatch(src, /auth\/calendar\.events/, `${f} mentions the write scope`);
    assert.doesNotMatch(src, /sendUpdates/, `${f} mentions sendUpdates`);
    assert.doesNotMatch(src, /method:\s*["'](?:PATCH|PUT|DELETE)["']/, `${f} has a write method`);
  }
});

test("src/calma-write.ts does reach the write modules (so the boundary test is not vacuous)", () => {
  const graph = importGraph("src/calma-write.ts");
  for (const f of WRITE_FILES) assert.ok(graph.includes(f), `${f} is not reached from src/calma-write.ts`);
});

test("the write scope is defined in one file only", () => {
  const holders = [...WRITE_FILES, ...readdirSync(join(root, "src", "lib")).filter((f) => f.endsWith(".ts")).map((f) => `src/lib/${f}`), "src/calma.ts"].filter((f) => /auth\/calendar\.events/.test(read(f)));
  assert.deepEqual(holders, ["src/lib/write/scopes.ts"]);
});

test("the write side makes only the requests it allows: POST (create), GET, PATCH (update) and DELETE (delete), plus Google's token, revoke and userinfo calls; DELETE only in events.mjs; PUT nowhere", () => {
  const seen = new Set();
  for (const f of WRITE_FILES) {
    const methods = [...read(f).matchAll(/(?<![\w])method:\s*["'](\w+)["']/g)].map((m) => m[1]);
    for (const m of methods) {
      assert.ok(["POST", "PATCH", "GET", "DELETE"].includes(m), `${f} uses method ${m}`);
      if (m === "DELETE") assert.equal(f, "src/lib/write/events.ts", `${f} uses DELETE, which only src/lib/write/events.ts may`);
      seen.add(m);
    }
    assert.doesNotMatch(read(f), /["']PUT["']/, `${f} mentions PUT`);
    if (f !== "src/lib/write/events.ts") assert.doesNotMatch(read(f), /["']DELETE["']/, `${f} mentions DELETE`);
  }
  assert.deepEqual([...seen].sort(), ["DELETE", "GET", "PATCH", "POST"], "the check saw each method it allows");
});
