# Contributing

Thanks for considering a contribution. This project is maintained by
[GetMCPAds](https://www.getmcpads.com) and is open to outside patches.

## Getting set up

Use Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release of those lines.

```bash
git clone https://github.com/get-mcp-ads/adjust-mcp-server.git
cd adjust-mcp-server
npm ci
cp .env.example .env
```

Then run the checks:

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

All four must pass. CI runs them on Node 22, 24 and 26.

## Ground rules

**Never commit a token.** `.env` is gitignored. Before opening a pull request,
reread your diff for anything that looks like an API token.

**Tests use synthetic data.** Every test stubs `fetch`. Do not add a test that
needs live credentials or contacts Adjust; CI has none.

**Metric and dimension names are load-bearing.** This server accepts Adjust's
native slugs rather than friendly aliases. If you add or change a dimension,
link the Adjust documentation that lists it in the pull request description.

**Keep the server read-only.** There are no write tools and no write setting.
A pull request that adds one will not be merged.

**Do not widen what reaches the model.** The app allowlist, the per-app
filtering of event definitions and the token redaction are deliberate. Do not
relax them without saying why in the pull request.

**Keep native totals.** Totals come from Adjust and are never rebuilt from
breakdown rows. Missing values stay `null`.

**Keep it self-contained.** Runtime dependencies are `@modelcontextprotocol/sdk`
and `zod`. Adding a third needs a good reason.

Keep all documentation in English, without em dashes.

## Credentials never reach another host

Two tests enforce this: one fails if a `fetch` can follow a redirect, and one
fails if a host other than `automate.adjust.com` appears in the source.

## Commit and pull request style

- One logical change per pull request.
- Explain why, not only what. The diff already says what.
- If you fix a bug, add the test that would have caught it.

## Reporting bugs

Open an issue with what you called, what you expected and what you got.
Redact app tokens and API tokens.

For anything security-related, do not open an issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, as stated in [LICENSE](LICENSE).
