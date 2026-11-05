import assert from "node:assert/strict";
import { test } from "node:test";
import * as cli from "../calma.mjs";
import * as config from "../lib/config.mjs";
import { localMidnight, mailToday } from "../lib/google.mjs";
import { SCOPE, jsonResponse, sandbox } from "./helpers.mjs";

const AFTERNOON = new Date(2026, 10, 5, 15, 30, 12); // local time; the tests never depend on the machine's time zone
const MIDNIGHT = new Date(2026, 10, 5, 0, 0, 0);
const FAR = Date.now() + 10 * 365 * 24 * 3600 * 1000; // tokens stay valid even when a test pins `now` to another day
const epoch = (d) => Math.floor(d.getTime() / 1000);

/** A fetch that records the list query and answers with `ids` (and a nextPageToken if `more`). */
const gmail = ({ ids = [], more = false } = {}) => {
  const seen = { q: null, calls: 0, auth: [] };
  const fetchFn = async (url, init) => {
    seen.calls++;
    seen.auth.push(init.headers.authorization);
    const u = new URL(url);
    if (u.pathname.endsWith("/messages")) {
      seen.q = u.searchParams.get("q");
      seen.max = u.searchParams.get("maxResults");
      return jsonResponse({ messages: ids.map((id) => ({ id })), ...(more ? { nextPageToken: "NEXT" } : {}) });
    }
    const id = u.pathname.split("/").pop();
    return jsonResponse({ id, threadId: id, snippet: "hi", labelIds: ["INBOX"], payload: { headers: [{ name: "Subject", value: `s-${id}` }] } });
  };
  return { seen, fetchFn };
};

test("localMidnight is local midnight of the same day", () => {
  assert.equal(localMidnight(AFTERNOON).getTime(), MIDNIGHT.getTime());
  assert.equal(localMidnight(MIDNIGHT).getTime(), MIDNIGHT.getTime());
  assert.equal(localMidnight(new Date(2026, 10, 5, 23, 59, 59)).getTime(), MIDNIGHT.getTime());
});

test("mail-today asks Gmail for everything after local midnight and reports it", async () => {
  const { env } = sandbox({ expiresAt: FAR });
  const { seen, fetchFn } = gmail({ ids: ["0a1b2c3d", "0a1b2c3e"] });
  const out = await mailToday("personal", "", { fetchFn, env, now: () => AFTERNOON.getTime() });
  assert.equal(seen.q, `after:${epoch(MIDNIGHT)}`);
  assert.equal(seen.max, "20");
  assert.equal(out.since, MIDNIGHT.toISOString());
  assert.equal(out.query, `after:${epoch(MIDNIGHT)}`);
  assert.equal(out.count, 2);
  assert.equal(out.more, false);
  assert.deepEqual(out.messages.map((m) => m.subject), ["s-0a1b2c3d", "s-0a1b2c3e"]);
});

test("extra Gmail search terms are added to the date", async () => {
  const { env } = sandbox({ expiresAt: FAR });
  const { seen, fetchFn } = gmail();
  await mailToday("personal", "in:inbox is:unread", { fetchFn, env, now: () => AFTERNOON.getTime() });
  assert.equal(seen.q, `after:${epoch(MIDNIGHT)} in:inbox is:unread`);
});

test("more is true when Gmail has more than the 20 listed", async () => {
  const { env } = sandbox({ expiresAt: FAR });
  const { fetchFn } = gmail({ ids: ["0a1b2c3d"], more: true });
  assert.equal((await mailToday("personal", "", { fetchFn, env, now: () => AFTERNOON.getTime() })).more, true);
});

test("the command: one account needs no flag, several need --account, extra words are passed on", async () => {
  const { env } = sandbox({ expiresAt: FAR });
  config.writeSecretFile(config.tokenPath("personal", env), "{}"); // not an account
  const signIn = (who) => config.saveToken(who, { account: who, scope: SCOPE, access_token: `TOKEN-${who}`, refresh_token: "FAKE", expires_at: FAR }, env);
  signIn("me@example.com");
  const { seen, fetchFn } = gmail();
  const lines = [];
  await cli.run(["mail-today", "in:inbox"], { env, fetchFn, emit: (o) => lines.push(o), now: () => AFTERNOON.getTime() });
  assert.equal(seen.q, `after:${epoch(MIDNIGHT)} in:inbox`);
  assert.deepEqual([...new Set(seen.auth)], ["Bearer TOKEN-me@example.com"]);
  assert.equal(lines[0].since, MIDNIGHT.toISOString());

  signIn("you@example.com");
  await assert.rejects(cli.run(["mail-today"], { env, fetchFn, emit() {} }), { code: "account_required" });
  seen.auth.length = 0;
  await cli.run(["mail-today", "--account", "you@example.com"], { env, fetchFn, emit() {}, now: () => AFTERNOON.getTime() });
  assert.deepEqual([...new Set(seen.auth)], ["Bearer TOKEN-you@example.com"]);
});

test("mail-recent also reports more", async () => {
  const { env } = sandbox({ expiresAt: FAR });
  const { fetchFn } = gmail({ ids: ["0a1b2c3d"], more: true });
  const { mailRecent } = await import("../lib/google.mjs");
  assert.equal((await mailRecent("personal", "", { fetchFn, env })).more, true);
});
