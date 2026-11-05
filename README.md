# readonly-mail

Read-only Gmail and Calendar for up to a few accounts you name in environment variables. One small Node script, JSON on stdout. It is **not part of the app**: it has its own `package.json`, no dependencies, and the root `package.json`, `tsconfig.json` and lint do not include it.

## What it can and can't do

Can:

- Read recent mail (sender, recipients, subject, date, snippet) and one whole thread (plain-text body, attachment names only).
- Read this week's events from the account's primary calendar (title, time, location, attendee count).

Can't, by design:

- Send, draft, modify, label, archive, delete or RSVP. There is no such function in the code, no such endpoint on the allow-list, and a test fails if one appears.
- Request any scope other than `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/calendar.readonly`. It refuses to build an auth URL with another scope, and refuses (and saves nothing) if Google grants one.
- Read an account you have not configured. Each account is an environment variable (`MAIL_ACCOUNT_<NAME>=<address>`, see below); no address or name is written in the code, the tests or these docs. During `auth` it checks that the signed-in Google address is the configured one.

Because the limit is the scope Google grants, a bug in this script still could not send or change anything.

## Setup (the owner does the Google Cloud steps)

1. In Google Cloud Console, create or pick a project. Enable the **Gmail API** and the **Google Calendar API**.
2. OAuth consent screen (Google Auth Platform): app type External, publishing status **Testing**. Under **Data Access** add only `.../auth/gmail.readonly` and `.../auth/calendar.readonly`. Under **Audience** add each account's address as a **test user**.
3. Credentials: create an **OAuth client ID** of type **Desktop app**. Download the JSON.
4. Save it as `~/.config/readonly-mail/client.json` (or anywhere, and point `MAIL_CLIENT_FILE` at it) and run `chmod 600` on it (create the folder with `mkdir -m 700 ~/.config/readonly-mail` if it is not there; the script creates it with mode 700 when it first saves a token). The file can be Google's download as is, or `{"client_id": "...", "client_secret": "..."}`.

5. Name your accounts. Copy [`.env.example`](.env.example) to `~/.config/readonly-mail/accounts.env`, `chmod 600` it, and put your real addresses in it:

   ```sh
   cp .env.example ~/.config/readonly-mail/accounts.env
   chmod 600 ~/.config/readonly-mail/accounts.env
   # then edit it: MAIL_ACCOUNT_PERSONAL=<personal-address>, MAIL_ACCOUNT_WORK=<work-address>, ...
   ```

   The script reads that file by itself (`MAIL_ENV_FILE` points it somewhere else). Variables you already exported win over the file, so this works too:

   ```sh
   export MAIL_ACCOUNT_PERSONAL='<personal-address>'
   export MAIL_ACCOUNT_WORK='<work-address>'
   export MAIL_CLIENT_FILE="$HOME/.config/readonly-mail/client.json"   # optional, this is the default
   ```

   `<NAME>` in lower case is the label you type: `MAIL_ACCOUNT_PERSONAL` becomes `personal`. If a label's variable is missing the script stops and says which variable to set; it never prints an address. The real env file is gitignored (`.env`, `*.env`, `accounts.env`); only `.env.example`, with placeholders, is committed.

The client file, the accounts file and the tokens live outside the repo. `.gitignore` also blocks `client_secret*.json`, `credentials*.json` and `tokens/` in case one is copied in by mistake.

## One-time sign-in per account

```sh
node readonly-mail.mjs auth <name>      # for example: auth personal
```

It prints one JSON line with an `auth_url`. Open that URL in a browser and pick the matching Google account, approve the two read-only permissions, and the script receives Google's answer on `127.0.0.1` (a random local port), saves the token to `~/.config/readonly-mail/<name>.json` (mode 600) and prints `{"event":"authorized",...}`. Repeat for each label. Google may warn that the app is unverified; that is expected for a test-mode app that only you use.

**Test mode expires tokens after 7 days.** When a command answers `{"error":"reauth_needed",...}`, run `auth <name>` again. Moving the consent screen to "In production" removes the 7-day limit but changes how Google treats the app (it may ask for verification for sensitive scopes); keep it in Testing unless that becomes a real nuisance.

## Commands

All output is JSON on stdout. Errors are JSON too, with exit code 1: `{"error":"<code>","message":"..."}`.

```sh
node readonly-mail.mjs mail-recent <name>                        # last 7 days, up to 20 messages
node readonly-mail.mjs mail-recent <name> from:<sender-address> newer_than:14d   # any Gmail search query
node readonly-mail.mjs mail-thread <name> <threadId>              # a hex threadId from mail-recent
node readonly-mail.mjs calendar-week <name>                      # Monday to next Monday, local time
```

Run the tests (no network, no secrets, placeholder addresses only, a temporary folder): `cd tools && npm test`. One test scans this folder and fails on any email address other than `@example.com` or any hardcoded name; keep it that way.

## Security note

The token files are plain files. **Any agent or program with full access to this Mac can read them**, including the OpenBot agents that run here with full local access. So this is not private from the bots; it only keeps mail and calendar access out of their tool lists, and what a stolen token could do is limited to reading the configured accounts. To cut access completely: delete `~/.config/readonly-mail/<name>.json` and revoke the app under the Google account's Security, Third-party access page.

The script never prints or logs a token, client secret, authorization code or configured address, and error messages carry only Google's error code or the name of the variable that is missing.
