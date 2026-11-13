# Port calma to TypeScript

You still get JSON for Gmail and Calendar from two commands. The read command still cannot import the write command. Program files move under `src/`, and Node runs the TypeScript there.

PR 1 is first. PR 2 follows it. PR 3 follows PR 2. PR 4, PR 5, and PR 6 follow PR 3 and are independent of each other. PR 7 follows PR 6. PR 8 follows PR 5 and PR 7. PR 9 follows PR 4, PR 5, PR 7, and PR 8.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `<plugin root>/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator lands every pull request. Owners stop at merge-ready. PR 1 through PR 9 stay unmerged until the operator lands them.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these at program start. Re-read them at every tick.
  - [ ] `cat <plugin root>/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `cat <plugin root>/skills/swarm/SKILL.md`
  - [ ] `cat <plugin root>/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `cat <plugin root>/skills/technical-writing/SKILL.md`
  - [ ] `cat <plugin root>/skills/unslop/SKILL.md`
  - [ ] `cat <plugin root>/skills/deslop/SKILL.md`
  - [ ] `cat <plugin root>/skills/no-comments/SKILL.md`
- [ ] On the operator's go, arm the audit tick as an hourly schedule_task bound to this thread with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from disk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] PR 1 branches from `main`.
  - [ ] PR 2 after PR 1.
  - [ ] PR 3 after PR 2.
  - [ ] PR 4, PR 5, and PR 6 after PR 3. They do not depend on each other.
  - [ ] PR 7 after PR 6.
  - [ ] PR 8 after PR 5 and PR 7.
  - [ ] PR 9 after PR 4, PR 5, PR 7, and PR 8.
- [ ] Hold the file boundaries. PR 1 is the only PR that moves `calma.mjs`, `calma-write.mjs`, and `lib/` into `src/`. Later PRs edit files already under `src/` and the tests that import them.
- [ ] Hold the review gate. PR 1, PR 5, and PR 8 change a command path the operator types. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`. If `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, on a CI failure that comes from a change on trunk, or when a known concurrent change to the same files lands.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per `<plugin root>/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] Stop when the PR is verified and green at its current head, then hand it to the operator. After the handoff, nobody pushes without the operator's go. The owner does not merge. The operator lands the stack bottom-up.

### Boot recipe, for every live lane

Each live lane runs in its own worktree at the PR head. Drive through the CLI commands below. There is no GUI and no server to start.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Run `npm ci` when `package-lock.json` exists. Otherwise run `npm install`.
- [ ] Deliver input only by running `node` on `src/calma.mjs`, `src/calma.ts`, `src/calma-write.mjs`, or `src/calma-write.ts`, and by running `npm test` or `npm run typecheck`. Read stdout, stderr, and the exit code. Do not open a browser.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report. The picture is the terminal that ran the command, including the exit code.

## Move the program into src, PR 1

**Depends on.** None.

**Files.**

- [ ] Edit `package.json`, `package-lock.json`, `.nvmrc`, `.github/workflows/test.yml`, `CONTRIBUTING.md`, and `README.md`.
- [ ] Edit every file under `test/` that imports `../lib/` or `../calma.mjs`.
- [ ] Create `src/calma.mjs`, `src/calma-write.mjs`, `src/lib/**`, `src/lib/types.ts`, and `tsconfig.json` by moving the current program and adding the toolchain.
- [ ] Delete `calma.mjs`, `calma-write.mjs`, and `lib/` at the repository root.

**Build.**

- [ ] Move `calma.mjs` to `src/calma.mjs`, `calma-write.mjs` to `src/calma-write.mjs`, and `lib/` to `src/lib/`.
- [ ] Point the `calma` bin at `./src/calma.mjs` and the `calma-write` bin at `./src/calma-write.mjs`.
- [ ] Rewrite imports so a test file imports `../src/lib/...` and a program file imports a sibling under `src/lib/`.
- [ ] Update `WRITE_FILES` in `test/write-boundary.test.mjs` to the `src/` paths.
- [ ] Set `engines` to Node 24.12 or newer, set `.nvmrc` to `24`, add `typescript` and `@types/node` as devDependencies, add a `typecheck` script of `tsc --noEmit`, and commit `package-lock.json`.
- [ ] Add `tsconfig.json` and `src/lib/types.ts` from Appendix D.
- [ ] Set the test script to `node --test "test/*.test.mjs" "test/*.test.ts"`.
- [ ] In `README.md`, change `node calma.mjs` to `node src/calma.mjs` and `node calma-write.mjs` to `node src/calma-write.mjs`.
- [ ] In CI, run `npm ci`, then `npm test`, then `npm run typecheck`.

**You see.**

- [ ] `node src/calma.mjs` with no arguments prints one JSON usage error and exits 1.
- [ ] `node src/calma-write.mjs` with no arguments prints one JSON usage error and exits 1.
- [ ] `git ls-files calma.mjs calma-write.mjs 'lib/*.mjs'` prints nothing.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `npm test` exits 0. The boundary test names `src/calma.mjs` and `src/lib/write/*.mjs`. Run `npm test`.
- [ ] `npm run typecheck` exits 0 on `src/lib/types.ts`. Run `npm run typecheck`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5 effort=xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `node calma.mjs` with no arguments at trunk and `node src/calma.mjs` with no arguments at head. Trunk has no `src/` tree. Save `/tmp/swarm-pr1/worker-1/usage.png`. Pass when both exit 1 and both print JSON whose error field is usage.
- [ ] Lane 2. Run `node src/calma-write.mjs` with no arguments. Save `/tmp/swarm-pr1/worker-2/write-usage.png`. Pass when the exit code is 1 and the error field is usage.
- [ ] Lane 3. Run `npm test`. Save `/tmp/swarm-pr1/worker-3/npm-test.png`. Pass when the fail count is 0.
- [ ] Lane 4. Run `npm run typecheck`. Save `/tmp/swarm-pr1/worker-4/typecheck.png`. Pass when the exit code is 0.
- [ ] Lane 5. Run `node --test test/write-boundary.test.mjs`. Save `/tmp/swarm-pr1/worker-5/boundary.png`. Pass when `src/calma.mjs` does not reach `src/lib/write/`.
- [ ] Lane 6. Run `node --test test/cli.test.mjs`. Save `/tmp/swarm-pr1/worker-6/cli.png`. Pass when the `--calendar`, `--from`, and `--to` case passes.
- [ ] Lane 7. Run `node --test test/read-only.test.mjs`. Save `/tmp/swarm-pr1/worker-7/read-only.png`. Pass when a non-GET call is refused.
- [ ] Lane 8. Run `node --test test/no-personal-info.test.mjs`. Save `/tmp/swarm-pr1/worker-8/pii.png`. Pass when the folder scan expects an empty list.
- [ ] Lane 9. Run `node --input-type=module -e "import p from './package.json' with { type: 'json' }; console.log(p.bin.calma, p.bin['calma-write'])"`. Save `/tmp/swarm-pr1/worker-9/bin.png`. Pass when the printed paths are `./src/calma.mjs` and `./src/calma-write.mjs`.
- [ ] Lane 10. Run `git ls-files calma.mjs calma-write.mjs 'lib/*.mjs' src/calma.mjs src/calma-write.mjs`. Save `/tmp/swarm-pr1/worker-10/paths.png`. Pass when only the two `src/` entry files are listed from that set.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds for `npm test`, and seconds for the no-args read entry.
- [ ] Probe. At trunk, then at head, run `/usr/bin/time -p npm test` and `/usr/bin/time -p node` on the no-args read entry. Trunk uses `calma.mjs`. Head uses `src/calma.mjs`.
- [ ] Baseline. Record the trunk seconds first.
- [ ] Rule. Head `npm test` stays under twice the trunk seconds. Each no-args entry finishes in under 1 second. Do not compare those two entry times as a ratio.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 screenshot into `/tmp/swarm-pr1/pr1-review-usage.png`.
- [ ] Record a 30 to 60 second video of `node src/calma.mjs` and `node src/calma-write.mjs` with no arguments. Save it as `/tmp/swarm-pr1/pr1-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The operator lands PR 1. The owner does not merge it.

## Convert the leaf modules, PR 2

**Depends on.** PR 1.

**Files.**

- [ ] Edit `src/lib/types.ts` only to match Appendix D if PR 1 drifted.
- [ ] Create `src/lib/config.ts`, `src/lib/net.ts`, `src/lib/browser.ts`, and `src/lib/loopback.ts`.
- [ ] Delete `src/lib/config.mjs`, `src/lib/net.mjs`, `src/lib/browser.mjs`, and `src/lib/loopback.mjs`.
- [ ] Edit import specifiers in the remaining `.mjs` files so they import those `.ts` modules.

**Build.**

- [ ] Convert the four modules in place under `src/lib/`. Keep each function's behavior.
- [ ] Type `ToolError.code` with the union in Appendix D.
- [ ] Type `readJson` as returning `unknown`. Callers still narrow the fields they use.
- [ ] Type `mapLimit` as a generic over the item type and the result type.
- [ ] Type `fetch` fakes as the `FetchLike` alias in Appendix D, wide enough for the objects tests already pass.

**You see.**

- [ ] `node src/calma.mjs` with no arguments still prints usage JSON and exits 1.
- [ ] `npm run typecheck` exits 0.
- [ ] `src/lib/config.mjs` is gone and `src/lib/config.ts` is tracked.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/accounts.test.mjs`, `test/secrets.test.mjs`, and `test/audit-fixes.test.mjs` pass. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5 effort=xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `node src/calma.mjs` with no arguments at trunk and at head. Save `/tmp/swarm-pr2/worker-1/usage.png`. Pass when both exit 1 and the error field is usage.
- [ ] Lane 2. Run `node src/calma-write.mjs` with no arguments. Save `/tmp/swarm-pr2/worker-2/write-usage.png`. Pass when the exit code is 1.
- [ ] Lane 3. Run `npm test`. Save `/tmp/swarm-pr2/worker-3/npm-test.png`. Pass when the fail count is 0.
- [ ] Lane 4. Run `npm run typecheck`. Save `/tmp/swarm-pr2/worker-4/typecheck.png`. Pass when the exit code is 0.
- [ ] Lane 5. Run `node --test test/browser.test.mjs`. Save `/tmp/swarm-pr2/worker-5/browser.png`. Pass when a refused URL never spawns a process.
- [ ] Lane 6. Run `node --test test/secrets.test.mjs`. Save `/tmp/swarm-pr2/worker-6/secrets.png`. Pass when a token file mode test passes.
- [ ] Lane 7. Run `node --test test/write-boundary.test.mjs`. Save `/tmp/swarm-pr2/worker-7/boundary.png`. Pass when the read entry still does not reach `src/lib/write/`.
- [ ] Lane 8. Run `node --test test/read-only.test.mjs`. Save `/tmp/swarm-pr2/worker-8/read-only.png`. Pass when the allow-list cases pass.
- [ ] Lane 9. Run `git ls-files src/lib/config.mjs src/lib/config.ts src/lib/net.ts src/lib/browser.ts src/lib/loopback.ts`. Save `/tmp/swarm-pr2/worker-9/leaves.png`. Pass when `config.mjs` is absent and the four `.ts` files are present.
- [ ] Lane 10. Run `node --test test/no-personal-info.test.mjs`. Save `/tmp/swarm-pr2/worker-10/pii.png`. Pass when the folder scan expects an empty list.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds for `npm test`, and seconds for `node src/calma.mjs` with no arguments.
- [ ] Probe. Interleave trunk and head with `/usr/bin/time -p` on both commands.
- [ ] Baseline. Record the trunk seconds first.
- [ ] Rule. Head `npm test` stays under twice the trunk seconds. The no-args entry finishes in under 1 second on both sides.

**Review gate.** None. PR 2 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The operator lands PR 2. The owner does not merge it.

## Convert accounts and read OAuth, PR 3

**Depends on.** PR 2.

**Files.**

- [ ] Create `src/lib/accounts.ts` and `src/lib/oauth.ts`.
- [ ] Delete `src/lib/accounts.mjs` and `src/lib/oauth.mjs`.
- [ ] Edit import specifiers in `src/calma.mjs`, `src/lib/google.mjs`, `src/lib/uninstall.mjs`, and the tests that import accounts or oauth.

**Build.**

- [ ] Type `normalizeEmail` so a non-string still throws `bad_email`.
- [ ] Narrow `tokenRequest` only after the incomplete-body check. Keep `access_token` as a string and `expires_in` as a positive number.
- [ ] Keep `assertScopes` on `buildAuthUrl` before the URL is built.
- [ ] Keep the saved token fields `account`, `scope`, `access_token`, `refresh_token`, `expires_at`, and `saved_at`.

**You see.**

- [ ] `node src/calma.mjs accounts` with no token file prints JSON and exits 1.
- [ ] `src/lib/oauth.ts` is the file `src/calma.mjs` imports for `authorize`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/accounts.test.mjs`, `test/browser.test.mjs`, `test/secrets.test.mjs`, and `test/audit-fixes.test.mjs` pass. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5 effort=xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `node src/calma.mjs` with no arguments at trunk and at head. Save `/tmp/swarm-pr3/worker-1/usage.png`. Pass when both exit 1 and the error field is usage.
- [ ] Lane 2. Run `node src/calma.mjs accounts` with `CALMA_DIR` set to an empty temp directory. Save `/tmp/swarm-pr3/worker-2/accounts.png`. Pass when the exit code is 0 and the accounts array is empty.
- [ ] Lane 3. Run `npm test`. Save `/tmp/swarm-pr3/worker-3/npm-test.png`. Pass when the fail count is 0.
- [ ] Lane 4. Run `npm run typecheck`. Save `/tmp/swarm-pr3/worker-4/typecheck.png`. Pass when the exit code is 0.
- [ ] Lane 5. Run `node --test test/accounts.test.mjs`. Save `/tmp/swarm-pr3/worker-5/accounts-test.png`. Pass when a bad address is refused.
- [ ] Lane 6. Run `node --test test/secrets.test.mjs`. Save `/tmp/swarm-pr3/worker-6/secrets.png`. Pass when a refresh that Google rejects asks for re-auth.
- [ ] Lane 7. Run `node --test test/browser.test.mjs`. Save `/tmp/swarm-pr3/worker-7/browser.png`. Pass when `--no-open` never opens a URL.
- [ ] Lane 8. Run `node --test test/write-boundary.test.mjs`. Save `/tmp/swarm-pr3/worker-8/boundary.png`. Pass when the read entry does not reach `src/lib/write/`.
- [ ] Lane 9. Run `git ls-files src/lib/accounts.ts src/lib/oauth.ts src/lib/accounts.mjs src/lib/oauth.mjs`. Save `/tmp/swarm-pr3/worker-9/paths.png`. Pass when only the two `.ts` files are listed.
- [ ] Lane 10. Run `node --test test/no-personal-info.test.mjs`. Save `/tmp/swarm-pr3/worker-10/pii.png`. Pass when the folder scan expects an empty list.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds for `npm test`, and seconds for `node src/calma.mjs` with no arguments.
- [ ] Probe. Interleave trunk and head with `/usr/bin/time -p` on both commands.
- [ ] Baseline. Record the trunk seconds first.
- [ ] Rule. Head `npm test` stays under twice the trunk seconds. The no-args entry finishes in under 1 second on both sides.

**Review gate.** None. PR 3 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The operator lands PR 3. The owner does not merge it.

## Convert uninstall, PR 4

**Depends on.** PR 3.

**Files.**

- [ ] Create `src/lib/uninstall.ts`.
- [ ] Delete `src/lib/uninstall.mjs`.
- [ ] Edit the import in `src/calma.mjs` and in `test/uninstall.test.mjs`.

**Build.**

- [ ] Give `planUninstall` a return type for the dry-run object the command prints.
- [ ] Keep revoke best-effort. A failed revoke still removes the local file and says so.
- [ ] Keep the rule that a file outside the config folder is kept and named.

**You see.**

- [ ] `node src/calma.mjs uninstall` with no flag prints usage JSON and exits 1.
- [ ] `src/lib/uninstall.ts` is tracked and `src/lib/uninstall.mjs` is gone.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/uninstall.test.mjs` passes. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5 effort=xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `node src/calma.mjs uninstall` at trunk and at head. Save `/tmp/swarm-pr4/worker-1/uninstall-usage.png`. Pass when both exit 1 and the error field is usage.
- [ ] Lane 2. Run `npm test`. Save `/tmp/swarm-pr4/worker-2/npm-test.png`. Pass when the fail count is 0.
- [ ] Lane 3. Run `npm run typecheck`. Save `/tmp/swarm-pr4/worker-3/typecheck.png`. Pass when the exit code is 0.
- [ ] Lane 4. Run `node --test test/uninstall.test.mjs`. Save `/tmp/swarm-pr4/worker-4/uninstall.png`. Pass when a dry run removes nothing.
- [ ] Lane 5. Run `node --test test/write-boundary.test.mjs`. Save `/tmp/swarm-pr4/worker-5/boundary.png`. Pass when the read entry does not reach `src/lib/write/`.
- [ ] Lane 6. Run `node --test test/read-only.test.mjs`. Save `/tmp/swarm-pr4/worker-6/read-only.png`. Pass when the read-only cases pass.
- [ ] Lane 7. Run `node src/calma.mjs accounts` with `CALMA_DIR` set to an empty temp directory. Save `/tmp/swarm-pr4/worker-7/accounts.png`. Pass when the accounts array is empty.
- [ ] Lane 8. Run `node src/calma-write.mjs` with no arguments. Save `/tmp/swarm-pr4/worker-8/write-usage.png`. Pass when the exit code is 1.
- [ ] Lane 9. Run `git ls-files src/lib/uninstall.ts src/lib/uninstall.mjs`. Save `/tmp/swarm-pr4/worker-9/paths.png`. Pass when only the `.ts` file is listed.
- [ ] Lane 10. Run `node --test test/no-personal-info.test.mjs`. Save `/tmp/swarm-pr4/worker-10/pii.png`. Pass when the folder scan expects an empty list.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds for `npm test`, and seconds for `node src/calma.mjs uninstall`.
- [ ] Probe. Interleave trunk and head with `/usr/bin/time -p` on both commands.
- [ ] Baseline. Record the trunk seconds first.
- [ ] Rule. Head `npm test` stays under twice the trunk seconds. The uninstall usage command finishes in under 1 second on both sides.

**Review gate.** None. PR 4 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The operator lands PR 4. The owner does not merge it.

## Convert the read API and the read command, PR 5

**Depends on.** PR 3.

**Files.**

- [ ] Create `src/lib/google.ts` and `src/calma.ts`.
- [ ] Delete `src/lib/google.mjs` and `src/calma.mjs`.
- [ ] Edit `package.json` so the `calma` bin is `./src/calma.ts`.
- [ ] Edit `README.md` so the read examples say `node src/calma.ts`.
- [ ] Edit `test/cli.test.mjs`, `test/mail-today.test.mjs`, and `test/read-only.test.mjs` imports.

**Build.**

- [ ] Move `mailRecent`, `mailToday`, `mailThread`, `weekRange`, `calendarRange`, `calendarWeek`, `readGet`, and `htmlToText` into `src/lib/google.ts` without changing their results.
- [ ] Keep `readGet` as the only read doorway. A method other than GET still throws `read_only` at runtime.
- [ ] Type each command result on its own. Do not add one union of every JSON object the process can print.
- [ ] Type `parseArgs` flags as `account`, `yes`, `all`, `open`, `calendar`, `from`, and `to`.
- [ ] Keep the shebang `#!/usr/bin/env node` on `src/calma.ts`.

**You see.**

- [ ] `node src/calma.ts` with no arguments prints usage JSON and exits 1.
- [ ] `node src/calma.ts calendar-week --from 2026-01-01 --to 2026-02-15` with no token prints a JSON error and exits 1 before any network call.
- [ ] The `calma` bin path is `./src/calma.ts`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/cli.test.mjs`, `test/mail-today.test.mjs`, and `test/read-only.test.mjs` pass. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5 effort=xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `node src/calma.mjs` with no arguments at trunk and `node src/calma.ts` with no arguments at head. Save `/tmp/swarm-pr5/worker-1/usage.png`. Pass when both exit 1 and the error field is usage.
- [ ] Lane 2. Run `node src/calma.ts calendar-week --calendar primary` with `CALMA_DIR` set to an empty temp directory. Save `/tmp/swarm-pr5/worker-2/calendar.png`. Pass when the exit code is 1 and the error field is reauth_needed.
- [ ] Lane 3. Run `node src/calma.ts calendar-week --from 2026-01-01`. Save `/tmp/swarm-pr5/worker-3/half-range.png`. Pass when the exit code is 1 and the error field is bad_args.
- [ ] Lane 4. Run `npm test`. Save `/tmp/swarm-pr5/worker-4/npm-test.png`. Pass when the fail count is 0.
- [ ] Lane 5. Run `npm run typecheck`. Save `/tmp/swarm-pr5/worker-5/typecheck.png`. Pass when the exit code is 0.
- [ ] Lane 6. Run `node --test test/cli.test.mjs`. Save `/tmp/swarm-pr5/worker-6/cli.png`. Pass when the calendar flag case passes.
- [ ] Lane 7. Run `node --test test/read-only.test.mjs`. Save `/tmp/swarm-pr5/worker-7/read-only.png`. Pass when the other-calendar case passes.
- [ ] Lane 8. Run `node --test test/mail-today.test.mjs`. Save `/tmp/swarm-pr5/worker-8/mail-today.png`. Pass when the local-midnight case passes.
- [ ] Lane 9. Run `node --test test/write-boundary.test.mjs`. Save `/tmp/swarm-pr5/worker-9/boundary.png`. Pass when `src/calma.ts` does not reach `src/lib/write/`.
- [ ] Lane 10. Run `node --input-type=module -e "import p from './package.json' with { type: 'json' }; console.log(p.bin.calma)"`. Save `/tmp/swarm-pr5/worker-10/bin.png`. Pass when the printed path is `./src/calma.ts`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds for `npm test`, and seconds for the no-args read entry.
- [ ] Probe. Interleave trunk and head with `/usr/bin/time -p`. Trunk runs `node src/calma.mjs`. Head runs `node src/calma.ts`.
- [ ] Baseline. Record the trunk seconds first.
- [ ] Rule. Head `npm test` stays under twice the trunk seconds. Each no-args entry finishes in under 1 second. Do not compare the `.mjs` time and the `.ts` time as a ratio.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 screenshot into `/tmp/swarm-pr5/pr5-review-usage.png`.
- [ ] Record a 30 to 60 second video of `node src/calma.ts` with no arguments and with a half range. Save it as `/tmp/swarm-pr5/pr5-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The operator lands PR 5. The owner does not merge it.

## Convert write policy, scopes, tokens, and the log, PR 6

**Depends on.** PR 3.

**Files.**

- [ ] Create `src/lib/write/scopes.ts`, `src/lib/write/policy.ts`, `src/lib/write/tokens.ts`, and `src/lib/write/log.ts`.
- [ ] Delete the matching `.mjs` files.
- [ ] Edit `WRITE_FILES` so those four paths end in `.ts` and `events.mjs` plus `oauth.mjs` stay `.mjs` until their PRs.
- [ ] Edit imports in `src/calma-write.mjs` and in `src/lib/write/events.mjs`.

**Build.**

- [ ] Keep `auth/calendar.events` defined only in `src/lib/write/scopes.ts`.
- [ ] Keep `loadPolicy` returning `accounts` and `calendars` arrays.
- [ ] Keep write token files under the write directory, folder mode 700 and file mode 600.
- [ ] Update the boundary file list in the same commit as the renames.

**You see.**

- [ ] `node src/calma-write.mjs policy` with `CALMA_DIR` set to an empty temp directory prints empty allow-lists and exits 0.
- [ ] `node --test test/write-boundary.test.mjs` passes with the mixed extensions.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/write.test.mjs` and `test/write-boundary.test.mjs` pass. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5 effort=xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `node src/calma-write.mjs policy` with an empty `CALMA_DIR` at trunk and at head. Save `/tmp/swarm-pr6/worker-1/policy.png`. Pass when both exit 0 and both accounts arrays are empty.
- [ ] Lane 2. Run `node src/calma.ts` with no arguments if PR 5 has merged, otherwise `node src/calma.mjs`. Save `/tmp/swarm-pr6/worker-2/read-usage.png`. Pass when the exit code is 1 and the error field is usage.
- [ ] Lane 3. Run `npm test`. Save `/tmp/swarm-pr6/worker-3/npm-test.png`. Pass when the fail count is 0.
- [ ] Lane 4. Run `npm run typecheck`. Save `/tmp/swarm-pr6/worker-4/typecheck.png`. Pass when the exit code is 0.
- [ ] Lane 5. Run `node --test test/write.test.mjs`. Save `/tmp/swarm-pr6/worker-5/write.png`. Pass when a bad calendar id is refused.
- [ ] Lane 6. Run `node --test test/write-boundary.test.mjs`. Save `/tmp/swarm-pr6/worker-6/boundary.png`. Pass when the write scope string appears in `scopes.ts` only.
- [ ] Lane 7. Run `node src/calma-write.mjs` with no arguments. Save `/tmp/swarm-pr6/worker-7/usage.png`. Pass when the exit code is 1.
- [ ] Lane 8. Run `node src/calma-write.mjs allow` with no flag and an empty `CALMA_DIR`. Save `/tmp/swarm-pr6/worker-8/allow.png`. Pass when the exit code is 1 and the error field is usage.
- [ ] Lane 9. Run `git ls-files 'src/lib/write/*.mjs' 'src/lib/write/*.ts'`. Save `/tmp/swarm-pr6/worker-9/paths.png`. Pass when scopes, policy, tokens, and log are `.ts`, and events and oauth are still `.mjs`.
- [ ] Lane 10. Run `node --test test/no-personal-info.test.mjs`. Save `/tmp/swarm-pr6/worker-10/pii.png`. Pass when the folder scan expects an empty list.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds for `npm test`, and seconds for `node src/calma-write.mjs policy` with an empty `CALMA_DIR`.
- [ ] Probe. Interleave trunk and head with `/usr/bin/time -p` on both commands.
- [ ] Baseline. Record the trunk seconds first.
- [ ] Rule. Head `npm test` stays under twice the trunk seconds. The policy command finishes in under 1 second on both sides.

**Review gate.** None. PR 6 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The operator lands PR 6. The owner does not merge it.

## Convert calendar writes, PR 7

**Depends on.** PR 6.

**Files.**

- [ ] Create `src/lib/write/events.ts`.
- [ ] Delete `src/lib/write/events.mjs`.
- [ ] Edit `WRITE_FILES` so `events.ts` replaces `events.mjs`.
- [ ] Edit the import in `src/calma-write.mjs` and in the write event tests.

**Build.**

- [ ] Move `writeRequest`, `when`, `eventIdFromKey`, `buildCreateBody`, `resolveTarget`, `createEvent`, `updateEvent`, and `deleteEvent` into `src/lib/write/events.ts`.
- [ ] Keep the allow-list of POST, GET, PATCH, and DELETE as runtime data. A call that is not on that list still throws `write_refused`.
- [ ] Keep DELETE only in this file. Keep PUT absent.
- [ ] Keep create body keys limited to `id`, `summary`, `description`, `location`, `start`, `end`, `transparency`, `visibility`, and `extendedProperties`.
- [ ] Do not add attendees, recurrence, or reminders to the body type.

**You see.**

- [ ] `node --test test/write-create.test.mjs test/write-update.test.mjs test/write-delete.test.mjs` exits 0.
- [ ] `rg -n '"PUT"' src/lib/write` prints nothing.
- [ ] `rg -n '"DELETE"' src` lists `src/lib/write/events.ts` and no other program file.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/write-create.test.mjs`, `test/write-update.test.mjs`, and `test/write-delete.test.mjs` pass. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5 effort=xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `node src/calma-write.mjs` with no arguments at trunk and at head. Save `/tmp/swarm-pr7/worker-1/usage.png`. Pass when both exit 1 and the error field is usage.
- [ ] Lane 2. Run `node src/calma-write.mjs calendar-delete` with an empty `CALMA_DIR`. Save `/tmp/swarm-pr7/worker-2/delete-usage.png`. Pass when the exit code is 1 and no DELETE was required to see that failure.
- [ ] Lane 3. Run `npm test`. Save `/tmp/swarm-pr7/worker-3/npm-test.png`. Pass when the fail count is 0.
- [ ] Lane 4. Run `npm run typecheck`. Save `/tmp/swarm-pr7/worker-4/typecheck.png`. Pass when the exit code is 0.
- [ ] Lane 5. Run `node --test test/write-create.test.mjs`. Save `/tmp/swarm-pr7/worker-5/create.png`. Pass when a dry run sends no POST.
- [ ] Lane 6. Run `node --test test/write-update.test.mjs`. Save `/tmp/swarm-pr7/worker-6/update.png`. Pass when a 412 becomes changed_meanwhile.
- [ ] Lane 7. Run `node --test test/write-delete.test.mjs`. Save `/tmp/swarm-pr7/worker-7/delete.png`. Pass when guests are refused and no DELETE is sent.
- [ ] Lane 8. Run `node --test test/write-boundary.test.mjs`. Save `/tmp/swarm-pr7/worker-8/boundary.png`. Pass when DELETE is allowed only in `events.ts` and PUT is absent.
- [ ] Lane 9. Run `git ls-files src/lib/write/events.ts src/lib/write/events.mjs`. Save `/tmp/swarm-pr7/worker-9/paths.png`. Pass when only the `.ts` file is listed.
- [ ] Lane 10. Run the read entry with no arguments, `src/calma.ts` if PR 5 has merged, otherwise `src/calma.mjs`. Save `/tmp/swarm-pr7/worker-10/read-usage.png`. Pass when the exit code is 1 and the read entry still has no DELETE string.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds for `npm test`, and seconds for `node src/calma-write.mjs` with no arguments.
- [ ] Probe. Interleave trunk and head with `/usr/bin/time -p` on both commands.
- [ ] Baseline. Record the trunk seconds first.
- [ ] Rule. Head `npm test` stays under twice the trunk seconds. The no-args write entry finishes in under 1 second on both sides.

**Review gate.** None. PR 7 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The operator lands PR 7. The owner does not merge it.

## Convert the write command, PR 8

**Depends on.** PR 5 and PR 7.

**Files.**

- [ ] Create `src/calma-write.ts`.
- [ ] Delete `src/calma-write.mjs`.
- [ ] Edit `package.json` so the `calma-write` bin is `./src/calma-write.ts`.
- [ ] Edit `README.md` so the write examples say `node src/calma-write.ts`.
- [ ] Edit `test/write-boundary.test.mjs` so the write entry path is `src/calma-write.ts`.

**Build.**

- [ ] Move `parseArgs` and `run` into `src/calma-write.ts`.
- [ ] Keep unknown options that start with `-` as usage errors.
- [ ] Keep `refuseFor` so a flag from another command is a usage error.
- [ ] Keep the shebang `#!/usr/bin/env node`.

**You see.**

- [ ] `node src/calma-write.ts` with no arguments prints usage JSON and exits 1.
- [ ] `node src/calma-write.ts calendar-create --attendee a@example.com` exits 1 with a usage error and sends nothing.
- [ ] The `calma-write` bin path is `./src/calma-write.ts`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/write.test.mjs` and `test/write-boundary.test.mjs` pass. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5 effort=xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `node src/calma-write.mjs` with no arguments at trunk and `node src/calma-write.ts` with no arguments at head. Save `/tmp/swarm-pr8/worker-1/usage.png`. Pass when both exit 1 and the error field is usage.
- [ ] Lane 2. Run `node src/calma-write.ts calendar-create --attendee a@example.com`. Save `/tmp/swarm-pr8/worker-2/attendee.png`. Pass when the exit code is 1 and the error field is usage.
- [ ] Lane 3. Run `node src/calma.ts` with no arguments. Save `/tmp/swarm-pr8/worker-3/read-usage.png`. Pass when the exit code is 1 and the error field is usage.
- [ ] Lane 4. Run `npm test`. Save `/tmp/swarm-pr8/worker-4/npm-test.png`. Pass when the fail count is 0.
- [ ] Lane 5. Run `npm run typecheck`. Save `/tmp/swarm-pr8/worker-5/typecheck.png`. Pass when the exit code is 0.
- [ ] Lane 6. Run `node --test test/write-boundary.test.mjs`. Save `/tmp/swarm-pr8/worker-6/boundary.png`. Pass when `src/calma.ts` reaches no write file and `src/calma-write.ts` reaches every write file.
- [ ] Lane 7. Run `node --test test/write-create.test.mjs`. Save `/tmp/swarm-pr8/worker-7/create.png`. Pass when the dry-run case passes.
- [ ] Lane 8. Run `node --test test/write-delete.test.mjs`. Save `/tmp/swarm-pr8/worker-8/delete.png`. Pass when an unknown option is refused.
- [ ] Lane 9. Run `node --input-type=module -e "import p from './package.json' with { type: 'json' }; console.log(p.bin['calma-write'])"`. Save `/tmp/swarm-pr8/worker-9/bin.png`. Pass when the printed path is `./src/calma-write.ts`.
- [ ] Lane 10. Run `node --test test/no-personal-info.test.mjs`. Save `/tmp/swarm-pr8/worker-10/pii.png`. Pass when the folder scan expects an empty list.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds for `npm test`, and seconds for the no-args write entry.
- [ ] Probe. Interleave trunk and head with `/usr/bin/time -p`. Trunk runs `node src/calma-write.mjs`. Head runs `node src/calma-write.ts`.
- [ ] Baseline. Record the trunk seconds first.
- [ ] Rule. Head `npm test` stays under twice the trunk seconds. Each no-args entry finishes in under 1 second. Do not compare the `.mjs` time and the `.ts` time as a ratio.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 screenshot into `/tmp/swarm-pr8/pr8-review-usage.png`.
- [ ] Record a 30 to 60 second video of `node src/calma-write.ts` with no arguments and with `--attendee`. Save it as `/tmp/swarm-pr8/pr8-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The operator lands PR 8. The owner does not merge it.

## Convert the tests and remove the last JavaScript, PR 9

**Depends on.** PR 4, PR 5, PR 7, and PR 8.

**Files.**

- [ ] Create `test/*.test.ts` and `test/helpers.ts` from the current test files.
- [ ] Delete every remaining `.mjs` file under `test/` and under `src/`.
- [ ] Edit `package.json` so the test script is `node --test "test/*.test.ts"`.
- [ ] Edit `README.md` and `CONTRIBUTING.md` so the commands and the dependency rule match `src/*.ts`.

**Build.**

- [ ] Convert tests in two commits if the diff is hard to read. First the read tests and `helpers.ts`. Then the write tests and `test/write-boundary.test.ts`.
- [ ] Point helpers at `FetchLike` and the stored token type. Keep the fakes as plain objects.
- [ ] Keep the personal-info scan, the read-only allow-list scan, and the static import walk.
- [ ] Leave the two copies of `normalizeCalendarId` where they are. One stays in `src/lib/google.ts`. One stays in `src/lib/write/policy.ts`.

**You see.**

- [ ] `rg -n '\\.mjs' --glob '!PLAN.md'` prints nothing.
- [ ] `npm test` and `npm run typecheck` both exit 0.
- [ ] `node src/calma.ts` and `node src/calma-write.ts` with no arguments each exit 1 with a usage error.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Every former `test/*.test.mjs` case still exists as `test/*.test.ts`. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `claudeAgent/claude-opus-5-5 effort=xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `node src/calma.ts` and `node src/calma-write.ts` with no arguments at trunk and at head. Save `/tmp/swarm-pr9/worker-1/usage.png`. Pass when all four runs exit 1 and the error field is usage.
- [ ] Lane 2. Run `npm test`. Save `/tmp/swarm-pr9/worker-2/npm-test.png`. Pass when the fail count is 0 and the runner loaded `.ts` tests.
- [ ] Lane 3. Run `npm run typecheck`. Save `/tmp/swarm-pr9/worker-3/typecheck.png`. Pass when the exit code is 0.
- [ ] Lane 4. Run `node --test test/write-boundary.test.ts`. Save `/tmp/swarm-pr9/worker-4/boundary.png`. Pass when the read entry reaches no write file.
- [ ] Lane 5. Run `node --test test/no-personal-info.test.ts`. Save `/tmp/swarm-pr9/worker-5/pii.png`. Pass when the folder scan expects an empty list.
- [ ] Lane 6. Run `node --test test/read-only.test.ts`. Save `/tmp/swarm-pr9/worker-6/read-only.png`. Pass when non-GET is refused.
- [ ] Lane 7. Run `node --test test/write-delete.test.ts`. Save `/tmp/swarm-pr9/worker-7/delete.png`. Pass when guests, a series, and a cancelled event are refused.
- [ ] Lane 8. Run `git ls-files '*.mjs'`. Save `/tmp/swarm-pr9/worker-8/mjs.png`. Pass when the command prints nothing.
- [ ] Lane 9. Run `node src/calma.ts calendar-week --from 2026-01-01 --to 2026-01-03` with an empty `CALMA_DIR`. Save `/tmp/swarm-pr9/worker-9/range.png`. Pass when the exit code is 1 and the error field is reauth_needed.
- [ ] Lane 10. Run `node --input-type=module -e "import p from './package.json' with { type: 'json' }; console.log(p.bin.calma, p.bin['calma-write'], JSON.stringify(p.dependencies ?? null))"`. Save `/tmp/swarm-pr9/worker-10/pkg.png`. Pass when the bins are the two `src/*.ts` files and runtime dependencies are null or absent.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds for `npm test`, and seconds for `node src/calma.ts` with no arguments.
- [ ] Probe. Interleave trunk and head with `/usr/bin/time -p` on both commands.
- [ ] Baseline. Record the trunk seconds first.
- [ ] Rule. Head `npm test` stays under twice the trunk seconds. The no-args read entry finishes in under 1 second on both sides.

**Review gate.** None. PR 9 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The operator lands PR 9. The owner does not merge it.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with each PR id, its verdict, and its head SHA. Do not report a merge unless the operator landed it.

## Appendix A. Prototype evidence

Empty test glob. On Node v26.13.0, `node --test "test/*.test.ts"` in a temp directory with an empty `test/` folder exited 0 and reported 0 tests. Measured this session. No branch and no SHA. The same command on the Node 24 that `.nvmrc` will install is unproven. PR 1 rechecks it on CI.

Type stripping. On Node v26.13.0, a file `hi.ts` containing `export const n: number = 1` and `console.log(n)` printed `1` and exited 0. Measured this session. No branch and no SHA. Node 24.12 or newer is the engine floor because type stripping is stable there. This machine was v26.13.0, which is newer than that floor.

`main` is `300fa03`, the calendar range commit, and that commit is on origin. The TypeScript program has not started.

## Appendix B. Alternatives rejected

Leaving the program at the repository root lost because the layout you asked for is `src/`.

Moving into `src/` only after the TypeScript conversion lost because every conversion PR would also be a rename. PR 1 does the move while the files are still JavaScript. Later PRs convert paths that already sit under `src/`.

A bundler, `tsx`, or `ts-node` lost because the CLI keeps zero runtime dependencies. Node runs the `.ts` files by stripping types. `typescript` is a devDependency used only as `tsc --noEmit`.

One pull request for the whole port lost because a failure would be hard to place. Each PR ends in `npm test` and, from PR 1 on, `npm run typecheck`.

Putting tests under `src/` lost because `node --test` would then treat helper modules as tests unless the script stays a tight glob. Tests stay in `test/` and import `../src/`.

Enums, namespaces, and parameter properties lost because Node 26 strips types and does not compile those forms. `erasableSyntaxOnly` makes `tsc` reject them.

## Appendix C. Risks

PR 1. The boundary test lists files by path. The `WRITE_FILES` array and the import walk must use `src/` in the same commit as the move. A half-updated list fails `npm test`.

PR 1. The personal-info test hashes a known name and also rejects the local part of a signed-in address on this machine. Docs in the repo must not contain that word. Say "this repository" and "origin".

PR 2. Typing the fetch fake as `typeof fetch` makes the current tests fail typecheck without a behavior change. Use the wide `FetchLike` alias instead.

PR 5 and PR 8. `package.json` bins point at `.ts` files. Confirm the shebang runs under the CI Node by invoking the path with no arguments and reading the usage JSON.

PR 6 and PR 7. `WRITE_FILES` is a hand list. Update it in the same commit as each rename or the boundary test fails closed.

PR 9. `readJson` returns `{}` for a body that is not JSON unless `strict` is set. The `unknown` return type has to allow that object.

All PRs. There is no pixel UI. Live lanes record the terminal. A lane that only shows a green test summary, without the command and the exit code, does not pass.

## Appendix D. Links and reading list

Read before editing.

- `<plugin root>/skills/poteto-mode/playbooks/autopilot-stack.md`
- `<plugin root>/skills/poteto-mode/playbooks/opening-a-pr.md`
- `<plugin root>/skills/swarm/SKILL.md`
- `<plugin root>/skills/technical-writing/SKILL.md`
- `<plugin root>/skills/unslop/SKILL.md`
- `<plugin root>/skills/deslop/SKILL.md`
- `<plugin root>/skills/no-comments/SKILL.md`
- `<plugin root>/skills/how/SKILL.md` for PR 7, because `writeRequest` is the allow-list and the typing can hide a call the list should still refuse.
- `<plugin root>/skills/interrogate/SKILL.md` for PR 7 if the body type and the runtime allow-list disagree.
- `<plugin root>/skills/show-me-your-work/SKILL.md` for the decision trail. Keep it local until a PR is open.

The resolved plugin root on this machine is `/Users/m1mbpro/.claude/plugins/cache/t3-pstack/t3-pstack/2.2.8`.

`tsconfig.json` for PR 1.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noEmit": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "rewriteRelativeImportExtensions": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`src/lib/types.ts` exports types only. It imports nothing from `src/lib/write/`.

Error codes for `ToolError` are `usage`, `unexpected`, `scope_refused`, `no_client`, `bad_client`, `reauth_needed`, `bad_email`, `account_required`, `bad_calendar`, `read_only`, `google_error`, `bad_args`, `timeout`, `auth_timeout`, `auth_failed`, `token_error`, `write_refused`, `not_found`, `changed_meanwhile`, `already_exists`, `bad_event`, `calendar_not_allowed`, `account_not_allowed`, `nothing_to_change`, `event_cancelled`, `recurring_event`, `has_guests`, `not_a_calma_event`, `bad_policy`, and `write_not_configured`.

`StoredToken` has `account`, `scope`, `access_token`, `refresh_token`, `expires_at`, and `saved_at`. `FetchLike` is a function that takes a string or URL and an optional init object and returns a promise of a small response. That response has `ok`, `status`, and `json`. It is wider than the global `fetch` type so the current test fakes still typecheck. `WritePolicy` has `accounts` and `calendars`. `WriteLogLine` has `at`, `op`, `account`, `calendar`, `eventId`, and `actor`. `op` is `create`, `update`, or `delete`.
