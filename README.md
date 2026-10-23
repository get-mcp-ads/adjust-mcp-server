<div align="center">

# Adjust MCP server

### Bring your Adjust reporting into your MCP client.

Read attribution and performance reports, event catalogs and period comparisons for explicitly selected apps.

[![Release](https://img.shields.io/github/v/release/get-mcp-ads/adjust-mcp-server?color=2448e5)](https://github.com/get-mcp-ads/adjust-mcp-server/releases/latest)
[![CI](https://github.com/get-mcp-ads/adjust-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/get-mcp-ads/adjust-mcp-server/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22.23.4%2B%20%7C%2024.22.1%2B%20%7C%2026.12.1%2B-brightgreen.svg)](package.json)

[Watch the film](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4) · [What's new](#whats-new) · [Install](#install-this-release) · [Tool reference](#tools) · [Try hosted getmcpads](https://www.getmcpads.com/tools/adjust?utm_source=github&utm_medium=readme&utm_campaign=adjust)

[![Watch the getmcpads film: every ad account in one conversation with your AI assistant](https://www.getmcpads.com/home/film/brand-film-poster-promise.webp)](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4)

**[Play the 45-second film](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4)**

</div>

The film shows hosted getmcpads with sample data. Its MCP Apps, from creative galleries and alerts to Google Sheets exports and bulk launches, belong to the hosted product. This repository provides the standalone native API tools.

**5 read tools** · **0 write tools**. Read-only by design: no setting adds a write tool.

Run locally with your own Adjust API token and a client that supports stdio MCP, such as Claude Desktop, Claude Code or Cursor. Your requests go directly to the Adjust Report Service API. For managed connections, including supported ChatGPT setups, use the hosted option.

## What's new

**[v1.0.0: First standalone release](https://github.com/get-mcp-ads/adjust-mcp-server/releases/tag/v1.0.0) · October 23, 2026**

- Port the five native Adjust reads and the reporting guide from the hosted gateway.
- Require an explicit app token allowlist, checked before every request and applied to app discovery.
- Send requests only to the documented Report Service host, with refused redirects, timeouts, bounded responses and token redaction.
- Require a Node.js release with the October 2026 security fixes and check Node 22, 24 and 26 in CI.

[Full changelog](CHANGELOG.md) · [Source synchronization details](SOURCE_SYNC.md) · [All releases](https://github.com/get-mcp-ads/adjust-mcp-server/releases)

### Upgrade notes

This is the first release. It requires Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release of those lines, and prints a warning on stderr when started on an older one. Hosted MCP Apps, exports and business reviews are outside this release.

## Install this release

This is a GitHub source release. npm and MCP Registry versions are published separately. The commands below select this exact version; unpinned `npx` examples later in this document select the version currently available on npm.

```bash
git clone --branch v1.0.0 --depth 1 https://github.com/get-mcp-ads/adjust-mcp-server.git
cd adjust-mcp-server
npm ci
npm run build
```

Configure your MCP client to run `node` with the absolute path to `dist/cli.js` and the variables documented below.

```json
{
  "mcpServers": {
    "adjust": {
      "command": "node",
      "args": ["/absolute/path/to/adjust-mcp-server/dist/cli.js"],
      "env": {
        "ADJUST_API_TOKEN": "your-adjust-api-token",
        "ADJUST_APP_TOKENS": "abc123def456,ghi789jkl012"
      }
    }
  }
}
```

Once the package is on npm, the same entry can use `"command": "npx"` with `"args": ["-y", "@getmcpads/adjust-mcp-server"]`. Run `npm run doctor` in the repository to check the configuration locally. It prints no secret and makes no network request.

> **Prefer a managed connection?** [Use Adjust with hosted getmcpads](https://www.getmcpads.com/tools/adjust?utm_source=github&utm_medium=readme&utm_campaign=adjust). Connect your account, select the data your assistant may access and use the hosted MCP connection. See the site for current features and plans.

## Configuration

Provide these environment variables through the client's secret configuration:

| Variable | Purpose |
|---|---|
| `ADJUST_API_TOKEN` | Required. The API token of your Adjust user. It is a bearer credential with that user's reporting access. |
| `ADJUST_APP_TOKENS` | Required. Comma-separated app tokens this server may read, up to 200. Every request is checked against this list, and app discovery returns only these apps. |
| `ADJUST_ENVIRONMENT` | `production` (default) or `sandbox`. Fixed for every report; a tool call cannot change it. |

Adjust shows the API token in your profile's account settings. See [Adjust's authentication guide](https://dev.adjust.com/en/api/rs-api/authentication).
The server checks the configuration at startup and exits with a message that names the variable to fix. That message never contains a token value.
After setup, call `adjust_list_apps`. Its `unavailableAppTokens` field lists configured app tokens that Adjust did not return for this API token.
This package accepts a token from the environment. It runs no OAuth flow and writes nothing to disk. When you rotate the token, update the client configuration and restart the server.

## Safety and coverage

Read-only by design. Every request is an HTTP GET to the Report Service. There is no write tool and no environment variable that adds one.
The app allowlist is checked before any request is sent. App discovery is filtered to the allowlist, and a report that contains a row from another app is withheld.
Requests go only to `automate.adjust.com`, the host Adjust documents for the Report Service. Redirects are refused and never followed. Each request has a 25 second timeout and a 20 MB response limit.
An HTTP 200 response that carries an error body is treated as a failed request and returns no data.
A read makes at most three attempts on HTTP 429, 502, 503 and 504, honoring a short `Retry-After`. A longer delay is returned as `retryAfterSeconds` instead of waiting. Adjust documents a limit of 50 requests per second per source IP address, with a burst allowance of 100.

Reports keep Adjust's native totals. They are never rebuilt from breakdown rows. A missing value is `null`, not zero, and ratios such as ROAS stay native fractions. Truncated rows, provider warnings, duplicate breakdown rows and unexpected pagination metadata mark a report `partial`.
The API token is never returned or logged, and it is removed from provider text before that text reaches the model. Event definitions keep only the requested app: other apps' identifiers and SDK event tokens are removed.
The Report Service returns aggregated data. This server has no tool for user-level or device-level data.

Coverage is the Report Service JSON report, the app inventory from filters data and the event catalog. CSV, Parquet and pivot report formats are not exposed. Use `tools/list` or [server-card.json](server-card.json) for exact schemas and [the Report Service API reference](https://dev.adjust.com/en/api/rs-api/) for provider details.

## Official Adjust MCP server

Adjust offers its own MCP server. The facts below come from [Adjust's help center article](https://help.adjust.com/en/article/adjust-mcp/), read on October 23, 2026.

| | Adjust MCP | This server |
|---|---|---|
| Availability | Early Access, added to your Adjust package on request | Open source under Apache 2.0 |
| Connection | Remote endpoint `https://mcp.adjust.com/mcpo` | Local process over stdio |
| Authentication | OAuth in supported clients | Adjust API token in an environment variable |
| Data | Aggregated data only | Aggregated Report Service data only |

This server reads only the apps listed in `ADJUST_APP_TOKENS`, within the access of the Adjust user who owns the API token.

## Hosted option

[getmcpads for Adjust](https://www.getmcpads.com/tools/adjust) manages the hosted connection and app selection.
Hosted and source releases can differ. Contact: hello@getmcpads.com.

## Development

```bash
npm run typecheck
npm run lint
npm run build
npm test
npm run catalog
```

All tests run offline with synthetic responses. No live Adjust account is contacted.

## Tools

Every tool is listed below. See [server-card.json](server-card.json) for complete parameter and output schemas.

<details>
<summary><b>5 read tools</b></summary>

| Tool | Purpose |
| --- | --- |
| `adjust_list_apps` | List the allowlisted apps the API token can read, with native currency, configured operating systems and any configured token Adjust did not return |
| `adjust_list_events` | Discover event slugs, activity-count metric IDs and app-specific event tokens for one app |
| `adjust_get_catalog` | Read the 35 documented dimensions, 12 example metrics and the event metrics of one app |
| `adjust_run_report` | Run an attribution and performance report for one app, with native totals, warnings and measurement settings |
| `adjust_compare_periods` | Compare two equal-length periods for one app with identical settings, using native totals |

</details>

There are no write tools.

### Resource

| Resource | Purpose |
| --- | --- |
| `adjust://guide` | Tool order, app scope, measurement settings, rate limits and documentation link |

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

## More from getmcpads

[Meta Ads](https://github.com/get-mcp-ads/meta-ads-mcp-server) · [Google Ads](https://github.com/get-mcp-ads/google-ads-mcp-server) · [Google Analytics 4](https://github.com/get-mcp-ads/google-analytics-mcp-server) · [Google Search Console](https://github.com/get-mcp-ads/google-search-console-mcp-server) · [TikTok Ads](https://github.com/get-mcp-ads/tiktok-ads-mcp-server) · [Pinterest Ads](https://github.com/get-mcp-ads/pinterest-ads-mcp-server) · [X Ads](https://github.com/get-mcp-ads/x-ads-mcp-server)

Maintained by **Emmanuel** at [getmcpads](https://www.getmcpads.com). Questions: [hello@getmcpads.com](mailto:hello@getmcpads.com).
