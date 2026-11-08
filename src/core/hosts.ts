/**
 * adjust-mcp-server: an open-source MCP server for the Adjust Report Service API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The only origin this server sends a request to. Adjust documents the Report
 * Service endpoints (report, filters_data, events) on this host. Every request
 * URL is checked against it before the API token is attached.
 */
export const ADJUST_API_ORIGIN = "https://automate.adjust.com";
export const ALLOWED_API_HOSTS: readonly string[] = ["automate.adjust.com"];

/** Documentation links returned to the model. These hosts are never requested. */
export const ADJUST_DOCS = "https://dev.adjust.com/en/api/rs-api/";

export function assertAllowedApiUrl(url: URL): void {
  if (url.protocol !== "https:" || !ALLOWED_API_HOSTS.includes(url.hostname) || url.port !== "" || url.username || url.password) {
    throw new Error("Refusing a request outside the documented Adjust Report Service host.");
  }
}
