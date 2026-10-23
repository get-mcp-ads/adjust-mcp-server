/**
 * adjust-mcp-server: an open-source MCP server for the Adjust Report Service API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */

/** Documented Report Service dimensions accepted by adjust_run_report. */
export const ADJUST_DIMENSIONS = [
  "hour", "day", "week", "month", "year", "quarter", "app", "app_token",
  "network", "partner", "partner_name", "partner_id", "channel", "platform",
  "os_name", "device_type", "country", "country_code", "region", "ad_account_id",
  "store_id", "store_type", "currency", "currency_code", "campaign", "campaign_network",
  "campaign_id_network", "adgroup", "adgroup_network", "adgroup_id_network", "creative",
  "creative_network", "creative_id_network", "source_network", "source_id_network",
] as const;

/** Example standard metrics. Not exhaustive: event metrics come from adjust_list_events. */
export const ADJUST_STANDARD_METRICS = [
  "installs", "clicks", "impressions", "sessions", "events", "revenue_events",
  "revenue", "all_revenue", "cost", "network_installs", "network_cost", "network_ecpi",
] as const;

export const ADJUST_OS_NAMES = [
  "android", "bada", "blackberry", "ios", "linux", "macos", "server", "symbian",
  "unknown", "webos", "windows", "windows-phone",
] as const;

export const ADJUST_RATE_LIMIT =
  "Adjust Report Service permits 50 requests per second per source IP address, with a burst allowance of 100. Clients behind the same NAT or proxy share this limit. HTTP 429 means wait before retrying.";
