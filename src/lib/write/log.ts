// An append-only record of every change calma-write actually made, in ~/.config/calma/write.log (one JSON object per
// line, mode 600). It holds ids and who asked, never titles or descriptions. The actor is a label the caller chose, so it
// shows who a run says it was, not who it really was.
import { appendFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { configDir, ensureConfigDir } from "../config.ts";
import type { Env, WriteOp } from "../types.ts";

export const logPath = (env: Env = process.env) => join(configDir(env), "write.log");

export function appendWriteLog({ at, op, account, calendar, eventId, actor }: { at: string; op: WriteOp; account: string; calendar: string; eventId: unknown; actor: string }, env: Env = process.env) {
  ensureConfigDir(env);
  const path = logPath(env);
  appendFileSync(path, `${JSON.stringify({ at, op, account, calendar, event_id: eventId, actor })}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
