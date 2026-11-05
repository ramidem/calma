# Contributing

Issues and pull requests are welcome. The ground rules protect the one promise this tool makes:

- **Read-only.** No code that sends, drafts, modifies, labels, deletes or RSVPs, and no scope beyond `gmail.readonly` and `calendar.readonly`. The tests enforce this; don't loosen them.
- **No dependencies.** Plain Node 22+ and `fetch`.
- **No personal data.** Addresses and names come from environment variables. Code, tests and docs use `example.com` placeholders only; `test/no-personal-info.test.mjs` fails otherwise.
- **Never print secrets.** No token, client secret, code or configured address in output, logs or errors.

Run `npm test` before opening a pull request.
