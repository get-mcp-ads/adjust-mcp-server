# Changelog

## 1.0.1 - 2026-10-26 - Zod 4 security update
- Update `zod` to 4.6.7. Every Zod release before 4.6.6 is covered by the high-severity advisory GHSA-mrhx-c7xc-m3w5: validating an oversized constrained collection can exhaust memory, and no Zod 3 release carries the fix. `npm audit --omit=dev` reports no vulnerability again.
- Keep the Zod 3 validation behaviour. A parameter default is still validated and completed before use, so an omitted object must still supply its required fields.
- Keep each parameter's own description when the parameter is optional or has a default. Zod 4 stores a description on the wrapped schema only, so the shared fallback description could otherwise replace it.
- Tool names, parameters and descriptions published over MCP are unchanged. `server-card.json` is regenerated with Zod 4's JSON Schema output, which spells some constraints differently.

## 1.0.0 - 2026-10-23 - First standalone release
- First standalone release, synchronized with getmcpads gateway revision `3e1c2c8`.
- Five native read tools: `adjust_list_apps`, `adjust_list_events`, `adjust_get_catalog`, `adjust_run_report` and `adjust_compare_periods`, plus the `adjust://guide` resource.
- Read-only by design. There is no write tool and no write setting.
- Require `ADJUST_API_TOKEN` and an explicit `ADJUST_APP_TOKENS` allowlist, validated at startup. `ADJUST_ENVIRONMENT` fixes production or sandbox data for every report.
- Send requests only to `automate.adjust.com`, refuse redirects, apply a 25 second timeout and a 20 MB response limit, and redact the API token from provider text.
- Keep native totals, treat HTTP 200 error bodies as failures and mark truncated, warned or paginated reports partial.
- Report configured app tokens that Adjust did not return, in `unavailableAppTokens`.
- Require Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release of those lines, warn on stderr otherwise, and check Node 22, 24 and 26 in CI.
- Publish from version tags through `release.yml`: npm with provenance, the GitHub release, then the MCP Registry.
