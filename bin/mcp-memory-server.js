#!/usr/bin/env node
import { ensureDashboardBuild } from "./ensure-dashboard-build.mjs";

process.env.MCP_SERVER = "true";

const sub = process.argv[2];
if (sub === "dashboard" || sub === "mcp-memory-dashboard") {
	// Rebuild the served UI bundle if stale (no-op when fresh).
	ensureDashboardBuild();
	import("../dist/dashboard/server.js");
} else if (sub === "--index") {
	// Pass through --index and all subsequent args to server.ts
	import("../dist/mcp/server.js");
} else {
	import("../dist/mcp/server.js");
}
