import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createServer } from "../dist/index.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const fixture = { apiToken: "metadata-fixture", allowedAppTokens: ["fixture-app"], environment: "production" };

async function connect(config, callback) {
  const server = createServer(config);
  const client = new Client({ name: "quality-contract", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try { await callback(client, server); } finally { await client.close(); await server.close(); }
}

test("metadata is complete over MCP and every tool is read-only, with or without a write flag", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Metadata must not access a provider"); };
  try {
    const catalogs = [];
    // A write flag does not exist. Passing one must change nothing.
    for (const config of [fixture, { ...fixture, enableWrites: true }]) await connect(config, async (client) => {
      const tools = (await client.listTools()).tools;
      catalogs.push(JSON.stringify(tools));
      assert.equal(tools.length, 5);
      assert.equal(new Set(tools.map((t) => t.name)).size, tools.length, "duplicate tools");
      for (const tool of tools) {
        assert.match(tool.name, /^adjust_/);
        assert.ok(tool.description.length > 20, tool.name);
        assert.ok(tool.outputSchema?.required.includes("result"), tool.name);
        assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, tool.name);
        assert.equal(tool.inputSchema.properties?.confirm, undefined, `${tool.name} has a confirm parameter`);
        assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must reject unknown arguments`);
        for (const [key, schema] of Object.entries(tool.inputSchema.properties || {})) assert.ok(schema.description, `${tool.name}.${key}`);
        assert.ok(!JSON.stringify(tool.inputSchema).includes("$ref"), `${tool.name} uses a JSON Schema reference`);
      }
      const resources = (await client.listResources()).resources;
      assert.deepEqual(resources.map((r) => r.uri), ["adjust://guide"]);
      assert.equal(client.getServerVersion().websiteUrl, pkg.homepage);
      assert.equal(client.getServerVersion().version, pkg.version);
    });
    assert.equal(catalogs[0], catalogs[1]);
  } finally { globalThis.fetch = original; }
});

test("unknown arguments are rejected over MCP before any request", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("No provider call expected"); };
  try {
    await connect(fixture, async (client) => {
      for (const extra of [{ environment: "sandbox" }, { baseUrl: "https://evil.example" }, { confirm: true }]) {
        const result = await client.callTool({ name: "adjust_run_report", arguments: { appToken: "fixture-app", startDate: "2026-10-01", endDate: "2026-10-01", ...extra } });
        assert.equal(result.isError, true, JSON.stringify(extra));
      }
      const foreign = await client.callTool({ name: "adjust_run_report", arguments: { appToken: "other-app", startDate: "2026-10-01", endDate: "2026-10-01" } });
      assert.equal(foreign.isError, true);
      assert.match(JSON.stringify(foreign), /not selected in ADJUST_APP_TOKENS/);
    });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("a report travels through the real MCP path with native evidence", async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(new URL(String(url)));
    return Response.json({ rows: [{ app_token: "fixture-app", day: "2026-10-01", network: "Organic", installs: "1" }], totals: { installs: 1 }, warnings: [], pagination: null });
  };
  try {
    await connect(fixture, async (client) => {
      const guide = await client.readResource({ uri: "adjust://guide" });
      assert.match(guide.contents[0].text, /https:\/\/dev\.adjust\.com\/en\/api\/rs-api\//);
      const result = await client.callTool({ name: "adjust_run_report", arguments: { appToken: "fixture-app", startDate: "2026-10-01", endDate: "2026-10-01", dimensions: ["day", "network"], metrics: ["installs"] } });
      assert.notEqual(result.isError, true);
      assert.deepEqual(result.structuredContent.result.totals, { installs: 1 });
      assert.equal(result.structuredContent.result.partial, false);
      assert.equal(result.structuredContent.result.environment, "production");
    });
    assert.equal(urls.length, 1);
    assert.equal(urls[0].hostname, "automate.adjust.com");
  } finally { globalThis.fetch = original; }
});

test("structured output preserves text, JSON arrays and errors through the SDK", async () => {
  await connect(fixture, async (client, server) => {
    server.tool("quality_fixture", "Fixture that checks the actual SDK response contract.", { mode: z.enum(["json", "text", "error"]).describe("Fixture response type.") }, async ({ mode }) => ({ ...(mode === "error" ? { isError: true } : {}), content: [{ type: "text", text: mode === "json" ? '[{"installs":0,"currency":"EUR"}]' : mode }] }));
    for (const mode of ["json", "text", "error"]) {
      const out = await client.callTool({ name: "quality_fixture", arguments: { mode } });
      if (mode === "error") { assert.equal(out.isError, true); assert.equal(out.structuredContent, undefined); }
      else { assert.equal(out.isError, undefined); assert.deepEqual(out.structuredContent.result, mode === "json" ? [{ installs: 0, currency: "EUR" }] : "text"); }
    }
  });
});
