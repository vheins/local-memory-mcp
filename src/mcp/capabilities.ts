import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pkgVersion = "0.1.0";

// __PKG_VERSION__ is injected at build time by tsup define
// Fallback: walk up directory tree to find package.json
if (typeof __PKG_VERSION__ !== "undefined" && __PKG_VERSION__) {
	pkgVersion = __PKG_VERSION__;
} else {
	let searchDir = __dirname;
	for (let i = 0; i < 5; i++) {
		const candidate = path.join(searchDir, "package.json");
		try {
			if (fs.existsSync(candidate)) {
				const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
				if (pkg.name === "@vheins/local-memory-mcp" && pkg.version) {
					pkgVersion = pkg.version;
					break;
				}
			}
		} catch { /* try next */ }
		searchDir = path.dirname(searchDir);
	}
}

declare const __PKG_VERSION__: string;

// MCP Server Capabilities
export const MCP_PROTOCOL_VERSION = "2025-03-26";

export const CAPABILITIES = {
	serverInfo: {
		name: "mcp-memory-local",
		version: pkgVersion
	},
	capabilities: {
		completions: {},
		logging: {},
		resources: {
			subscribe: true,
			listChanged: true
		},
		tools: {
			listChanged: false
		},
		prompts: {
			listChanged: true
		}
	}
};
