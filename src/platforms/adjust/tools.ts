/**
 * adjust-mcp-server: an open-source MCP server for the Adjust Report Service API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { z, ZodError } from "zod";
import { ADJUST_DOCS } from "../../core/hosts.js";
import type { ToolShape } from "../../tool-quality.js";
import { ADJUST_DIMENSIONS, ADJUST_OS_NAMES, ADJUST_RATE_LIMIT, ADJUST_STANDARD_METRICS } from "./catalog.js";
import { AdjustClient, AdjustError, APP_TOKEN_PATTERN, type AdjustEnvironment, type AdjustReportQuery } from "./client.js";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export type Collector = {
  tool(name: string, description: string, shape: ToolShape, handler: (args: Record<string, unknown>) => Promise<ToolResult>): void;
  resource?(name: string, uri: string, description: string, read: () => Promise<{ contents: { uri: string; mimeType: string; text: string }[] }>): void;
};
export type AdjustToolConfig = { apiToken: string; allowedAppTokens: string[]; environment: AdjustEnvironment };

const appToken = z.string().regex(APP_TOKEN_PATTERN).describe("Exact Adjust application token from ADJUST_APP_TOKENS. Applications are separate from advertising accounts.");
// Factories, not shared instances: a shared instance becomes a JSON Schema $ref that some clients cannot resolve.
const slug = () => z.string().regex(/^[A-Za-z][A-Za-z0-9_ ]*$/).max(120).refine(value => value.trim() === value, "Preserve exact native slugs without leading or trailing spaces.");
const date = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Use a real calendar date.");
const filter = z.object({
  field: slug().describe("A documented dimension, or a metric requested in this report. app_token cannot be filtered."),
  operator: z.enum(["in", "not_in", "contains", "exclude", "lt", "lte", "gt", "gte", "eq", "ne"]).describe("Dimensions accept in, not_in, contains, exclude, eq and ne. Metrics accept eq, ne, lt, lte, gt and gte."),
  value: z.union([z.string().max(500), z.number().finite(), z.array(z.string().max(500)).min(1).max(100)]).describe("One value, or a list for in and not_in. Values must not contain commas."),
}).strict();

export const ADJUST_REPORT_SHAPE = {
  appToken, startDate: date(), endDate: date(),
  dimensions: z.array(z.enum(ADJUST_DIMENSIONS)).min(1).max(12).default(["os_name", "day", "network", "campaign_id_network", "campaign_network"]),
  metrics: z.array(slug()).min(1).max(30).default(["installs", "clicks", "impressions"]),
  currency: z.string().regex(/^[A-Z]{3}$/).optional().describe("Explicit ISO currency for money metrics. Keep the same currency across comparisons."),
  utcOffset: z.string().default("+00:00").describe("Fixed UTC offset; +00:00 by default. Split local-date comparisons if the offset changes during the period."),
  attributionSource: z.enum(["first", "dynamic"]).default("dynamic").describe("Assign activity to the first install source or the native dynamic reattribution source."),
  attributionTypes: z.array(z.enum(["click", "impression", "engaged_ad"])).min(1).max(3).optional().describe("Optional engagement filter. Omit for an unfiltered report including native organic data. Empty types in output means no engagement filter."),
  reattributed: z.enum(["all", "true", "false"]).default("all").describe("Include all users, reattributed users only, or users without reattribution."),
  adSpendMode: z.enum(["adjust", "network", "mixed"]).default("network").describe("Native source of ad spend. Keep the same mode across comparisons and avoid counting overlapping spend twice."),
  cohortMaturity: z.enum(["mature", "immature"]).default("immature").describe("Include current cohort values or use mature-only mode, which may zero immature cohorts."),
  osNames: z.array(z.enum(ADJUST_OS_NAMES)).min(1).max(ADJUST_OS_NAMES.length).optional().describe("Operating system filter, for example ios or android. Keep os_name in dimensions to compare platforms."),
  iapRevenueMode: z.enum(["GROSS_100", "GROSS_85", "GROSS_70", "GROSS_60"]).default("GROSS_100").describe("In-app revenue percentage. Retain the same setting across comparisons."),
  filters: z.array(filter).max(20).optional(),
  limit: z.number().int().min(1).max(10000).default(1000).describe("Display row limit only; truncation is explicit and native totals are preserved."),
};

const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

/** Errors reach the model as data: a fixed message, the HTTP status and any Retry-After delay. */
function failure(error: unknown, redact: (text: string) => string): ToolResult {
  let body: Record<string, unknown>;
  if (error instanceof AdjustError) {
    body = { error: error.message, status: error.status, ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}) };
  } else if (error instanceof ZodError) {
    body = { error: "Invalid arguments.", issues: error.issues.map(issue => `${issue.path.join(".") || "arguments"}: ${issue.message}`) };
  } else {
    body = { error: error instanceof Error ? error.message : "The Adjust read failed." };
  }
  return { isError: true, content: [{ type: "text", text: redact(JSON.stringify(body)) }] };
}

const GUIDE = [
  "Adjust reporting, read only. This server has no write tool and no setting that adds one.",
  "1. adjust_list_apps lists the applications in ADJUST_APP_TOKENS that the API token can read, with native currency and configured operating systems.",
  "2. adjust_list_events or adjust_get_catalog shows an application's event metrics. Use an event's activityMetric as the metric ID for its count.",
  "3. adjust_run_report reads one application. adjust_compare_periods compares two equal-length periods with identical settings.",
  "Only applications in ADJUST_APP_TOKENS are accessible, and rows from any other application withhold the whole report.",
  "Keep currency, utcOffset, attribution, ad spend mode, cohort maturity and in-app revenue mode identical across comparisons.",
  "Use the native totals. Do not sum breakdown rows, and treat a missing value as unknown, not zero. ROAS and ROI are fractions: 0.4 means 40%.",
  "Do not add Adjust-attributed results to overlapping ad platform conversions, SKAdNetwork results or spend.",
  ADJUST_RATE_LIMIT,
  `Documentation: ${ADJUST_DOCS}`,
].join("\n");

/** Registers the five Adjust reads. The application scope and the environment are fixed per configuration. */
export function registerAdjustReads(collector: Collector, config: AdjustToolConfig): void {
  if (!Array.isArray(config.allowedAppTokens) || !config.allowedAppTokens.length || !["sandbox", "production"].includes(config.environment)) {
    throw new Error("Adjust requires explicit allowed application tokens and an environment.");
  }
  const allowed = Object.freeze([...new Set(config.allowedAppTokens)]);
  const environment = config.environment;
  const client = new AdjustClient(config.apiToken, { allowedAppTokens: allowed, environment });
  const redact = (text: string) => client.redact(text);
  const register = (name: string, description: string, shape: ToolShape, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
    // Strict: an unknown argument such as an environment or host override is rejected, never ignored.
    const schema = z.object(shape).strict();
    collector.tool(name, description, shape, async args => {
      try { return ok(await handler(schema.parse(args ?? {}))); }
      catch (error) { return failure(error, redact); }
    });
  };

  register("adjust_list_apps", "List the Adjust applications in ADJUST_APP_TOKENS that this API token can read, with native currency and configured operating systems. Applications outside the allowlist are never returned.", {}, async () => {
    const apps = await client.apps();
    const unavailableAppTokens = allowed.filter(token => !apps.some(app => app.id === token));
    return { apps, environment, unavailableAppTokens,
      ...(unavailableAppTokens.length ? { notes: ["Adjust did not return these configured application tokens for this API token. Check the tokens and this user's application access."] } : {}) };
  });

  register("adjust_list_events", "Discover native event base slugs, ordinary activity-count metric IDs and app-specific event tokens for one allowlisted Adjust app. Use activityMetric for counts; the event base slug alone is not a report metric. Keep SKAdNetwork and aggregate revenue definitions separate.", {
    appToken,
    search: z.string().trim().min(1).max(120).optional().describe("Filter native event definitions by a short search term."),
  }, async args => ({ appToken: args.appToken, events: await client.events(String(args.appToken), args.search as string | undefined) }));

  register("adjust_get_catalog", "Read documented standard Adjust dimensions and example metrics, plus event metrics scoped to one allowlisted application. Metrics and spend/revenue access remain subject to Adjust permissions; the standard metric list is not exhaustive.", { appToken }, async args => ({
    appToken: args.appToken, environment, dimensions: ADJUST_DIMENSIONS, exampleMetrics: ADJUST_STANDARD_METRICS,
    eventMetrics: await client.events(String(args.appToken)), documentation: ADJUST_DOCS,
    workflows: { listEvents: "adjust_list_events", runReport: "adjust_run_report", comparePeriods: "adjust_compare_periods" },
    notes: ["Use an event's activityMetric for its ordinary activity count; a base event slug alone is not a metric ID.", "Use revenue for total in-app revenue and all_revenue for combined in-app and ad revenue; always set currency.", "ROAS and ROI are native fractions: 0.4 means 40%.", "Native event slugs depend on the application.", "Standard metrics are examples, not a guarantee of account access.", "Do not add Adjust-attributed results to overlapping platform conversions.", "Spend present in Adjust and an ad platform must not be counted twice.", ADJUST_RATE_LIMIT],
  }));

  register("adjust_run_report", "Read an attribution/performance report for one allowlisted Adjust app. Preserves native totals, warnings, attribution options, currency and UTC offset. Missing metrics are null; ratios are native fractions. A truncated or partial result is not a complete extraction.", ADJUST_REPORT_SHAPE, async args => client.report(args as AdjustReportQuery));

  register("adjust_compare_periods", "Compare two equal-length periods for one allowlisted Adjust application with identical metrics, filters, OS and measurement settings. Defaults to the immediately preceding period. Changes use native totals, never sums of breakdowns. Unavailable or partial values have no calculated change; cohort maturity and reporting delays still apply.", {
    ...ADJUST_REPORT_SHAPE,
    comparison: z.object({ startDate: date().describe("First date of the comparison period, in YYYY-MM-DD format."), endDate: date().describe("Last date of the comparison period, in YYYY-MM-DD format.") }).strict().optional().describe("Optional equal-length comparison period; otherwise use the immediately preceding period."),
  }, async args => {
    const { comparison: requested, ...query } = args;
    const days = (Date.parse(String(args.endDate)) - Date.parse(String(args.startDate))) / 86400000 + 1;
    if (!Number.isInteger(days) || days < 1) throw new AdjustError(400, "Choose a valid period.");
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const comparison = requested as { startDate: string; endDate: string } | undefined ?? {
      startDate: iso(Date.parse(String(args.startDate)) - days * 86400000),
      endDate: iso(Date.parse(String(args.startDate)) - 86400000),
    };
    if ((Date.parse(comparison.endDate) - Date.parse(comparison.startDate)) / 86400000 + 1 !== days) {
      throw new AdjustError(400, "Use equal-length current and comparison periods.");
    }
    const [currentReport, previousReport] = await Promise.all([
      client.report(query as AdjustReportQuery), client.report({ ...query, ...comparison } as AdjustReportQuery),
    ]);
    const complete = !currentReport.partial && !previousReport.partial;
    const changes = Object.fromEntries(currentReport.metrics.map(metric => {
      const current = currentReport.totals[metric], previous = previousReport.totals[metric];
      const absolute = complete && current !== null && previous !== null ? current - previous : null;
      return [metric, { current, previous, absolute, relativePercent: absolute === null || previous === 0 ? null : absolute / Math.abs(previous!) * 100 }];
    }));
    return { currentReport, previousReport, changes, complete, notes: ["Native ratios remain fractions; relativePercent is the percent change between those fractions.", "A zero comparison baseline has no defined percent change. Cohort maturity and recent reporting may change the comparison.", "Do not add overlapping attribution, SKAdNetwork results or ad-platform conversions."] };
  });

  collector.resource?.("adjust-guide", "adjust://guide", "How to read Adjust reports with this server: tool order, scope, measurement settings and rate limits.",
    async () => ({ contents: [{ uri: "adjust://guide", mimeType: "text/plain", text: GUIDE }] }));
}
