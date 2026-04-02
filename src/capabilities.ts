import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.join(__dirname, "../package.json");
let pkgVersion = "0.1.0";

try {
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkgVersion = pkg.version;
  }
} catch (e) {
  // Fallback to default version if reading fails
}

// MCP Server Capabilities
export const CAPABILITIES = {
  serverInfo: {
    name: "mcp-memory-local",
    version: pkgVersion
  },
  capabilities: {
    resources: {
      list: true,
      read: true,
      templates: true
    },
    tools: {
      list: true,
      call: true
    },
    prompts: {
      list: true,
      get: true
    }
  }
};
