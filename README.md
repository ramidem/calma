# calma

**Cal**endar and **ma**il, read-only. A small Node CLI that prints your Gmail and Google Calendar as JSON. No dependencies.

- Requests only `gmail.readonly` and `calendar.readonly`, and refuses any other scope.
- No send, draft, modify, label, delete or RSVP code. Every request is a GET to an allow-listed read endpoint, and a test enforces it.
- No account list to maintain: sign in, and calma remembers the address Google reports. Addresses never live in the repo.

## Setup

1. In Google Cloud, enable the **Gmail API** and **Google Calendar API**. On the OAuth consent screen (type External, status Testing) add the two read-only scopes and your addresses as test users.
2. Create an **OAuth client ID** (Desktop app) and save the JSON as `~/.config/calma/client.json` (`chmod 600`), or point `MAIL_CLIENT_FILE` at it.
3. Sign in, once per account:

   ```sh
   node calma.mjs auth
   ```

   Open the printed URL, pick the Google account, approve. The token is saved to `~/.config/calma/<address>.json` (mode 600).

Test-mode tokens expire after 7 days; when a command answers `reauth_needed`, run `auth` again.

Upgrading from a version that used `MAIL_ACCOUNT_*` and `accounts.env`: run `auth` again for each account. Old `<label>.json` tokens are ignored; `uninstall --all --yes` removes them.

## Commands

Output is JSON on stdout. Errors are JSON too, with exit code 1. With one account signed in, commands need nothing extra; with several, add `--account <email>` (or `-a`).

```sh
node calma.mjs auth                               # sign in; opens Google's account chooser
node calma.mjs accounts                           # list signed-in addresses
node calma.mjs mail-recent [gmail query]          # default: last 7 days, up to 20
node calma.mjs mail-thread <threadId>             # hex id from mail-recent
node calma.mjs calendar-week                      # Monday to next Monday
node calma.mjs uninstall --account <email>        # dry run: lists what it would remove
node calma.mjs uninstall --account <email> --yes  # revoke that account at Google, delete its token
node calma.mjs uninstall --all --yes              # every token, client.json, then the empty folder
```

`uninstall` only removes files calma created in `~/.config/calma`, and names anything it kept. Then delete the cloned folder. If a revoke could not reach Google, remove calma under your Google account's Third-party access.

## Security

Token files are plain files: any process running as you can read them. Run `uninstall` to cut access. Nothing secret is ever printed or logged.

Report vulnerabilities as in [SECURITY.md](SECURITY.md).

## Development

```sh
nvm use     # Node 22 from .nvmrc (22 or newer works)
npm test    # no network, no secrets
```

One test fails on any email address other than `@example.com` or any hardcoded personal name. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
