# calma

**Cal**endar and **ma**il. A small Node CLI that prints your Gmail and Google Calendar as JSON. No runtime dependencies.

- `src/calma.ts` is read-only: it requests only `gmail.readonly` and `calendar.readonly`, refuses any other scope, and has no send, draft, modify, label, delete or RSVP code. Every request is a GET to an allow-listed read endpoint, and a test enforces it.
- Calendar event writes are a separate, opt-in tool, `src/calma-write.ts` (see below). Mail is never written, and `src/calma.ts` cannot reach the write code (a test enforces that too).
- No account list to maintain: sign in, and calma remembers the address Google reports. Addresses never live in the repo.

## Setup

1. In Google Cloud, enable the **Gmail API** and **Google Calendar API**. On the OAuth consent screen (type External) add the two read-only scopes. Publish to Production so refresh tokens last; if the app is in Testing, add your addresses as test users.
2. Create an **OAuth client ID** (Desktop app) and save the JSON as `~/.config/calma/client.json` (`chmod 600`), or point `MAIL_CLIENT_FILE` at it.
3. Sign in, once per account:

   ```sh
   node src/calma.ts auth
   ```

   Your browser opens on Google's account chooser: pick the account and approve. (If it cannot open, or you pass `--no-open`, open the printed `url` yourself.) The token is saved to `~/.config/calma/<address>.json` (mode 600).

Production publishing is preferred so refresh tokens last. Testing expires refresh tokens after 7 days. When a command answers `reauth_needed`, run `auth` again.

Upgrading from a version that used `MAIL_ACCOUNT_*` and `accounts.env`: run `auth` again for each account. Old `<label>.json` tokens are ignored; `uninstall --all --yes` removes them.

## Commands

Output is JSON on stdout. Errors are JSON too, with exit code 1. With one account signed in, commands need nothing extra; with several, add `--account <email>` (or `-a`).

```sh
node src/calma.ts auth [--no-open]                   # sign in; opens Google's account chooser in your browser
node src/calma.ts accounts                           # list signed-in addresses
node src/calma.ts mail-recent [gmail query]          # default: last 7 days, up to 20
node src/calma.ts mail-today [gmail query]           # since midnight today (your local time), up to 20; "more": true if there were more
node src/calma.ts mail-thread <threadId>             # hex id from mail-recent
node src/calma.ts calendar-week                      # Monday to next Monday (primary)
node src/calma.ts calendar-week --calendar <id>      # same week on another calendar (e.g. Actual)
node src/calma.ts calendar-week --from <iso> --to <iso>  # explicit range, at most 31 days (combine with --calendar)
node src/calma.ts uninstall --account <email>        # dry run: lists what it would remove
node src/calma.ts uninstall --account <email> --yes  # revoke that account at Google, delete its token
node src/calma.ts uninstall --all --yes              # every token, client.json, then the empty folder
```

`uninstall` only removes files calma created in `~/.config/calma`, and names anything it kept. Then delete the cloned folder. If a revoke could not reach Google, remove calma under your Google account's Third-party access.

## Calendar writes (`src/calma-write.ts`)

`src/calma.ts` never changes anything. Creating, updating and deleting calendar events lives in a separate entry point, `src/calma-write.ts`, with its own sign-in and token (`~/.config/calma/write/<address>.json`). A test checks that `src/calma.ts` never imports it. It asks for the `calendar.events` scope, which Google offers only for all calendars of an account, so what it may touch is limited by an allow-list in `~/.config/calma/write.json`, not by Google.

```sh
node src/calma-write.ts allow --account <email>      # who may write (once)
node src/calma-write.ts allow --calendar primary     # which calendars (once; add more ids the same way)
node src/calma-write.ts policy                       # show the allow-lists
node src/calma-write.ts auth [--no-open]             # write sign-in; refused (and revoked) for an address not allowed
node src/calma-write.ts accounts                     # addresses with a write token

node src/calma-write.ts calendar-create --title <text> --start <time> --end <time> --actor <label>          # dry run: shows what it would create
node src/calma-write.ts calendar-create ... --yes                                                          # creates it

node src/calma-write.ts calendar-update <eventId> --title <text> --actor <label>                           # dry run: reads the event, shows before and after
node src/calma-write.ts calendar-update <eventId> ... --yes                                                # applies it

node src/calma-write.ts calendar-delete <eventId> --actor <label>                                          # dry run: reads the event, shows what would be deleted
node src/calma-write.ts calendar-delete <eventId> --actor <label> --yes                                    # deletes it
```

`calendar-create` options: `--all-day` (dates, end optional and exclusive), `--description`, `--location`, `--free` (does not block time), `--private`, `--prop name=value` (private properties, repeatable), `--calendar <id>` (default `primary`, must be on the allow-list), `--account <email>`, and `--key <text>` (a retry with the same key cannot create a duplicate: Google answers 409, reported as `already_exists`). Times need an offset, like `2026-11-06T09:00:00+08:00`. `--actor` is required: a short label for who is asking, recorded in `write.log` with the event id (never the title). Every created event is marked (`calma=1`, `calma_actor`, `calma_created`), has no guests and no recurrence, and never emails anyone (`sendUpdates=none`). Options it does not know, such as `--attendee`, are refused.

`calendar-update` changes one event: `--title`, `--start`, `--end`, `--all-day`, `--description`, `--location`, `--free`/`--busy`, `--private`/`--public`, `--prop name=value`, with the same `--actor`, `--calendar`, `--account` and `--yes` as create. It reads the event first and sends only what differs, with the etag it read (`If-Match`): if the event changed in between, you get `changed_meanwhile` and nothing is overwritten. A new `--start` without `--end` keeps the event's length. A field can be changed but not blanked. Applied updates set `calma_updated` and `calma_updated_by` and add a `write.log` line. Refused:

- `not_a_calma_event`: the event has no calma marker (it was made by hand). Only the owner passes `--any-event` to allow that.
- `has_guests`, `recurring_event`, `event_cancelled`: always, no flag overrides these.
- `nothing_to_change`: the event already looks like that. The marker properties (`calma*`) can never be set or removed with `--prop`.

`calendar-delete <eventId>` deletes one event, with `--actor`, `--calendar`, `--account` and `--yes` as above. The dry run (the default) reads the event and shows its id, title, start, end, whether it carries the calma marker and what would be deleted; it sends no DELETE and writes no log line. With `--yes` it reads the event again right before the DELETE, judges that fresh copy, then sends one `DELETE` with `sendUpdates=none` (no `If-Match`) and adds a `write.log` line (op `delete`, the event id, account, calendar and actor; never the title). The title is printed in the output. Refused:

- `has_guests`, `recurring_event`, `event_cancelled`: always, no flag overrides these.
- `not_a_calma_event`: the event has no calma marker. Only the owner passes `--any-event` to allow that.
- `not_found`: Google says the event does not exist or is already deleted (404 or 410); nothing is logged.
- Options that belong to other commands (`--title`, `--start`, `--key`, `--prop`, `--busy`, `--public`, ...) and anything unknown, such as `--attendee` or `--send-updates`.

The tool does not ask for any other approval: the owner's per-operation yes for bots is an instruction rule, not a check calma-write makes.

Add `calendar.events` under Data Access on the Google consent screen first. `node src/calma.ts uninstall` removes and revokes write tokens too.

## Security

Token files are plain files: any process running as you can read them. Run `uninstall` to cut access. Nothing secret is ever printed or logged.

Report vulnerabilities as in [SECURITY.md](SECURITY.md).

## Development

```sh
nvm use     # Node 24 from .nvmrc (24.12 or newer works)
npm test    # no network, no secrets
```

One test fails on any email address other than `@example.com` or any hardcoded personal name. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
