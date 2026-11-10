# Privacy policy — Calma

Calma is a personal command-line tool for reading Gmail and Google Calendar (and, separately, creating or updating calendar events you allow).

## Who this is for

This app is maintained for personal use by the developer. It is not offered as a public product.

## Data we access

With your Google sign-in, Calma may access:

- Gmail messages you ask it to list or open (read-only)
- Google Calendar events you ask it to list (read-only)
- Calendar events you explicitly create, update, or delete through `calma-write` (only calendars on your local allow-list)

## Where data is stored

- OAuth tokens are stored only on your computer under `~/.config/calma/` (mode 600).
- Calma does not upload your mail, calendar events, or tokens to a Calma server. There is no Calma backend.
- Command output is printed to your terminal. You control where that goes.

## Sharing

Calma does not sell or share your Google data with third parties. Google receives normal OAuth and API traffic when you use the tool.

## Retention

Tokens remain until you revoke them (`calma uninstall`) or remove Calma under your Google Account → Third-party access.

## Contact

Questions about this policy: the support email shown on the Google OAuth consent screen for this app.
