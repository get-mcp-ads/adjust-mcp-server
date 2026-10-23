/**
 * adjust-mcp-server: an open-source MCP server for the Adjust Report Service API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from "zod";
import { APP_TOKEN_PATTERN } from "./platforms/adjust/client.js";

const MAX_APP_TOKENS = 200;

const schema = z.object({
  apiToken: z.string()
    .min(1, "Set ADJUST_API_TOKEN to the API token shown in your Adjust account settings.")
    .max(4096, "ADJUST_API_TOKEN is too long. Paste only the API token.")
    .regex(/^\S*$/, "ADJUST_API_TOKEN contains whitespace. Paste only the API token."),
  allowedAppTokens: z.array(z.string().regex(APP_TOKEN_PATTERN, "Each ADJUST_APP_TOKENS entry must be an Adjust app token of letters, digits, _ or -."))
    .min(1, "Set ADJUST_APP_TOKENS to a comma-separated list of the Adjust app tokens this server may read.")
    .max(MAX_APP_TOKENS, `ADJUST_APP_TOKENS accepts at most ${MAX_APP_TOKENS} app tokens.`),
  environment: z.enum(["production", "sandbox"], { errorMap: () => ({ message: "ADJUST_ENVIRONMENT must be production or sandbox." }) }).default("production"),
}).superRefine((value, context) => {
  if (value.allowedAppTokens.includes(value.apiToken)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "ADJUST_APP_TOKENS must list app tokens, not the API token." });
  }
});

export type AdjustConfig = z.infer<typeof schema>;

/** Validates a configuration object. Error messages name the variable to fix and never echo a value. */
export function validateConfig(value: unknown): AdjustConfig {
  const result = schema.safeParse(value);
  if (!result.success) {
    const messages = [...new Set(result.error.issues.map(issue => issue.message))];
    throw new Error(`Adjust MCP server configuration is incomplete. ${messages.join(" ")}`);
  }
  return { ...result.data, allowedAppTokens: [...new Set(result.data.allowedAppTokens)] };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AdjustConfig {
  return validateConfig({
    apiToken: (env.ADJUST_API_TOKEN ?? "").trim(),
    allowedAppTokens: (env.ADJUST_APP_TOKENS ?? "").split(",").map(value => value.trim()).filter(Boolean),
    environment: (env.ADJUST_ENVIRONMENT ?? "").trim().toLowerCase() || undefined,
  });
}
