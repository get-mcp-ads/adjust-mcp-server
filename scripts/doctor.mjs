#!/usr/bin/env node
/**
 * Local configuration check. It reads environment variable presence, the
 * build output and the Node.js runtime. It never prints a secret value and
 * makes no network request.
 */
import { existsSync } from "node:fs";

const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });

const token = process.env.ADJUST_API_TOKEN ?? "";
add("ADJUST_API_TOKEN", token.trim().length > 0 && !/\s/.test(token.trim()), token ? "set (value not shown)" : "missing: copy the API token from your Adjust account settings");

const apps = (process.env.ADJUST_APP_TOKENS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const invalidApps = apps.filter((value) => !/^[A-Za-z0-9_-]{1,128}$/.test(value)).length;
add("ADJUST_APP_TOKENS", apps.length > 0 && apps.length <= 200 && invalidApps === 0,
  apps.length === 0 ? "missing: list the app tokens this server may read, separated by commas"
    : invalidApps ? `${invalidApps} entr${invalidApps === 1 ? "y is" : "ies are"} not a valid app token` : `${apps.length} app token${apps.length === 1 ? "" : "s"} allowed`);

const environment = (process.env.ADJUST_ENVIRONMENT ?? "production").trim().toLowerCase() || "production";
add("ADJUST_ENVIRONMENT", ["production", "sandbox"].includes(environment), environment);

const built = existsSync(new URL("../dist/cli.js", import.meta.url));
add("build", built, built ? "dist/cli.js present" : "run npm run build");

let runtimeWarning;
if (built) ({ nodeRuntimeWarning: runtimeWarning } = await import("../dist/index.js"));
const warning = runtimeWarning?.();
add("node", built ? !warning : true, warning ?? `Node.js ${process.versions.node}${built ? "" : " (build to run the security check)"}`);

const ok = checks.every((check) => check.ok);
process.stdout.write(`${JSON.stringify({ ok, checks }, null, 2)}\n`);
if (warning) process.stderr.write(`[adjust-mcp] WARN ${warning}\n`);
process.exitCode = ok ? 0 : 1;
