# TODO

Workflow: each item is its own branch, made in its own git worktree (`git worktree add ../calma-worktrees/<branch> -b <branch> origin/main`), with its own commit and PR. Never push to a branch after its PR has merged.

## Open

- [ ] Check the CI run on `main` after the next merge.
- [ ] Commit b4209f2 has a personal Gmail as author. Decided: leave the history as it is. Nothing to do unless that changes.
- [ ] By hand (needs real Google sign-ins): a second `auth` adds a second account; `accounts` lists both; `mail-recent` without `--account` fails with `account_required` and works with it; `mail-today` returns today's mail; `uninstall --account <email> --yes` revokes and removes only that token; `uninstall --all --yes` empties and removes the folder.
