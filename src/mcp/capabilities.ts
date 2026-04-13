import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pkgVersion = "0.1.0";

// Search for package.json walking up from __dirname
const candidates = [
	path.join(__dirname, "../../package.json"),       // dev: dist/mcp/ -> root
	path.join(__dirname, "../../../package.json"),     // global install: lib/node_modules/.../dist/mcp/
	path.join(__dirname, "../../../../package.json"),  // deeper nesting
];

for (const pkgPath of candidates) {
	try {
		if (fs.existsSync(pkgPath)) {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
			if (pkg.name === "@vheins/local-memory-mcp" && pkg.version) {
				pkgVersion = pkg.version;
				break;
			}
		}
	} catch {
		// try next
	}
}

// MCP Server Capabilities
export const MCP_PROTOCOL_VERSION = "2025-11-25";

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
