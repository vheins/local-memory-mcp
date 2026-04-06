import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import path from "path";
import { fileURLToPath } from "url";
import { MCP_PROTOCOL_VERSION } from "../capabilities.js";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Exponential backoff delays in ms: 1s, 2s, 4s
const RETRY_DELAYS = [1000, 2000, 4000];
const MAX_RETRIES = 3;
const MAX_RESTARTS = 3;
const REQUEST_TIMEOUT_MS = 10000;

export class MCPClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  private isInitialized = false;
  private serverPathOverride?: string;
  private restartCount = 0;

  constructor(serverPath?: string) {
    this.serverPathOverride = serverPath;
  }

  async start() {
    if (this.process) return;

    const serverPath =
      this.serverPathOverride || path.join(__dirname, "../server.js");
    this.process = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error("Failed to spawn MCP server");
    }

    // Listen for unexpected process exit and auto-restart
    this.process.on("close", (code) => {
      if (this.process === null) {
        // Intentional stop — do not restart
        return;
      }
      logger.error("MCP server process closed unexpectedly", { code, restartCount: this.restartCount });
      this.process = null;
      this.isInitialized = false;

      if (this.restartCount < MAX_RESTARTS) {
        this.restartCount++;
        logger.info("Attempting to restart MCP server", { attempt: this.restartCount });
        this.start().catch((err) => {
          logger.error("Failed to restart MCP server", { error: String(err) });
        });
      } else {
        logger.error("Max restart attempts reached, giving up", { maxRestarts: MAX_RESTARTS });
      }
    });

    const rl = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
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
        logger.error("Failed to parse MCP response", { error: String(err) });
      }
    });

    await this.callWithRetry("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mcp-client", version: "1.0.0" },
    });

    if (this.process?.stdin) {
      this.process.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }) + "\n");
    }

    this.isInitialized = true;
  }

  /**
   * Send a single request without retry. Returns a Promise that rejects on timeout.
   */
  private callOnce(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.process || !this.process.stdin) {
      return Promise.reject(new Error("MCP server not started"));
    }

    const id = ++this.requestId;
    const request = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          // Delete entry to prevent memory leak (Req 18.4)
          this.pendingRequests.delete(id);
          reject(new Error("Request timeout"));
        }
      }, REQUEST_TIMEOUT_MS);

      // Ensure timer doesn't keep the process alive
      if (timer.unref) timer.unref();

      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  /**
   * Call with retry on timeout — up to MAX_RETRIES retries with exponential backoff.
   * Req 18.1: retry up to 3x with delays 1s, 2s, 4s.
   */
  private async callWithRetry(method: string, params: unknown = {}): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.callOnce(method, params);
      } catch (err) {
        lastError = err;
        const isTimeout =
          err instanceof Error && err.message === "Request timeout";

        if (!isTimeout || attempt === MAX_RETRIES) {
          // Non-timeout error or exhausted retries — propagate
          logger.error("MCP request failed", {
            method,
            attempt,
            error: String(err),
          });
          throw err;
        }

        const delay = RETRY_DELAYS[attempt];
        logger.warn("MCP request timed out, retrying", {
          method,
          attempt: attempt + 1,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }

    throw lastError;
  }

  async call(method: string, params: unknown = {}): Promise<unknown> {
    return this.callWithRetry(method, params);
  }

  async callTool(toolName: string, args: unknown): Promise<unknown> {
    return this.call("tools/call", { name: toolName, arguments: args });
  }

  async readResource(uri: string): Promise<unknown> {
    return this.call("resources/read", { uri });
  }

  /**
   * Stop the client: reject all pending requests, then kill the process.
   * Req 18.3: reject all pending requests with "Client stopped".
   */
  stop() {
    // Reject all pending requests before killing the process
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error("Client stopped"));
      this.pendingRequests.delete(id);
    }

    if (this.process) {
      // Set to null BEFORE kill so the 'close' handler knows it was intentional
      const proc = this.process;
      this.process = null;
      this.isInitialized = false;
      proc.kill();
    }
  }

  isConnected(): boolean {
    return this.isInitialized && this.process !== null;
  }

  /**
   * Returns the number of requests currently awaiting a response.
   * Req 18.5
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
