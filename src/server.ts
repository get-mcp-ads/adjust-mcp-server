/**
 * adjust-mcp-server: an open-source MCP server for the Adjust Report Service API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateConfig, type AdjustConfig } from "./config.js";
import { installToolQuality } from "./tool-quality.js";
import { registerAdjustReads } from "./platforms/adjust/tools.js";

export const PACKAGE_VERSION = "1.0.0";

/** Read-only by design: there is no write tool and no setting that registers one. */
export function createServer(input: AdjustConfig): McpServer {
  const config = validateConfig(input);
  const server = new McpServer(
    { name: "adjust-mcp", version: PACKAGE_VERSION, title: "Adjust", websiteUrl: "https://www.getmcpads.com/tools/adjust", icons: [{ src: "https://mcp.getmcpads.com/icon.svg", mimeType: "image/svg+xml" }] },
    { capabilities: { tools: { listChanged: true }, resources: { subscribe: false, listChanged: true } } },
  );
  installToolQuality(server);
  registerAdjustReads({
    tool: (name, description, shape, handler) => { server.tool(name, description, shape, handler as never); },
    resource: (name, uri, description, read) => { server.registerResource(name, uri, { description, mimeType: "text/plain" }, async () => read()); },
  }, config);
  return server;
}
