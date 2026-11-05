# TODO

Workflow: each item is its own branch, made in its own git worktree (`git worktree add ../calma-worktrees/<branch> -b <branch> origin/main`), with its own commit and PR. Never push to a branch after its PR has merged.

## Calendar write (`calma-write.mjs`): plan approved 2026-11-05

Writers: Schedule, Parenting and Grook; personal account only, never the kids' accounts; calendars: `primary` and the "Actual" calendar (ids set with `allow --calendar`, never in the repo). Creates and updates by those writers need no per-operation yes; deletes, and updates of events calma did not create, need Med's yes. Dry run by default, `--yes` to apply; marker on created events; no guests, no recurring series; write log.

- [x] PR 1: scope split, write token store, `calma-write auth`, allow-list, import-graph test, uninstall removes write tokens.
- [x] PR 2: `calendar-create` (dry run, validation, marker, no guests, `sendUpdates=none`, write log, `--key` for retry safety).
- [x] PR 3: `calendar-update` (own events freely; others need `--any-event`; etag check; no guests, series or cancelled events).
- [ ] PR 4: `calendar-delete` (id + `--yes`, title shown first, refuses guests, series and unmarked events).
- [ ] PR 5: docs: README, SECURITY.md, CONTRIBUTING.md and the repo description say what is true.
- [ ] Med: add `calendar.events` on the Google consent screen, then `node calma-write.mjs allow --account <email>`, `allow --calendar primary`, and `auth`.

## Open

- [ ] Check the CI run on `main` after the next merge.
- [ ] Commit b4209f2 has a personal Gmail as author. Decided: leave the history as it is. Nothing to do unless that changes.
- [ ] By hand (needs real Google sign-ins): a second `auth` adds a second account; `accounts` lists both; `mail-recent` without `--account` fails with `account_required` and works with it; `mail-today` returns today's mail; `uninstall --account <email> --yes` revokes and removes only that token; `uninstall --all --yes` empties and removes the folder.
