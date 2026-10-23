#!/usr/bin/env node
/**
 * adjust-mcp-server: an open-source MCP server for the Adjust Report Service API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * stdout carries the MCP protocol. Every diagnostic goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { nodeRuntimeWarning } from "./runtime-check.js";
import { createServer } from "./server.js";

const runtimeWarning = nodeRuntimeWarning();
if (runtimeWarning) process.stderr.write(`[adjust-mcp] WARN ${runtimeWarning}\n`);

try {
  await createServer(loadConfig()).connect(new StdioServerTransport());
} catch (error) {
  process.stderr.write(`[adjust-mcp] ERROR ${error instanceof Error ? error.message : "The Adjust MCP server failed to start."}\n`);
  process.exitCode = 1;
}
