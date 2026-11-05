# calma

**Cal**endar and **ma**il, read-only. A small Node CLI that prints your Gmail and Google Calendar as JSON. No dependencies.

- Requests only `gmail.readonly` and `calendar.readonly`, and refuses any other scope.
- No send, draft, modify, label, delete or RSVP code. Every request is a GET to an allow-listed read endpoint, and a test enforces it.
- Accounts, addresses and the OAuth client come from your environment, never from the repo.

## Setup

1. In Google Cloud, enable the **Gmail API** and **Google Calendar API**. On the OAuth consent screen (type External, status Testing) add the two read-only scopes and your addresses as test users.
2. Create an **OAuth client ID** (Desktop app) and save the JSON as `~/.config/calma/client.json` (`chmod 600`), or set `MAIL_CLIENT_FILE`.
3. Name your accounts: copy [`.env.example`](.env.example) to `~/.config/calma/accounts.env`, `chmod 600`, fill in `MAIL_ACCOUNT_<NAME>=<address>`. `<NAME>` in lower case is the label you use below. Exported variables win over the file (`MAIL_ENV_FILE` points elsewhere).
4. Sign in once per account:

   ```sh
   node calma.mjs auth <name>
   ```

   Open the printed URL, approve, done. The token is saved to `~/.config/calma/<name>.json` (mode 600).

Test-mode tokens expire after 7 days; when a command answers `reauth_needed`, run `auth` again.

## Usage

Output is JSON on stdout. Errors are JSON too, with exit code 1.

```sh
node calma.mjs mail-recent <name> [gmail query]   # default: last 7 days, up to 20
node calma.mjs mail-thread <name> <threadId>      # hex id from mail-recent
node calma.mjs calendar-week <name>               # Monday to next Monday
```

## Uninstall

```sh
node calma.mjs uninstall <name>          # dry run: lists what it would remove
node calma.mjs uninstall <name> --yes    # revoke that account at Google, delete its token
node calma.mjs uninstall --all --yes     # every token, plus client.json and accounts.env, then the empty folder
```

It only removes files calma created in `~/.config/calma`. Then delete the cloned folder. If a revoke could not reach Google, remove calma under your Google account's Third-party access.

## Security

Token files are plain files: any process running as you can read them. Run `uninstall` (above) to cut access. Nothing secret is ever printed or logged.

Report vulnerabilities as in [SECURITY.md](SECURITY.md).

## Development

```sh
npm test    # Node 22+, no network, no secrets
```

One test fails on any email address other than `@example.com` or any hardcoded personal name. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
