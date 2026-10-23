/**
 * adjust-mcp-server: an open-source MCP server for the Adjust Report Service API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Never forward the API token through an HTTP redirect. Requests use
 * `redirect: "manual"`, so a redirect comes back as a response that the caller
 * refuses instead of a request to the host the Location header names.
 */
export const NO_REDIRECT = "manual" as const;

/** True for a 3xx response or an opaque redirect. The Location header is never read. */
export function isRedirect(response: Response): boolean {
  return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
}
