# Changelog

## 1.0.0 - 2026-10-23

- First standalone release, synchronized with getmcpads gateway revision `3e1c2c8`.
- Five native read tools: `adjust_list_apps`, `adjust_list_events`, `adjust_get_catalog`, `adjust_run_report` and `adjust_compare_periods`, plus the `adjust://guide` resource.
- Read-only by design. There is no write tool and no write setting.
- Require `ADJUST_API_TOKEN` and an explicit `ADJUST_APP_TOKENS` allowlist, validated at startup. `ADJUST_ENVIRONMENT` fixes production or sandbox data for every report.
- Send requests only to `automate.adjust.com`, refuse redirects, apply a 25 second timeout and a 20 MB response limit, and redact the API token from provider text.
- Keep native totals, treat HTTP 200 error bodies as failures and mark truncated, warned or paginated reports partial.
- Report configured app tokens that Adjust did not return, in `unavailableAppTokens`.
- Require Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release of those lines, warn on stderr otherwise, and check Node 22, 24 and 26 in CI.
- Publish from version tags through `release.yml`: npm with provenance, the GitHub release, then the MCP Registry.
