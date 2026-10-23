import { registerAdjustReads, type ToolResult } from "../../src/platforms/adjust/tools.js";

export type CollectedTool = { name: string; description: string; shape: Record<string, unknown>; handler: (args: Record<string, unknown>) => Promise<ToolResult>; write: boolean };
export type CollectedResource = { name: string; uri: string; read: () => Promise<{ contents: { uri: string; mimeType: string; text: string }[] }> };

/** Collects registrations without an MCP transport, the way the server registers them. */
export function collect(config: { apiToken?: string; allowedAppTokens?: string[]; environment?: "sandbox" | "production" } = {}) {
  const tools: CollectedTool[] = [];
  const resources: CollectedResource[] = [];
  registerAdjustReads({
    tool(name, description, shape, handler) { tools.push({ name, description, shape, handler, write: Object.hasOwn(shape, "confirm") }); },
    resource(name, uri, _description, read) { resources.push({ name, uri, read }); },
  }, { apiToken: "adjust-test-secret-never-return", allowedAppTokens: ["pilot-app"], environment: "sandbox", ...config });
  return { tools, resources, tool: (name: string) => tools.find(entry => entry.name === name)! };
}

export const data = (result: ToolResult) => JSON.parse(result.content[0].text);
