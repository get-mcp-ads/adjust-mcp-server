/**
 * stdout is the MCP channel. Startup diagnostics and configuration errors must
 * go to stderr, name the variable to fix and never print a credential.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const secret = "private-adjust-token-for-cli-test";
function run(env) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("ADJUST_")));
  return spawnSync(process.execPath, ["dist/cli.js"], { cwd: new URL("..", import.meta.url), env: { ...clean, ...env }, input: "", encoding: "utf8", timeout: 15_000 });
}

test("a missing configuration fails on stderr with an actionable message", () => {
  for (const [env, variable] of [[{}, "ADJUST_API_TOKEN"], [{ ADJUST_API_TOKEN: secret }, "ADJUST_APP_TOKENS"], [{ ADJUST_API_TOKEN: secret, ADJUST_APP_TOKENS: "app1", ADJUST_ENVIRONMENT: "qa" }, "ADJUST_ENVIRONMENT"]]) {
    const result = run(env);
    assert.equal(result.status, 1, variable);
    assert.equal(result.stdout, "", "nothing may be written to the MCP channel");
    assert.match(result.stderr, new RegExp(variable));
    assert.ok(!result.stderr.includes(secret), "the API token was printed");
  }
});

test("the runtime check reports to stderr only", async () => {
  const { nodeRuntimeWarning } = await import("../dist/index.js");
  const result = run({ ADJUST_API_TOKEN: secret, ADJUST_APP_TOKENS: secret });
  assert.equal(result.stdout, "");
  const warning = nodeRuntimeWarning();
  if (warning) assert.ok(result.stderr.includes(warning));
  else assert.ok(!/lacks the October 2026 security fixes/.test(result.stderr));
  assert.ok(!result.stderr.includes(secret));
});
