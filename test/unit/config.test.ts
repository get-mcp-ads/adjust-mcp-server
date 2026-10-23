import { describe, expect, it } from "vitest";
import { loadConfig, validateConfig } from "../../src/config.js";

const secret = "private-adjust-token";

describe("configuration from environment variables", () => {
  it("requires an API token and a nonempty application allowlist", () => {
    expect(() => loadConfig({})).toThrow(/ADJUST_API_TOKEN/);
    expect(() => loadConfig({ ADJUST_API_TOKEN: secret })).toThrow(/ADJUST_APP_TOKENS/);
    expect(() => loadConfig({ ADJUST_API_TOKEN: secret, ADJUST_APP_TOKENS: " , ," })).toThrow(/ADJUST_APP_TOKENS/);
  });
  it("names the variable to fix and never echoes a value", () => {
    for (const env of [
      { ADJUST_API_TOKEN: `${secret} extra`, ADJUST_APP_TOKENS: "app1" },
      { ADJUST_API_TOKEN: secret, ADJUST_APP_TOKENS: "app1,../other" },
      { ADJUST_API_TOKEN: secret, ADJUST_APP_TOKENS: secret },
      { ADJUST_API_TOKEN: secret, ADJUST_APP_TOKENS: "app1", ADJUST_ENVIRONMENT: "staging" },
    ]) {
      let message = "";
      try { loadConfig(env); } catch (error) { message = (error as Error).message; }
      expect(message).toMatch(/ADJUST_/);
      expect(message).not.toContain(secret);
      expect(message).not.toContain("../other");
    }
  });
  it("defaults to production, trims entries and removes duplicates", () => {
    expect(loadConfig({ ADJUST_API_TOKEN: ` ${secret} `, ADJUST_APP_TOKENS: " app1, app2 ,app1" })).toEqual({ apiToken: secret, allowedAppTokens: ["app1", "app2"], environment: "production" });
    expect(loadConfig({ ADJUST_API_TOKEN: secret, ADJUST_APP_TOKENS: "app1", ADJUST_ENVIRONMENT: "Sandbox" }).environment).toBe("sandbox");
  });
  it("has no write setting: a write flag is ignored and leaves the configuration unchanged", () => {
    const config = loadConfig({ ADJUST_API_TOKEN: secret, ADJUST_APP_TOKENS: "app1", ADJUST_ENABLE_WRITES: "true" });
    expect(config).toEqual({ apiToken: secret, allowedAppTokens: ["app1"], environment: "production" });
  });
  it("caps the allowlist", () => {
    const many = Array.from({ length: 201 }, (_, i) => `app${i}`);
    expect(() => validateConfig({ apiToken: secret, allowedAppTokens: many })).toThrow(/at most 200/);
  });
});
