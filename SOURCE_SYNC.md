# Source synchronization

Reviewed on 2026-10-23 against getmcpads gateway revision `3e1c2c8` (origin/main on that date).

## Synchronized

- `packages/db/src/adjust.ts`: the Report Service client. Fixed origin, GET only, the per-app allowlist check before every request, the fixed environment, request validation for dates, dimensions, metrics, filters, UTC offset, currency and OS names, bounded retries on HTTP 429, 502, 503 and 504 with `Retry-After`, redirect refusal, the 25 second timeout, the 20 MB response limit, detection of HTTP 200 error bodies, token redaction, per-app filtering of event definitions, native totals and the partial, truncated and pagination warnings.
- `apps/mcp/src/sources/adjust/tools.ts`: the five tools with their gateway names, parameters, defaults and descriptions, the period comparison logic and the `adjust://guide` resource.
- The dimension, example metric and OS name catalogs (35 dimensions, 12 metrics).
- Tests ported from `apps/mcp/test/adjust.test.ts`, `adjust-mcp.test.ts` and the native reader cases of `adjust-v1.test.ts`.

## Adapted for a standalone server

- The allowlist comes from `ADJUST_APP_TOKENS` and the environment from `ADJUST_ENVIRONMENT`, instead of the hosted workspace selection.
- Tool descriptions say "allowlisted" instead of "selected in this workspace". `adjust_get_catalog` lists only native workflows.
- `adjust_list_apps` adds `unavailableAppTokens`, so a configuration error is visible without a dashboard.
- Errors return as MCP tool errors carrying the message, the HTTP status and `retryAfterSeconds`, instead of being thrown to the hosted gateway.
- Input objects are strict over MCP as well, so an unknown argument is rejected before any request.
- The client calls the global `fetch` at request time. The gateway's Cloudflare Workers receiver workaround and its test do not apply to Node.js.
- The gateway's `cache: "no-store"` request option is not set: the Node.js type definitions in use do not declare it, and Node's fetch keeps no HTTP cache.

## Hosted only, not included

- Report extraction for the hosted data service, Google Sheets exports and business reviews.
- The cockpit snapshot, the assistant connection handoff, encrypted token storage, workspaces and billing.
- The hosted data catalog link and the workflow pointers to hosted tools.
- Internal QA tooling, the Android and iOS sandbox apps used for live checks and the live test files.

Validation uses synthetic data. No live Adjust request is made by the test suite. The generated server-card.json is the source of truth for this revision's tool schemas.

Maintainer: Emmanuel, getmcpads. Contact: hello@getmcpads.com.
