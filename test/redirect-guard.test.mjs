/**
 * Every outbound call carries the Adjust API token. Following a redirect would
 * forward it to whatever host the redirect names, so every fetch must either
 * refuse redirects outright or receive them manually and reject them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

function sourceFiles(dir = "src", acc = []) {
  for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) sourceFiles(`${dir}/${entry.name}`, acc);
    else if (entry.name.endsWith(".ts")) acc.push(`${dir}/${entry.name}`);
  }
  return acc;
}

test("every fetch refuses to follow redirects", () => {
  const offenders = [];
  let calls = 0;
  for (const file of sourceFiles()) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of text.matchAll(/\bfetch\(/g)) {
      calls++;
      // The options object of a fetch call ends at the first `});` that follows.
      const tail = text.slice(match.index, match.index + 1200);
      const end = tail.indexOf("});");
      const call = end === -1 ? tail : tail.slice(0, end);
      const line = text.slice(0, match.index).split("\n").length;
      const refuses = call.includes('redirect: "error"');
      const manual = call.includes('redirect: "manual"') || call.includes("redirect: NO_REDIRECT");
      // A manual redirect is only safe when the same file rejects the 3xx response.
      if (!refuses && !(manual && text.includes("isRedirect(response)"))) offenders.push(`${file}:${line}`);
      if (!call.includes("signal:")) offenders.push(`${file}:${line} (no timeout signal)`);
    }
  }
  assert.ok(calls > 0, "the scan found no fetch call; update this test if the transport moved");
  assert.deepEqual(offenders, [], `These fetch calls may follow a redirect and leak the token: ${offenders.join(", ")}`);
});

test("the only host this server can reach is the Adjust Report Service", () => {
  const hosts = new Set();
  // Documentation and branding links returned as text. None is ever requested.
  const documentation = new Set(["dev.adjust.com", "help.adjust.com", "www.getmcpads.com", "mcp.getmcpads.com", "github.com", "modelcontextprotocol.io"]);
  for (const file of sourceFiles()) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = match[1].replace(/\.$/, "").toLowerCase();
      if (!documentation.has(host)) hosts.add(host);
    }
  }
  assert.deepEqual([...hosts].sort(), ["automate.adjust.com"], "A new outbound host appeared. That is a deliberate decision, not an accident.");
});

test("the documented host is declared in one place and enforced before the token is attached", async () => {
  const { ALLOWED_API_HOSTS, ADJUST_API_ORIGIN, assertAllowedApiUrl } = await import("../src/core/hosts.ts");
  assert.deepEqual([...ALLOWED_API_HOSTS], ["automate.adjust.com"]);
  assert.equal(new URL(ADJUST_API_ORIGIN).hostname, "automate.adjust.com");
  assert.doesNotThrow(() => assertAllowedApiUrl(new URL("https://automate.adjust.com/reports-service/report")));
  for (const url of ["http://automate.adjust.com/x", "https://automate.adjust.com.evil.example/x", "https://automate.adjust.com:8443/x", "https://user:pass@automate.adjust.com/x", "https://169.254.169.254/latest"]) {
    assert.throws(() => assertAllowedApiUrl(new URL(url)), url);
  }
});
