# TODO

Audit of 0c539fa (2026-11-05). Fixed on branch `fix/audit-todo`: wrong-state callback, request timeouts, HTML-only mail, incomplete token responses, sequential fetches. Left here:

## Needs the owner

- [ ] Commit b4209f2 has a personal Gmail author address; the other commits use a `.local` hostname. The personal-info test scans files, not history. Decide whether to rewrite history (the repo is already pushed, so a rewrite means a force-push and re-clones).
- [ ] `lib/oauth.mjs` `authorize`: when calma refuses a grant (wrong account or extra scope), the token stays live at Google. Revoke it on refusal. Adds a second POST and changes the read-only test; do it after `feat/uninstall` merges, which adds `revokeToken`.

## Before merging `feat/uninstall`

- [ ] Read it (3e5170b). A label-shaped file in the config folder that is not a valid token is never removed, even by `--all`; the folder is then kept. This is deliberate (only remove what calma owns); the output should name what was kept.

## Other

- [ ] Check the first GitHub Actions run. Locally the tests pass on Node 22.23 and 26.13.
