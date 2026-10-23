/**
 * The README documents every tool and resource by name. A tool renamed in the
 * code and not in the README is a documentation bug, and this test fails on it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let cached;
async function introspect() {
  if (cached) return cached;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/cli.js"],
    // A write flag is set on purpose: it does not exist and must expose nothing.
    env: { ...process.env, ADJUST_API_TOKEN: "token-for-listing", ADJUST_APP_TOKENS: "listing-app", ADJUST_ENABLE_WRITES: "true" },
    stderr: "pipe",
  });
  const client = new Client({ name: "readme-check", version: "1" }, { capabilities: {} });
  await client.connect(transport);
  const definitions = (await client.listTools()).tools;
  const resources = (await client.listResources()).resources.map((r) => r.uri);
  await client.close();
  cached = { tools: definitions.map((t) => t.name), resources, definitions };
  return cached;
}

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("README documents every tool the server exposes, and nothing else", async () => {
  const { tools } = await introspect();
  const cited = new Set([...README.matchAll(/`(adjust_[a-z_]+)`/g)].map((m) => m[1]));
  const undocumented = tools.filter((t) => !cited.has(t));
  assert.deepEqual(undocumented, [], `Tools missing from README: ${undocumented.join(", ")}`);
  const invented = [...cited].filter((c) => !tools.includes(c));
  assert.deepEqual(invented, [], `README cites tools that do not exist: ${invented.join(", ")}`);
});

test("README documents every resource the server exposes", async () => {
  const { resources } = await introspect();
  const cited = new Set([...README.matchAll(/`(adjust:\/\/[a-z0-9-]+)`/g)].map((m) => m[1]));
  assert.deepEqual(resources.filter((r) => !cited.has(r)), [], "resource missing from README");
  assert.deepEqual([...cited].filter((c) => !resources.includes(c)), [], "README cites a resource that does not exist");
});

test("the server exposes no write tool at all", async () => {
  const { tools, definitions } = await introspect();
  const suspicious = tools.filter((t) => /(create|update|delete|remove|set|patch|write|archive|pause|activate|rename)/i.test(t));
  assert.deepEqual(suspicious, [], `This server is read-only by design. These tool names suggest otherwise: ${suspicious.join(", ")}`);
  assert.ok(definitions.every((t) => t.annotations.readOnlyHint === true));
  assert.ok(!README.includes("ADJUST_ENABLE_WRITES"), "the README must not document a write flag");
  assert.match(README, /read-only by design/i);
});

test("README tool counts match reality", async () => {
  const { tools, resources, definitions } = await introspect();
  const writes = definitions.filter((t) => !t.annotations.readOnlyHint).length;
  const reads = tools.length - writes;
  assert.equal(reads, 5, "read tool count changed, update the README");
  assert.equal(writes, 0, "write tool count changed, update the README");
  assert.equal(resources.length, 1, "resource count changed, update the README");
  assert.match(README, new RegExp(`\\*\\*${reads} read tools\\*\\* · \\*\\*${writes} write tools\\*\\*`));
  assert.match(README, new RegExp(`<b>${reads} read tools</b>`));
});

test("README badges, hosted link and comparison source follow the house rules", () => {
  for (const badge of ["Release", "CI", "License", "Node"]) assert.match(README, new RegExp(`\\[!\\[${badge}`), badge);
  assert.ok(!/smithery/i.test(README), "no Smithery badge until the server is listed");
  assert.match(README, /https:\/\/www\.getmcpads\.com\/tools\/adjust\?utm_source=github&utm_medium=readme&utm_campaign=adjust/);
  // The comparison cites only Adjust's own documentation.
  assert.match(README, /https:\/\/help\.adjust\.com\/en\/article\/adjust-mcp/);
});

test("published prose uses no em dashes", () => {
  const files = ["README.md", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md", "RELEASING.md", "SOURCE_SYNC.md", "NOTICE", ".env.example", "server.json", "package.json"];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
      else if (/\.(ts|mjs)$/.test(entry.name)) files.push(`${dir}/${entry.name}`);
    }
  };
  walk("src"); walk("scripts");
  const offenders = [];
  for (const file of files) {
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n").forEach((line, i) => {
      if (line.includes("\u2014")) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `Em dashes are not used in this project. Rewrite the sentence instead of swapping the character. Found at: ${offenders.join(", ")}`);
});
