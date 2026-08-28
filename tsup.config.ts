import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig({
	entry: ["src/mcp/server.ts", "src/dashboard/server.ts"],
	format: ["esm"],
	define: {
		__PKG_VERSION__: JSON.stringify(version)
	},
	// The TypeScript semantic enricher (src/mcp/codebase-index/semantic/
	// typescript-enricher.ts) imports `typescript`, whose bundled lib performs
	// dynamic `require('fs')`/`require('path')` calls and reads `__filename`/
	// `__dirname`. tsup's ESM __require shim throws "Dynamic require of ... is
	// not supported" on those, and Node 24 rejects bare `__filename` in ESM
	// chunks that contain top-level await (ERR_AMBIGUOUS_MODULE_SYNTAX). Provide
	// a real `require` via createRequire plus file-location globals so the
	// bundled lib resolves core modules at runtime (see #89/#90). `typescript`
	// itself stays bundled because it is a devDependency; it must move to
	// `dependencies` before the enricher can be externalized.
	banner: {
		js: "import { createRequire as __vheinsCreateRequire } from 'module'; import { fileURLToPath as __vheinsFileURLToPath } from 'node:url'; import __vheinsPath from 'node:path'; const require = __vheinsCreateRequire(import.meta.url); var __filename = import.meta.url; var __dirname = __vheinsPath.dirname(__vheinsFileURLToPath(import.meta.url));"
	}
});
