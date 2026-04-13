import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig({
	entry: ["src/mcp/server.ts", "src/dashboard/server.ts"],
	format: ["esm"],
	define: {
		__PKG_VERSION__: JSON.stringify(version)
	}
});
