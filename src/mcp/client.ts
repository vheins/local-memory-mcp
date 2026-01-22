import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class MCPClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  private isInitialized = false;
  private serverPathOverride?: string;

  constructor(serverPath?: string) {
    this.serverPathOverride = serverPath;
  }

  async start() {
    if (this.process) return;

    const serverPath = this.serverPathOverride || path.join(__dirname, "../server.js");
    this.process = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "inherit"]
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error("Failed to spawn MCP server");
    }

    const rl = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity
    });

    rl.on("line", (line) => {
      try {
        const response = JSON.parse(line);

        if (!response.id) return;

        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (err) {
        console.error("Failed to parse MCP response:", err);
      }
    });

    await this.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-client", version: "1.0.0" }
    });

    this.isInitialized = true;
  }

  async call(method: string, params: any = {}): Promise<any> {
    if (!this.process || !this.process.stdin) {
      throw new Error("MCP server not started");
    }

    const id = ++this.requestId;
    const request = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Request timeout"));
        }
      }, 10000);

      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  async callTool(toolName: string, args: any): Promise<any> {
    return this.call("tools/call", { name: toolName, arguments: args });
  }

  async readResource(uri: string): Promise<any> {
    return this.call("resources/read", { uri });
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  isConnected(): boolean {
    return this.isInitialized && this.process !== null;
  }
}
