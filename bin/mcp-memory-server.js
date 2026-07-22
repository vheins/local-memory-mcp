#!/usr/bin/env node
process.env.MCP_SERVER = "true";

const sub = process.argv[2];
if (sub === "dashboard" || sub === "mcp-memory-dashboard") {
	import("../dist/dashboard/server.js");
} else if (sub === "--index") {
	// Pass through --index and all subsequent args to server.ts
	import("../dist/mcp/server.js");
} else {
	import("../dist/mcp/server.js");
}
