/**
 * package.json and server.json both carry the version, the npm package name and
 * the registry name. They have to agree: the MCP Registry verifies ownership by
 * matching `mcpName` in the published npm package against the server name, so a
 * drift here is not a cosmetic problem, it is a failed publish.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const text = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

const pkg = read("package.json");
const server = read("server.json");
const card = read("server-card.json");

test("server.json and package.json agree on the registry name", () => {
  assert.equal(pkg.mcpName, server.name, "package.json mcpName must equal server.json name, or the registry refuses the publish");
  assert.equal(pkg.mcpName, "com.getmcpads/adjust");
  assert.equal(pkg.name, "@getmcpads/adjust-mcp-server");
  assert.deepEqual(pkg.bin, { "adjust-mcp": "dist/cli.js" });
});

test("server.json and package.json agree on the version", () => {
  assert.equal(pkg.version, server.version, "bump both, or the registry listing goes stale");
  const npmPackage = server.packages?.find((p) => p.registryType === "npm");
  assert.ok(npmPackage, "server.json must declare the npm package");
  assert.equal(npmPackage.identifier, pkg.name);
  assert.equal(npmPackage.version, pkg.version);
  assert.equal(npmPackage.transport.type, "stdio");
});

test("the version the server announces matches the package", () => {
  // PACKAGE_VERSION is a literal in src/server.ts, so nothing stops a release
  // from bumping package.json and leaving the handshake announcing the old number.
  const announced = text("src/server.ts").match(/PACKAGE_VERSION = "([0-9]+\.[0-9]+\.[0-9]+)"/)?.[1];
  assert.equal(announced, pkg.version, "src/server.ts and package.json disagree on the version");
  assert.equal(card.serverInfo.version, pkg.version, "regenerate server-card.json with npm run catalog");
});

test("server.json points at this repository and its product page", () => {
  assert.equal(server.repository.source, "github");
  assert.equal(server.repository.url, pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, ""));
  assert.equal(server.repository.url, "https://github.com/get-mcp-ads/adjust-mcp-server");
  assert.equal(pkg.bugs.url, `${server.repository.url}/issues`);
  assert.equal(server.websiteUrl, pkg.homepage);
  assert.equal(server.websiteUrl, "https://www.getmcpads.com/tools/adjust");
});

test("descriptions fit the registry and state the tool counts", () => {
  // The official schema caps title and description at 100 characters.
  for (const value of [server.description, server.title, pkg.description]) assert.ok(value.length <= 100, `${value.length} characters, max 100`);
  assert.equal(server.description, pkg.description);
  const reads = card.tools.filter((t) => t.annotations.readOnlyHint).length;
  const writes = card.tools.length - reads;
  assert.match(pkg.description, new RegExp(`\\b${reads} read tools, ${writes} write tools\\b`));
});

test("runtime and dependency ranges carry the security floor", () => {
  assert.equal(pkg.engines.node, "^22.23.4 || ^24.22.1 || >=26.12.1");
  assert.equal(pkg.dependencies["@modelcontextprotocol/sdk"], "^1.32.1");
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@modelcontextprotocol/sdk", "zod"]);
  for (const keyword of ["mcp", "mcp-server", "model-context-protocol", "adjust"]) assert.ok(pkg.keywords.includes(keyword), keyword);
});

test("every environment variable the code reads is declared and documented", () => {
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
      else if (entry.name.endsWith(".ts")) sources.push(text(`${dir}/${entry.name}`));
    }
  };
  walk("src");
  const used = [...new Set(sources.flatMap((source) => [...source.matchAll(/env\.(ADJUST_[A-Z_]+)/g)].map((m) => m[1])))].sort();
  const declared = server.packages.flatMap((p) => p.environmentVariables ?? []).map((v) => v.name).sort();
  assert.deepEqual(used, declared, "server.json must declare exactly the variables the code reads");
  assert.ok(declared.every((name) => name.startsWith("ADJUST_")));
  const env = text(".env.example");
  const readme = text("README.md");
  for (const name of declared) {
    assert.ok(env.includes(name), `${name} missing from .env.example`);
    assert.ok(readme.includes(`\`${name}\``), `${name} missing from the README configuration table`);
  }
  const secrets = server.packages[0].environmentVariables.filter((v) => v.isSecret).map((v) => v.name);
  assert.deepEqual(secrets, ["ADJUST_API_TOKEN"]);
});

test("the release files come from the shared kit and the registry metadata is complete", () => {
  assert.deepEqual(read("glama.json").maintainers, ["Emmanuel-Benly"]);
  const release = text(".github/workflows/release.yml");
  assert.match(release, /npm publish --access public --provenance/);
  assert.match(release, /mcp-publisher publish/);
  assert.match(text(".github/workflows/ci.yml"), /node: \[22, 24, 26\]/);
  assert.match(text("SOURCE_SYNC.md"), /`3e1c2c8`/);
});
