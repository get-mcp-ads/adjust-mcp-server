/**
 * adjust-mcp-server: an open-source MCP server for the Adjust Report Service API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adjust Report Service transport. Fixed origin, GET only, no token in URLs or
 * diagnostics, every request scoped to one allowlisted application.
 */
import { ADJUST_API_ORIGIN, assertAllowedApiUrl } from "../../core/hosts.js";
import { isRedirect, NO_REDIRECT } from "../../core/redirects.js";
import { ADJUST_DIMENSIONS, ADJUST_OS_NAMES } from "./catalog.js";

export class AdjustError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "AdjustError";
  }
}

export type AdjustEnvironment = "sandbox" | "production";
export type AdjustApp = { id: string; name: string; currency?: string; osNames?: string[] };
export type AdjustEvent = {
  id: string; name: string; section: string; formatting: string | null;
  app_token: string[]; tokens: string[]; is_skad_event: boolean;
  /** Ordinary activity count ID; the event base slug itself is not a report metric. */
  activityMetric: string | null;
};
export type AdjustFilter = {
  field: string; operator: "in" | "not_in" | "contains" | "exclude" | "lt" | "lte" | "gt" | "gte" | "eq" | "ne";
  value: string | number | string[];
};
export type AdjustReportQuery = {
  appToken: string; startDate: string; endDate: string; dimensions: string[]; metrics: string[];
  environment?: AdjustEnvironment; currency?: string; utcOffset?: string;
  attributionSource?: "first" | "dynamic"; attributionTypes?: ("click" | "impression" | "engaged_ad")[];
  reattributed?: "all" | "true" | "false"; adSpendMode?: "adjust" | "network" | "mixed";
  cohortMaturity?: "mature" | "immature"; filters?: AdjustFilter[]; limit?: number;
  osNames?: (typeof ADJUST_OS_NAMES)[number][]; iapRevenueMode?: "GROSS_100" | "GROSS_85" | "GROSS_70" | "GROSS_60";
};
export type AdjustReport = {
  appToken: string; environment: AdjustEnvironment; dateRange: { start: string; end: string };
  dimensions: string[]; metrics: string[]; currency: string | null; utcOffset: string;
  attribution: { source: "first" | "dynamic"; types: string[]; reattributed: string; adSpendMode: string; cohortMaturity: string; iapRevenueMode: string };
  osNames: string[]; filters: AdjustFilter[];
  rows: Record<string, string | number | null>[]; totals: Record<string, number | null>;
  warnings: string[]; partial: boolean; totalRows: number; truncated: boolean;
};
export type AdjustClientOptions = {
  /** Exact application tokens this client may read. Required: there is no unscoped mode. */
  allowedAppTokens: readonly string[];
  environment?: AdjustEnvironment;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
};

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;
/** Longer provider delays go back to the caller instead of holding the request open. */
const MAX_INLINE_RETRY_SECONDS = 5;

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
// Native event slugs can include spaces (for example, "general revenue").
const metricIdentifier = /^[A-Za-z][A-Za-z0-9_ ]*$/;
export const APP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const scalar = (value: unknown): string | number | null =>
  typeof value === "string" || typeof value === "number" && Number.isFinite(value) ? value : null;
const number = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number" || typeof value === "string" && !value.trim()) return null;
  if (typeof value === "string" && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const calendarDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const enums = <T extends string>(value: T | undefined, allowed: readonly T[], fallback: T): T => {
  if (value !== undefined && !allowed.includes(value)) throw new AdjustError(400, "Unsupported Adjust reporting option.");
  return value ?? fallback;
};
const MONEY_METRICS = ["cost", "network_cost", "network_ecpi", "revenue", "all_revenue", "cohort_revenue"];

export class AdjustClient {
  private readonly allowedAppTokens: readonly string[];
  private readonly configuredEnvironment: AdjustEnvironment;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;

  constructor(private readonly token: string, options: AdjustClientOptions) {
    if (!token || token.length > 4096 || /\s/.test(token)) throw new AdjustError(401, "Enter a valid Adjust API token.");
    if (!options || !Array.isArray(options.allowedAppTokens)) throw new AdjustError(400, "Configure the allowed Adjust application tokens.");
    // Snapshot the scope so later mutations of the caller's arrays cannot widen access.
    this.allowedAppTokens = Object.freeze([...options.allowedAppTokens]);
    if (options.environment !== undefined && !["sandbox", "production"].includes(options.environment)) throw new AdjustError(400, "Choose the Adjust environment.");
    this.configuredEnvironment = options.environment ?? "production";
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 3) throw new AdjustError(400, "Use 1 to 3 read attempts.");
  }

  get environment(): AdjustEnvironment { return this.configuredEnvironment; }

  private requireApp(appToken: string) {
    if (typeof appToken !== "string" || !APP_TOKEN_PATTERN.test(appToken) || appToken === this.token) throw new AdjustError(400, "Use an exact Adjust application token, not an API credential.");
    if (!this.allowedAppTokens.includes(appToken)) {
      throw new AdjustError(403, "This Adjust application is not selected in ADJUST_APP_TOKENS.");
    }
  }

  private resolveEnvironment(requested?: AdjustEnvironment): AdjustEnvironment {
    const environment = enums(requested, ["sandbox", "production"], this.configuredEnvironment);
    if (environment !== this.configuredEnvironment) throw new AdjustError(403, "The requested environment differs from ADJUST_ENVIRONMENT.");
    return environment;
  }

  /** Provider text is untrusted and may echo a credential. Never retain token text. */
  redact(value: unknown): string {
    const text = typeof value === "string" ? value : "Adjust reported an unspecified warning.";
    return text.split(this.token).join("[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500);
  }

  private async request(path: "filters_data" | "events" | "report", params: URLSearchParams): Promise<unknown> {
    if ([...params].some(([key, value]) => key.includes(this.token) || value.includes(this.token))) throw new AdjustError(400, "An API credential must not be used as a reporting parameter.");
    const url = new URL(`/reports-service/${path}`, ADJUST_API_ORIGIN);
    url.search = params.toString();
    assertAllowedApiUrl(url);
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET", redirect: NO_REDIRECT,
          headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // A read is retryable, but do not amplify an unavailable upstream.
        throw new AdjustError(0, "Adjust could not be reached within the reporting timeout. Retry the read later.");
      }
      if (isRedirect(response)) {
        await response.body?.cancel().catch(() => undefined);
        throw new AdjustError(response.status, "Adjust returned an unexpected redirect. It was not followed and the API token was not forwarded.");
      }
      const retryHeader = response.headers.get("retry-after");
      const retrySeconds = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) : Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000)) : undefined;
      const validRetrySeconds = retrySeconds !== undefined && Number.isFinite(retrySeconds) && retrySeconds >= 0 ? retrySeconds : undefined;
      if ([429, 502, 503, 504].includes(response.status) && attempt < this.maxAttempts - 1) {
        await response.body?.cancel().catch(() => undefined);
        if (validRetrySeconds !== undefined && validRetrySeconds > MAX_INLINE_RETRY_SECONDS) {
          throw new AdjustError(response.status, "Adjust is temporarily limiting or delaying reporting. Retry later.", validRetrySeconds);
        }
        await this.sleep(Math.max((validRetrySeconds ?? 0) * 1000, 250 * 2 ** attempt + Math.floor(Math.random() * 100)));
        continue;
      }
      if (response.status === 204) return null;
      if (!response.ok) {
        const messages: Record<number, string> = {
          400: "Adjust rejected these report fields or options. Check the native metric slugs, dimensions and dates.",
          401: "The Adjust API token is invalid or revoked. Check ADJUST_API_TOKEN.",
          403: "This Adjust user cannot access the requested application or metrics. Check reporting, spend and revenue permissions.",
          404: "The Adjust reporting resource is unavailable.",
          429: "Adjust is limiting requests. Wait before retrying.",
          502: "Adjust reporting is temporarily unavailable.", 503: "Adjust reporting is temporarily unavailable.",
          504: "Adjust could not complete this query in time. Narrow the period or breakdown.",
        };
        await response.body?.cancel().catch(() => undefined);
        throw new AdjustError(response.status, messages[response.status] ?? "Adjust reporting failed. Retry the read later.", validRetrySeconds);
      }
      const body = await this.readBounded(response);
      let parsed: unknown;
      try { parsed = JSON.parse(body); }
      catch { throw new AdjustError(502, "Adjust returned an unreadable JSON response."); }
      const envelope = object(parsed);
      // Adjust can answer HTTP 200 with an error body. Treat it as a failure, never as data.
      if (envelope && (envelope.success === false || envelope.failed === true
        || envelope.error !== undefined && envelope.error !== null && envelope.error !== false && envelope.error !== ""
        || Array.isArray(envelope.errors) && envelope.errors.length > 0
        || envelope.error_code !== undefined && envelope.error_code !== null && envelope.error_code !== "" && envelope.error_code !== 0 && envelope.error_code !== "0")) {
        throw new AdjustError(502, "Adjust reported a failed request despite a successful HTTP status. No data was returned.");
      }
      return parsed;
    }
    throw new AdjustError(502, "Adjust reporting could not be completed.");
  }

  /** Read the body while counting bytes, so an oversized response cannot exhaust memory. */
  private async readBounded(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new AdjustError(502, "Adjust returned an unreadable report.");
    const decoder = new TextDecoder();
    let body = "", bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new AdjustError(413, "The Adjust report is too large. Narrow the dates, metrics or dimensions.");
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } catch (error) {
      if (error instanceof AdjustError) throw error;
      throw new AdjustError(502, "The Adjust response was interrupted. No complete report was returned.");
    }
    return body;
  }

  /** Applications visible to the token, filtered to the allowlist before anything is returned. */
  async apps(): Promise<AdjustApp[]> {
    if (this.allowedAppTokens.length === 0) return [];
    const payload = await this.request("filters_data", new URLSearchParams({ required_filters: "apps" }));
    if (payload === null) return [];
    const apps = object(payload)?.apps;
    if (!Array.isArray(apps)) throw new AdjustError(502, "Adjust did not return a valid application inventory.");
    const result: AdjustApp[] = [];
    for (const item of apps) {
      const app = object(item);
      if (!app || typeof app.id !== "string" || !APP_TOKEN_PATTERN.test(app.id) || typeof app.name !== "string") throw new AdjustError(502, "Adjust returned an invalid application entry.");
      if (!this.allowedAppTokens.includes(app.id)) continue;
      if (app.id === this.token) throw new AdjustError(502, "Adjust returned an invalid application identifier.");
      const currency = object(app.currency)?.code;
      const osNames = [...new Set(Object.values(object(app.stores) ?? {}).flatMap(value => {
        const store = object(value);
        return store?.configured === true && typeof store.platform === "string" && (ADJUST_OS_NAMES as readonly string[]).includes(store.platform) ? [store.platform] : [];
      }))];
      if (!result.some(value => value.id === app.id)) result.push({ id: app.id, name: this.redact(app.name),
        ...(typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? { currency } : {}),
        ...(osNames.length ? { osNames } : {}),
      });
    }
    return result;
  }

  async events(appToken: string, search?: string): Promise<AdjustEvent[]> {
    this.requireApp(appToken);
    if (search !== undefined && (!search.trim() || search.length > 120)) throw new AdjustError(400, "Use a short event search term.");
    const params = new URLSearchParams({ app_token__in: appToken, tokens_mapping: "true" });
    if (search) params.set("events__contains", search);
    const payload = await this.request("events", params);
    if (payload === null) return [];
    if (!Array.isArray(payload)) throw new AdjustError(502, "Adjust did not return a valid event catalog.");
    return payload.flatMap(item => {
      const event = object(item);
      if (!event || typeof event.id !== "string" || !metricIdentifier.test(event.id) || event.id.length > 120 || typeof event.name !== "string" || !Array.isArray(event.app_token)) throw new AdjustError(502, "Adjust returned invalid event metadata.");
      if (!event.app_token.includes(appToken)) return [];
      const mapping = object(event.app_token_x_event_tokens_mapping);
      // Never return the global tokens array: it can belong to other applications.
      const tokens = Array.isArray(mapping?.[appToken]) ? (mapping![appToken] as unknown[]).filter((value): value is string => typeof value === "string").map(value => this.redact(value)) : [];
      return [{ id: this.redact(event.id), name: this.redact(event.name), section: typeof event.section === "string" ? this.redact(event.section) : "events",
        formatting: typeof event.formatting === "string" ? this.redact(event.formatting) : null,
        app_token: [appToken], tokens, is_skad_event: event.is_skad_event === true,
        activityMetric: event.is_skad_event === true || event.id === "general revenue" ? null : `${event.id}_events` }];
    });
  }

  async report(input: AdjustReportQuery): Promise<AdjustReport> {
    this.requireApp(input.appToken);
    const environment = this.resolveEnvironment(input.environment);
    if (!calendarDate(input.startDate) || !calendarDate(input.endDate) || input.startDate > input.endDate) throw new AdjustError(400, "Choose real reporting dates in chronological order.");
    if (!Array.isArray(input.dimensions) || !input.dimensions.length || input.dimensions.length > 12 || input.dimensions.some(value => !(ADJUST_DIMENSIONS as readonly string[]).includes(value))) throw new AdjustError(400, "Choose 1 to 12 documented Adjust dimensions.");
    if (!Array.isArray(input.metrics) || !input.metrics.length || input.metrics.length > 30 || input.metrics.some(value => typeof value !== "string" || !metricIdentifier.test(value) || value.length > 120 || value.trim() !== value || (ADJUST_DIMENSIONS as readonly string[]).includes(value))) throw new AdjustError(400, "Choose 1 to 30 exact Adjust metric slugs, distinct from dimensions.");
    // app_token is always requested, so every returned row can be checked against the scope.
    const dimensions = [...new Set(["app_token", ...input.dimensions])], metrics = [...new Set(input.metrics)];
    const limit = input.limit ?? 1000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new AdjustError(400, "Choose a reporting row limit between 1 and 10,000.");
    const utcOffset = input.utcOffset ?? "+00:00";
    if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(utcOffset) || /^[-+]14:(?!00)/.test(utcOffset)) throw new AdjustError(400, "Use a fixed UTC offset between -14:00 and +14:00.");
    if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) throw new AdjustError(400, "Use a three-letter reporting currency.");
    const attribution = {
      source: enums(input.attributionSource, ["first", "dynamic"], "dynamic"),
      // Omit engagement filtering unless requested; organic data must remain visible.
      types: input.attributionTypes ?? [],
      reattributed: enums(input.reattributed, ["all", "true", "false"], "all"),
      adSpendMode: enums(input.adSpendMode, ["adjust", "network", "mixed"], "network"),
      cohortMaturity: enums(input.cohortMaturity, ["mature", "immature"], "immature"),
      iapRevenueMode: enums(input.iapRevenueMode, ["GROSS_100", "GROSS_85", "GROSS_70", "GROSS_60"], "GROSS_100"),
    };
    if (input.osNames !== undefined && (!Array.isArray(input.osNames) || !input.osNames.length || input.osNames.length > ADJUST_OS_NAMES.length || input.osNames.some(value => !(ADJUST_OS_NAMES as readonly string[]).includes(value)))) throw new AdjustError(400, "Choose documented operating system names.");
    const osNames = [...new Set(input.osNames ?? [])];
    if (input.attributionTypes !== undefined && !attribution.types.length || attribution.types.some(value => !["click", "impression", "engaged_ad"].includes(value))) throw new AdjustError(400, "Choose supported attribution engagement types.");
    const params = new URLSearchParams({ app_token__in: input.appToken, date_period: `${input.startDate}:${input.endDate}`,
      dimensions: dimensions.join(","), metrics: metrics.join(","), format_dates: "false", utc_offset: utcOffset,
      sandbox: String(environment === "sandbox"), attribution_source: attribution.source, reattributed: attribution.reattributed,
      ad_spend_mode: attribution.adSpendMode, cohort_maturity: attribution.cohortMaturity, iap_revenue_mode: attribution.iapRevenueMode });
    if (input.currency) params.set("currency", input.currency);
    if (osNames.length) params.set("os_names", osNames.join(","));
    if (attribution.types.length) params.set("attribution_types", [...new Set(attribution.types)].join(","));
    if ((input.filters?.length ?? 0) > 20) throw new AdjustError(400, "Use at most 20 report filters.");
    for (const filter of input.filters ?? []) {
      const dimension = (ADJUST_DIMENSIONS as readonly string[]).includes(filter.field) && filter.field !== "app_token";
      const metric = metrics.includes(filter.field);
      if (filter.field === "app_token" || !dimension && !metric) throw new AdjustError(400, "Filters must name a requested metric or documented dimension, without changing the application scope.");
      let operator = filter.operator;
      if (operator === "eq" || operator === "ne") operator = dimension ? operator === "eq" ? "in" : "not_in" : operator;
      if (dimension && !["in", "not_in", "contains", "exclude"].includes(operator) || metric && !dimension && !["eq", "ne", "lt", "lte", "gt", "gte"].includes(operator)) throw new AdjustError(400, "This filter operator does not match the field type.");
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      if (!values.length || values.length > 100 || values.some(value => typeof value !== "string" && typeof value !== "number" || typeof value === "number" && !Number.isFinite(value) || !String(value).trim() || String(value).length > 500 || String(value).includes(","))) throw new AdjustError(400, "Use individual bounded filter values without comma separators.");
      if (!["in", "not_in"].includes(operator) && values.length !== 1 || metric && !dimension && !Number.isFinite(Number(values[0]))) throw new AdjustError(400, "Use one numeric value for a metric filter.");
      const key = `${filter.field}__${operator}`;
      if (params.has(key)) throw new AdjustError(400, "Duplicate filter keys are ambiguous.");
      params.set(key, values.join(","));
    }
    const raw = await this.request("report", params);
    const payload = raw === null ? { rows: [], totals: {}, warnings: [] } : object(raw);
    if (!payload || !Array.isArray(payload.rows) || !object(payload.totals) || [payload.warnings, payload.data_warnings].some(v => v !== undefined && !Array.isArray(v))) throw new AdjustError(502, "Adjust did not return a valid report with rows and totals.");
    const warnings = [...(payload.warnings as unknown[] | undefined ?? []), ...(payload.data_warnings as unknown[] | undefined ?? [])].map(value => this.redact(value));
    const identities = new Set<string>();
    const normalized = payload.rows.map(value => {
      const row = object(value);
      if (!row || row.app_token !== input.appToken) throw new AdjustError(502, "Adjust returned rows outside the requested application scope. The report was withheld.");
      const result: Record<string, string | number | null> = {};
      for (const dimension of dimensions) {
        const value = scalar(row[dimension]);
        result[dimension] = typeof value === "string" ? this.redact(value) : value;
        if (value === null) warnings.push(`Dimension ${dimension} is unavailable in one or more rows.`);
      }
      const identity = JSON.stringify(dimensions.map(dimension => result[dimension]));
      if (identities.has(identity)) warnings.push("Adjust returned duplicate breakdown identities. Do not merge or sum these rows without resolving the missing grain.");
      identities.add(identity);
      for (const metric of metrics) {
        result[metric] = number(row[metric]);
        if (result[metric] === null) warnings.push(`Metric ${metric} is missing or non-numeric in one or more rows; missing data is not zero.`);
      }
      return result;
    });
    // Totals come from Adjust. They are never reconstructed from breakdown rows.
    const totals = Object.fromEntries(metrics.map(metric => [metric, number(object(payload.totals)![metric])])) as Record<string, number | null>;
    if (normalized.length && Object.values(totals).some(value => value === null)) warnings.push("One or more requested report totals are unavailable; they are not reconstructed from breakdown rows.");
    if (!input.currency && metrics.some(metric => MONEY_METRICS.includes(metric) || /_revenue(?:_cohort|_per_period)?$/.test(metric))) warnings.push("The reporting currency is not explicit for money metrics. Set currency before comparing sources.");
    const truncated = normalized.length > limit;
    if (truncated) warnings.push("The displayed rows are truncated; the provider totals retain their original scope.");
    // The Report Service documents no pagination. Unknown pagination metadata means rows may be missing.
    if (payload.pagination !== undefined && payload.pagination !== null) warnings.push("Adjust returned pagination metadata without a verified pagination contract. The extraction is incomplete.");
    const partial = truncated || warnings.length > 0;
    if (attribution.cohortMaturity === "mature") warnings.push("Adjust can return zero for immature cohorts in mature mode. Cohort maturity must be considered before interpreting a zero.");
    return { appToken: input.appToken, environment, dateRange: { start: input.startDate, end: input.endDate }, dimensions, metrics,
      currency: input.currency ?? null, utcOffset, attribution, osNames, filters: structuredClone(input.filters ?? []), rows: normalized.slice(0, limit), totals,
      warnings: [...new Set(warnings)], partial, totalRows: normalized.length, truncated };
  }
}
