/**
 * Ported from the getmcpads gateway tests for Adjust (apps/mcp/test/adjust.test.ts,
 * adjust-mcp.test.ts and adjust-v1.test.ts at revision 3e1c2c8). Every provider
 * response is synthetic: fetch is stubbed and no request leaves the machine.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdjustClient, AdjustError, type AdjustReportQuery } from "../../src/platforms/adjust/client.js";
import { registerAdjustReads } from "../../src/platforms/adjust/tools.js";
import { collect, data } from "./catalogue.js";

const token = "adjust-test-secret-never-return";
const query: AdjustReportQuery = { appToken: "pilot-app", startDate: "2026-10-01", endDate: "2026-10-07", dimensions: ["day", "network"], metrics: ["installs", "purchase", "roas"] };
const payload = () => ({
  rows: [
    { app_token: "pilot-app", day: "2026-10-01", network: "Network A", installs: "4", purchase: "2", roas: "0.4" },
    { app_token: "pilot-app", day: "2026-10-02", network: "Network A", installs: "8", purchase: "3", roas: "0.8" },
  ],
  // Deliberately not the mean of row ROAS: only the provider knows its full denominator.
  totals: { installs: 12, purchase: 5, roas: 0.7 }, warnings: [] as unknown[], pagination: null as unknown,
});
type Fetcher = ReturnType<typeof vi.fn>;
function client(fetcher: Fetcher, options: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", fetcher);
  return new AdjustClient(token, { allowedAppTokens: ["pilot-app"], environment: "sandbox", sleep: async () => {}, ...options });
}
const urlOf = (fetcher: Fetcher, call = 0) => new URL(String(fetcher.mock.calls[call][0]));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("application allowlist and environment isolation", () => {
  it("refuses an application outside ADJUST_APP_TOKENS before any provider call", async () => {
    const fetcher = vi.fn();
    await expect(client(fetcher).report({ ...query, appToken: "other-client" })).rejects.toMatchObject({ status: 403 });
    await expect(client(fetcher).events("other-client")).rejects.toMatchObject({ status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not normalize opaque application IDs or allow lists in an ID", async () => {
    const fetcher = vi.fn();
    await expect(client(fetcher).report({ ...query, appToken: "pilotapp" })).rejects.toMatchObject({ status: 403 });
    await expect(client(fetcher).report({ ...query, appToken: "pilot-app,other-client" })).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("snapshots scopes so later configuration mutations cannot expand or switch access", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const options = { allowedAppTokens: ["pilot-app"], environment: "sandbox" as "sandbox" | "production" };
    const api = new AdjustClient(token, options);
    options.allowedAppTokens.push("other-client"); options.environment = "production";
    await expect(api.report({ ...query, appToken: "other-client" })).rejects.toMatchObject({ status: 403 });
    await expect(api.report({ ...query, environment: "production" })).rejects.toMatchObject({ status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses production requests through a sandbox configuration", async () => {
    const fetcher = vi.fn();
    await expect(client(fetcher).report({ ...query, environment: "production" })).rejects.toMatchObject({ status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses an API token used as an application token, event search or filter value", async () => {
    const fetcher = vi.fn();
    await expect(client(fetcher, { allowedAppTokens: [token] }).events(token)).rejects.toMatchObject({ status: 400 });
    await expect(client(fetcher).events("pilot-app", token)).rejects.toMatchObject({ status: 400 });
    await expect(client(fetcher).report({ ...query, filters: [{ field: "campaign_network", operator: "contains", value: token }] })).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("withholds a report when the provider returns another application's row", async () => {
    const response = payload(); response.rows[1].app_token = "other-client";
    const fetcher = vi.fn().mockResolvedValue(Response.json(response));
    await expect(client(fetcher).report(query)).rejects.toMatchObject({ status: 502 });
  });
  it("returns no inventory and makes no call when nothing is allowed", async () => {
    const fetcher = vi.fn();
    expect(await client(fetcher, { allowedAppTokens: [] }).apps()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("limits discovered applications to the exact allowlisted IDs", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ apps: [{ id: "pilot-app", name: "Pilot" }, { id: "other-client", name: "Private customer" }] }));
    expect(await client(fetcher).apps()).toEqual([{ id: "pilot-app", name: "Pilot" }]);
    expect(urlOf(fetcher).searchParams.get("required_filters")).toBe("apps");
  });
  it("discovers native currency and only configured OS platforms", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ apps: [
      { id: "pilot-app", name: "Mobile app", currency: { code: "EUR" }, stores: { apple: { configured: true, platform: "ios" }, google: { configured: true, platform: "android" }, huawei: { configured: false, platform: "android" } } },
      { id: "other-client", name: "Private", currency: { code: "USD" } },
    ] }));
    expect(await client(fetcher).apps()).toEqual([{ id: "pilot-app", name: "Mobile app", currency: "EUR", osNames: ["ios", "android"] }]);
  });
  it("removes other application IDs and SDK event tokens from shared event definitions", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([
      { id: "purchase", name: "Purchase", section: "Revenue", formatting: "money", app_token: ["pilot-app", "other-client"], tokens: ["own-sdk-token", "hidden-sdk-token"], app_token_x_event_tokens_mapping: { "pilot-app": ["own-sdk-token"], "other-client": ["hidden-sdk-token"] } },
      { id: "private_event", name: "Private event", app_token: ["other-client"] },
    ]));
    const events = await client(fetcher).events("pilot-app", "purchase");
    expect(events).toEqual([{ id: "purchase", name: "Purchase", section: "Revenue", formatting: "money", app_token: ["pilot-app"], tokens: ["own-sdk-token"], is_skad_event: false, activityMetric: "purchase_events" }]);
    expect(JSON.stringify(events)).not.toMatch(/other-client|hidden-sdk-token|private_event/);
    const url = urlOf(fetcher);
    expect(url.origin + url.pathname).toBe("https://automate.adjust.com/reports-service/events");
    expect(url.searchParams.get("app_token__in")).toBe("pilot-app");
    expect(url.searchParams.get("tokens_mapping")).toBe("true");
    expect(url.searchParams.get("events__contains")).toBe("purchase");
  });
  it("does not expose global SDK tokens when per-app mapping is absent", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ id: "purchase", name: "Purchase", app_token: ["pilot-app"], tokens: ["uncertain-token"] }]));
    expect((await client(fetcher).events("pilot-app"))[0].tokens).toEqual([]);
  });
  it("keeps the native general revenue entry and SKAdNetwork events without a count metric", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([
      { id: "general revenue", name: "General Revenue", app_token: ["pilot-app"], app_token_x_event_tokens_mapping: { "pilot-app": ["0"] } },
      { id: "qa_purchase", name: "qa_purchase", app_token: ["pilot-app"], app_token_x_event_tokens_mapping: { "pilot-app": ["buy123"] } },
      { id: "skad_conversion", name: "SKAd", app_token: ["pilot-app"], is_skad_event: true },
    ]));
    expect((await client(fetcher).events("pilot-app")).map(event => ({ id: event.id, activityMetric: event.activityMetric }))).toEqual([
      { id: "general revenue", activityMetric: null }, { id: "qa_purchase", activityMetric: "qa_purchase_events" }, { id: "skad_conversion", activityMetric: null },
    ]);
  });
  it("requires an allowlist and an environment in the tool configuration", () => {
    expect(() => registerAdjustReads({ tool() {} }, { apiToken: token } as never)).toThrow("explicit allowed application tokens");
    expect(() => registerAdjustReads({ tool() {} }, { apiToken: token, allowedAppTokens: [], environment: "production" })).toThrow("explicit allowed application tokens");
  });
});

describe("report semantics", () => {
  it("keeps iOS and Android at a distinct grain while retaining native cross-OS totals", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ rows: [
      { app_token: "pilot-app", day: "2026-10-01", os_name: "ios", installs: "1" },
      { app_token: "pilot-app", day: "2026-10-01", os_name: "android", installs: "2" },
    ], totals: { installs: 3 }, warnings: [] }));
    const result = await client(fetcher).report({ ...query, dimensions: ["os_name", "day"], metrics: ["installs"], osNames: ["ios", "android"], iapRevenueMode: "GROSS_70" });
    expect(result.rows.map(row => row.os_name)).toEqual(["ios", "android"]);
    expect(result).toMatchObject({ totals: { installs: 3 }, partial: false, osNames: ["ios", "android"], attribution: { iapRevenueMode: "GROSS_70" } });
    const params = urlOf(fetcher).searchParams;
    expect(params.get("os_names")).toBe("ios,android"); expect(params.get("iap_revenue_mode")).toBe("GROSS_70");
  });
  it.each([{ osNames: [] }, { osNames: ["ios,android"] }, { osNames: ["not-an-os"] }])("refuses invalid OS filters before an API read: $osNames", async ({ osNames }) => {
    const fetcher = vi.fn();
    await expect(client(fetcher).report({ ...query, osNames } as AdjustReportQuery)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses only GET on the documented endpoint, with encoded parameters and explicit measurement options", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(payload()));
    const report = await client(fetcher).report({ ...query, currency: "EUR", utcOffset: "+01:00", attributionSource: "first", attributionTypes: ["click"], reattributed: "false", adSpendMode: "mixed" });
    const [url, init] = fetcher.mock.calls[0]; const params = new URL(String(url)).searchParams;
    expect(new URL(String(url)).origin).toBe("https://automate.adjust.com");
    expect(new URL(String(url)).pathname).toBe("/reports-service/report");
    expect(init).toMatchObject({ method: "GET", redirect: "manual", headers: { Authorization: `Bearer ${token}` } });
    expect(init.body).toBeUndefined(); expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(String(url)).not.toContain(token);
    expect(params.get("sandbox")).toBe("true"); expect(params.get("app_token__in")).toBe("pilot-app");
    expect(params.get("dimensions")).toBe("app_token,day,network"); expect(params.get("utc_offset")).toBe("+01:00");
    expect(params.get("currency")).toBe("EUR"); expect(params.get("attribution_source")).toBe("first");
    expect(params.get("attribution_types")).toBe("click"); expect(params.get("reattributed")).toBe("false");
    expect(params.get("ad_spend_mode")).toBe("mixed"); expect(params.has("limit")).toBe(false); expect(params.has("page")).toBe(false);
    expect(report.attribution).toMatchObject({ source: "first", types: ["click"], reattributed: "false", adSpendMode: "mixed" });
    expect(report.rows[0]).toMatchObject({ installs: 4, purchase: 2, roas: 0.4 });
    expect(report.totals.roas).toBe(0.7); expect(report.partial).toBe(false);
  });
  it("keeps production data explicit when no sandbox is configured", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(payload()));
    expect((await client(fetcher, { environment: "production" }).report(query)).environment).toBe("production");
    expect(urlOf(fetcher).searchParams.get("sandbox")).toBe("false");
    expect(urlOf(fetcher).searchParams.has("attribution_types")).toBe(false);
  });
  it("preserves native totals when only a bounded set of rows is displayed", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(payload()));
    const report = await client(fetcher).report({ ...query, limit: 1 });
    expect(report).toMatchObject({ rows: [{ installs: 4 }], totals: { installs: 12, roas: 0.7 }, totalRows: 2, partial: true, truncated: true });
  });
  it("does not sum breakdown rows to reconstruct missing totals or turn missing values into zero", async () => {
    const response = payload() as ReturnType<typeof payload> & { rows: Record<string, string>[]; totals: Record<string, number> };
    response.rows[0].purchase = ""; response.rows[1].purchase = "NaN"; response.totals = { installs: 12 };
    const fetcher = vi.fn().mockResolvedValue(Response.json(response));
    const report = await client(fetcher).report(query);
    expect(report.rows.map(row => row.purchase)).toEqual([null, null]);
    expect(report.totals).toEqual({ installs: 12, purchase: null, roas: null }); expect(report.partial).toBe(true);
  });
  it("does not accept hexadecimal text as a native decimal metric", async () => {
    const response = payload(); response.rows[0].installs = "0x10";
    const fetcher = vi.fn().mockResolvedValue(Response.json(response));
    const report = await client(fetcher).report(query);
    expect(report.rows[0].installs).toBeNull(); expect(report.partial).toBe(true);
  });
  it("marks duplicate breakdown identities partial while preserving the native total", async () => {
    const response = payload(); response.rows[1].day = response.rows[0].day;
    const fetcher = vi.fn().mockResolvedValue(Response.json(response));
    const report = await client(fetcher).report(query);
    expect(report.partial).toBe(true); expect(report.totals.installs).toBe(12); expect(report.rows).toHaveLength(2);
  });
  it("marks unknown provider pagination incomplete without fabricating a cursor or a second request", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...payload(), pagination: { next: "not-a-verified-contract" } }));
    const report = await client(fetcher).report(query);
    expect(report.partial).toBe(true); expect(report.warnings.join(" ")).toContain("extraction is incomplete"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains provider warnings while redacting credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...payload(), warnings: [`Token ${token} has limited rights.`, "Bearer another-secret", { debug: token }] }));
    const report = await client(fetcher).report(query);
    expect(JSON.stringify(report)).not.toMatch(/adjust-test-secret-never-return|another-secret/);
    expect(report.partial).toBe(true); expect(report.warnings.join(" ")).toContain("limited rights");
  });
  it("keeps data_warnings as provider warnings", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...payload(), data_warnings: ["Reporting scope is restricted"] }));
    const report = await client(fetcher).report(query);
    expect(report.partial).toBe(true); expect(report.warnings).toContain("Reporting scope is restricted");
  });
  it("does not misrepresent zeroes in mature cohort mode", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(payload()));
    const report = await client(fetcher).report({ ...query, cohortMaturity: "mature" });
    expect(report.warnings.join(" ")).toContain("immature cohorts");
  });
  it("warns when money metrics have no explicit currency", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ rows: [], totals: { revenue: 10 }, warnings: [] }));
    const report = await client(fetcher).report({ ...query, metrics: ["revenue"] });
    expect(report.warnings.join(" ")).toContain("currency is not explicit");
  });
  it("handles HTTP 204 as empty data, without inventing zero totals", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const report = await client(fetcher).report(query);
    expect(report.rows).toEqual([]); expect(report.totals).toEqual({ installs: null, purchase: null, roas: null });
    expect(report.partial).toBe(false);
  });
  it.each([
    { startDate: "2026-02-30" }, { startDate: "2026-10-10", endDate: "2026-10-01" },
    { metrics: [] }, { dimensions: [] }, { dimensions: ["unverified_dimension"] },
    { metrics: ["installs&app_token__in=another-app"] }, { utcOffset: "+14:01" },
    { metrics: ["app_token"] }, { filters: [{ field: "installs", operator: "gt", value: " " }] },
    { utcOffset: "Europe/Paris" }, { currency: "eur" }, { limit: 0 },
    { filters: [{ field: "app_token", operator: "in", value: ["other-client"] }] },
    { filters: [{ field: "country_code", operator: "in", value: ["US,FR"] }] },
    { filters: [{ field: "installs", operator: "contains", value: "1" }] },
    { filters: [{ field: "installs", operator: "gt", value: "NaN" }] },
    { filters: [{ field: "country_code", operator: "in", value: ["US"] }, { field: "country_code", operator: "in", value: ["FR"] }] },
  ])("rejects invalid or scope-changing query parameters before sending a request: %j", async invalid => {
    const fetcher = vi.fn();
    await expect(client(fetcher).report({ ...query, ...invalid } as AdjustReportQuery)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("translates safe exact and numeric filters without altering the app restriction", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(payload()));
    await client(fetcher).report({ ...query, filters: [{ field: "country_code", operator: "eq", value: "FR" }, { field: "installs", operator: "gte", value: 2 }] });
    const params = urlOf(fetcher).searchParams;
    expect(params.get("country_code__in")).toBe("FR"); expect(params.get("installs__gte")).toBe("2"); expect(params.get("app_token__in")).toBe("pilot-app");
  });
});

describe("provider error mapping and transport", () => {
  it.each([{ error: token }, { errors: [token] }, { success: false }, { failed: true }, { error_code: "request_error", error_desc: token }])("withholds apparent data when HTTP 200 contains an explicit failure: %j", async failure => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...payload(), ...failure }));
    const error = await client(fetcher).report(query).catch(error => error);
    expect(error).toBeInstanceOf(AdjustError); expect(error.status).toBe(502);
    expect(error.message).not.toContain(token); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refuses header injection and empty credentials", () => {
    expect(() => new AdjustClient("", { allowedAppTokens: ["pilot-app"] })).toThrow(AdjustError);
    expect(() => new AdjustClient("token\r\nInjected: yes", { allowedAppTokens: ["pilot-app"] })).toThrow(AdjustError);
  });
  it.each([
    [400, "rejected these report fields"], [401, "ADJUST_API_TOKEN"], [403, "permissions"], [404, "unavailable"],
  ])("does not retry HTTP %i or echo its body", async (status, message) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(`provider echoes ${token}`, { status }));
    const error = await client(fetcher).report(query).catch(error => error);
    expect(error.status).toBe(status); expect(error.message).toContain(message);
    expect(error.message).not.toContain(token); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refuses all redirects, including to the same origin", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: `https://automate.adjust.com/other?token=${token}` } }));
    const error = await client(fetcher).report(query).catch(error => error);
    expect(error.status).toBe(302); expect(error.message).not.toContain(token); expect(error.message).not.toContain("automate.adjust.com/other");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries only bounded transient reads and honors a short Retry-After", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "1" } })).mockResolvedValueOnce(Response.json(payload()));
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect((await client(fetcher, { sleep }).report(query)).totals.installs).toBe(12);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(sleep).toHaveBeenCalledWith(1000);
  });
  it("returns long provider delays to the caller without sleeping or repeated requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "60" } }));
    const sleep = vi.fn();
    await expect(client(fetcher, { sleep }).report(query)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 60 });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
  });
  it("stops after three transient failures", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 503 })));
    await expect(client(fetcher).report(query)).rejects.toMatchObject({ status: 503 }); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not leak credentials from thrown network errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(`failed request includes ${token}`));
    const error = await client(fetcher).report(query).catch(error => error);
    expect(error.status).toBe(0); expect(error.message).not.toContain(token); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("redacts a reflected credential from report dimensions and inventory labels", async () => {
    const response = payload(); response.rows[0].network = token;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(response)).mockResolvedValueOnce(Response.json({ apps: [{ id: "pilot-app", name: `App ${token}` }] }));
    const api = client(fetcher);
    expect(JSON.stringify(await api.report(query))).not.toContain(token);
    expect(JSON.stringify(await api.apps())).not.toContain(token);
  });
  it("bounds large and interrupted response bodies instead of returning incomplete data", async () => {
    const large = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(21 * 1024 * 1024)); controller.close(); } });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(large)).mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error(token)); } })));
    await expect(client(fetcher).report(query)).rejects.toMatchObject({ status: 413 });
    const error = await client(fetcher).report(query).catch(error => error);
    expect(error.status).toBe(502); expect(error.message).not.toContain(token);
  });
  it.each(["not-json", JSON.stringify({ rows: [], totals: null }), JSON.stringify({ rows: false, totals: {} })])("rejects invalid provider reports: %s", async body => {
    const fetcher = vi.fn().mockResolvedValue(new Response(body));
    await expect(client(fetcher).report(query)).rejects.toMatchObject({ status: 502 });
  });
});

describe("MCP tools", () => {
  it("registers exactly the five gateway reads and the guide without provider calls", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const { tools, resources } = collect();
    expect(tools.map(entry => entry.name)).toEqual(["adjust_list_apps", "adjust_list_events", "adjust_get_catalog", "adjust_run_report", "adjust_compare_periods"]);
    expect(tools.some(entry => entry.write)).toBe(false);
    expect(resources.map(entry => entry.uri)).toEqual(["adjust://guide"]);
    expect((await resources[0].read()).contents[0].text).toContain("https://dev.adjust.com/en/api/rs-api/");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects an arbitrary URL, environment override or foreign app before any request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const { tool } = collect();
    const results = [
      await tool("adjust_run_report").handler({ ...query, baseUrl: "https://evil.example" }),
      await tool("adjust_run_report").handler({ ...query, environment: "production" }),
      await tool("adjust_run_report").handler({ ...query, appToken: "other-client" }),
    ];
    expect(results.every(result => result.isError)).toBe(true);
    expect(data(results[2])).toMatchObject({ status: 403, error: expect.stringContaining("ADJUST_APP_TOKENS") });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("runs a defaulted read and returns the measurement evidence", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ rows: [{ app_token: "pilot-app", installs: "1", clicks: "2", impressions: "3" }], totals: { installs: 1, clicks: 2, impressions: 3 }, warnings: [] })); vi.stubGlobal("fetch", fetcher);
    const result = data(await collect().tool("adjust_run_report").handler({ appToken: "pilot-app", startDate: "2026-10-01", endDate: "2026-10-07" }));
    expect(result).toMatchObject({ environment: "sandbox", metrics: ["installs", "clicks", "impressions"], attribution: { source: "dynamic" }, totals: { installs: 1 } });
    expect(urlOf(fetcher).searchParams.get("dimensions")).toBe("app_token,os_name,day,network,campaign_id_network,campaign_network");
  });
  it("never lets one configuration read another configuration's app", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const first = collect({ allowedAppTokens: ["pilot-app"] }), second = collect({ allowedAppTokens: ["second-app"] });
    expect((await second.tool("adjust_get_catalog").handler({ appToken: "pilot-app" })).isError).toBe(true);
    expect((await first.tool("adjust_list_events").handler({ appToken: "second-app" })).isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports configured application tokens that Adjust did not return", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ apps: [{ id: "pilot-app", name: "Pilot" }, { id: "other-client", name: "Private" }] })); vi.stubGlobal("fetch", fetcher);
    const result = data(await collect({ allowedAppTokens: ["pilot-app", "missing-app"] }).tool("adjust_list_apps").handler({}));
    expect(result).toMatchObject({ apps: [{ id: "pilot-app", name: "Pilot" }], environment: "sandbox", unavailableAppTokens: ["missing-app"] });
    expect(JSON.stringify(result)).not.toContain("other-client");
  });
  it("returns provider failures as tool errors with status and Retry-After, never the token", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(`denied ${token}`, { status: 429, headers: { "retry-after": "30" } })); vi.stubGlobal("fetch", fetcher);
    const result = await collect().tool("adjust_list_events").handler({ appToken: "pilot-app" });
    expect(result.isError).toBe(true);
    expect(data(result)).toEqual({ error: "Adjust is temporarily limiting or delaying reporting. Retry later.", status: 429, retryAfterSeconds: 30 });
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it("lists the catalog with event metrics scoped to the application and no hosted workflows", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ id: "qa_purchase", name: "Purchase", app_token: ["pilot-app"], app_token_x_event_tokens_mapping: { "pilot-app": ["public-event"] } }])); vi.stubGlobal("fetch", fetcher);
    const catalog = data(await collect().tool("adjust_get_catalog").handler({ appToken: "pilot-app" }));
    expect(catalog.dimensions).toHaveLength(35); expect(catalog.exampleMetrics).toHaveLength(12);
    expect(catalog.eventMetrics.map((event: { activityMetric: string }) => event.activityMetric)).toEqual(["qa_purchase_events"]);
    expect(JSON.stringify(catalog)).not.toMatch(/getmcpads|sheet|business_review|snapshot/i);
  });
});

describe("period comparison", () => {
  const current = { since: "2026-10-08", until: "2026-10-14" }, previous = { since: "2026-10-01", until: "2026-10-07" };
  function native(transform: (body: Record<string, unknown>) => Record<string, unknown> = body => body) {
    const fetcher = vi.fn(async (url: URL) => {
      const p = url.searchParams, factor = p.get("date_period")!.startsWith(previous.since) ? 1 : 2;
      const metrics = p.get("metrics")!.split(",");
      const base: Record<string, number> = { installs: 4 * factor, roas: .4 * factor };
      const row = (os: string, scale: number) => ({ app_token: "pilot-app", os_name: os, ...Object.fromEntries(metrics.map(m => [m, String(base[m] * scale)])) });
      // Totals deliberately differ from the detail-row sum: native totals must win.
      return Response.json(transform({ rows: [row("ios", .1), row("android", .2)], totals: Object.fromEntries(metrics.map(m => [m, base[m]])), data_warnings: [] }));
    });
    vi.stubGlobal("fetch", fetcher);
    return { fetcher, tool: collect().tool("adjust_compare_periods") };
  }
  it("compares native period totals with identical settings and never averages row ratios", async () => {
    const { fetcher, tool } = native();
    const result = data(await tool.handler({ appToken: "pilot-app", startDate: current.since, endDate: current.until, dimensions: ["os_name"], metrics: ["installs", "roas"], currency: "EUR", attributionSource: "first" }));
    expect(result.complete).toBe(true); expect(result.previousReport.dateRange).toEqual({ start: previous.since, end: previous.until });
    expect(result.changes.roas).toEqual({ current: .8, previous: .4, absolute: .4, relativePercent: 100 });
    expect(fetcher.mock.calls.map(([url]) => url.searchParams.get("attribution_source"))).toEqual(["first", "first"]);
    const count = fetcher.mock.calls.length;
    const unequal = await tool.handler({ appToken: "pilot-app", startDate: current.since, endDate: current.until, comparison: { startDate: previous.since, endDate: previous.since } });
    expect(unequal.isError).toBe(true); expect(data(unequal).error).toContain("equal-length");
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
  it("calculates no changes from partial reports", async () => {
    const { tool } = native(body => ({ ...body, data_warnings: ["Restricted"] }));
    const result = data(await tool.handler({ appToken: "pilot-app", startDate: current.since, endDate: current.until, dimensions: ["os_name"], metrics: ["installs"], currency: "EUR" }));
    expect(result.complete).toBe(false); expect(result.changes.installs.absolute).toBeNull(); expect(result.changes.installs.relativePercent).toBeNull();
  });
});
