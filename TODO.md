# TODO

Workflow: each item below is its own branch, made in its own git worktree (`git worktree add ../calma-worktrees/<branch> -b <branch> origin/main`), with its own commit and PR. Items that build on an open PR branch from that PR's branch and say so in the PR. Tick the box in the PR that does the item.

## Open

- [x] Pin Node 22 with `.nvmrc` and use it in CI (PR #4).
- [x] Merge PR #3 (revoke on refusal, stalled-body timeout, 5-request cap, HTML entities).
- [ ] Check the first GitHub Actions run (tests pass locally on Node 22 and 26).
- [ ] Commit b4209f2 has a personal Gmail as author. Decided: leave the history as it is. Nothing to do unless that changes.

## Sign in without typing an address

`node calma.mjs auth` opens Google's account chooser and saves the token under the address Google reports. No env for accounts, no labels.

### Code (one PR; `npm test` passes after each item)

- [ ] `lib/config.mjs`: delete `MAIL_ACCOUNT_*`, `accounts.env`, `MAIL_ENV_FILE`, `loadEnvFileIfPresent`, `accountEmail`.
- [ ] `lib/config.mjs`: add `normalizeEmail` (trim, lower-case, one `@`, reject `/`, `\`, spaces, `..`, over 254 characters).
- [ ] `lib/config.mjs`: `tokenPath(email)`, `listAccounts()` (token files with a `scope`), `resolveAccount(flag)`: one account needs no flag; several need `--account` (`account_required`); none is `reauth_needed`.
- [ ] `lib/oauth.mjs`: `authorize` takes no address; add `select_account` to `prompt`.
- [ ] `lib/oauth.mjs`: read `emailAddress` from the profile; if missing or invalid, refuse and revoke (as today); else save as `<address>.json`, print `{"event":"authorized","account":"<address>"}`.
- [ ] `calma.mjs`: parse `--account`/`-a`, `--yes`, `--all`; commands use the resolved address; update the usage text.
- [ ] `calma.mjs`: add `accounts` (lists signed-in addresses, never a token).
- [ ] `lib/uninstall.mjs`: target is `--account <email>` or `--all`; drop the `accounts.env` handling.

### Tests (placeholders `@example.com` only)

- [ ] `auth` with no address saves under the profile address and prints it.
- [ ] A profile with no `emailAddress` is refused and the grant revoked.
- [ ] `normalizeEmail` rejects `../x@example.com`, `a/b@example.com`, empty and double `@`.
- [ ] One account needs no flag; two need `--account`; none gives `reauth_needed`.
- [ ] `accounts` lists addresses and no token.
- [ ] `uninstall --account` and `--all` still pass; the old `<label>` form is rejected with a clear message.
- [ ] `no-personal-info.test.mjs`: drop the `MAIL_ACCOUNT_*` runtime words and the `.env.example` check.
- [ ] Run `npm test` on Node 22 and 26.

### Docs and cleanup

- [ ] README: Setup is three steps (Google Cloud, `client.json`, `auth`); remove the env section; update Commands.
- [ ] Delete `.env.example`; mention `MAIL_CLIENT_FILE` in one line.

### Done when (owner, by hand)

- [ ] `auth` opens the chooser and prints the chosen address; a second `auth` adds a second account.
- [ ] `accounts` lists both; `mail-recent` fails with `account_required` and works with `--account`.
- [ ] `uninstall --account <email> --yes` revokes and removes only that token; `uninstall --all --yes` empties and removes the folder.
