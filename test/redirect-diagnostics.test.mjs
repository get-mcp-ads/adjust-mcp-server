import { test } from "node:test";
import assert from "node:assert/strict";
import { AdjustClient } from "../src/platforms/adjust/client.ts";
import { isRedirect } from "../src/core/redirects.ts";

test("a redirect is refused without following it or disclosing its location", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 307, headers: { location: "https://attacker.example/?access_token=private-token" } });
  };
  try {
    const client = new AdjustClient("private-token", { allowedAppTokens: ["app1"], sleep: async () => {} });
    await assert.rejects(client.apps(), (error) => error.status === 307 && !error.message.includes("private-token") && !error.message.includes("attacker.example"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.redirect, "manual");
    assert.ok(!calls[0].url.includes("private-token"));
  } finally {
    globalThis.fetch = original;
  }
});

test("redirect detection covers 3xx and opaque redirects only", () => {
  assert.equal(isRedirect(new Response(null, { status: 302 })), true);
  assert.equal(isRedirect(new Response(null, { status: 308 })), true);
  assert.equal(isRedirect(new Response("{}", { status: 200 })), false);
  assert.equal(isRedirect(new Response(null, { status: 204 })), false);
  assert.equal(isRedirect({ type: "opaqueredirect", status: 0 }), true);
});
