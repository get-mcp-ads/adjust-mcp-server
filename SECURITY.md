# Security Policy

This server holds an Adjust API token that can read the reporting data of the
Adjust user who owns it. We take reports seriously.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on this repository:
[Report a vulnerability](https://github.com/get-mcp-ads/adjust-mcp-server/security/advisories/new),
or write to hello@getmcpads.com. Do not include live tokens or customer data.

We aim to acknowledge a report within 3 business days and to ship a fix or a
documented mitigation within 30 days. We will credit you in the advisory unless
you ask us not to.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## What this server does with your token

- The API token is read once from `ADJUST_API_TOKEN` at startup and kept in
  memory. It is never written to disk, logged or returned by a tool.
- **One host is contacted**: `automate.adjust.com`, the Report Service host.
  The allowed host is declared once in `src/core/hosts.ts` and checked before
  the token is attached. *A test fails the build if another host appears in
  the source.*
- **No request follows a redirect.** Requests use `redirect: "manual"` and a
  3xx response is refused without reading its Location header, so a redirect
  cannot forward your token. *A test fails the build if a fetch omits this.*
- The token is sent only in the `Authorization` header, never in a URL. A
  reporting parameter that contains the token is refused.
- Provider text, such as warnings and app names, is scrubbed of the token and
  of any `Bearer` value before it reaches the model.
- Every request has a 25 second timeout and a 20 MB response limit.
- The server never fetches a URL returned by the API. The Report Service
  answers with JSON directly.
- No telemetry, no analytics, no phone-home.

## Application scope

`ADJUST_APP_TOKENS` is the account boundary. Each tool call is checked against
it before any request, app discovery is filtered to it, and a report containing
a row from another app is withheld. Event definitions shared between apps keep
only the selected app: other app identifiers and SDK event tokens are removed.

## Personal data

The Report Service returns aggregated reporting data. This server exposes no
tool for user-level or device-level data.

## Read-only

There are no write tools and no setting that adds one. Every request is an
HTTP GET.

## Handling your token safely

- Use the token of an Adjust user whose access matches what the assistant
  should read.
- Treat the token like a password: it is a bearer credential.
- Your MCP client config file is usually plain text on disk. Check its
  permissions, and never commit it.
- Rotate the token if you suspect exposure, then restart the server.

## Scope

Vulnerabilities in the Adjust API itself are not in scope here; report those
to Adjust.
