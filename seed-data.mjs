#!/usr/bin/env node
import { spawn } from "child_process";
import { createInterface } from "readline";

const serverPath = "./dist/server.js";
const serverProcess = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "inherit"]
});

let requestId = 0;
const pendingRequests = new Map();

const rl = createInterface({
  input: serverProcess.stdout,
  crlfDelay: Infinity
});

rl.on("line", (line) => {
  try {
    const response = JSON.parse(line);
    if (!response.id) return;
    
    const pending = pendingRequests.get(response.id);
    if (pending) {
      pendingRequests.delete(response.id);
      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  } catch (err) {
    console.error("Parse error:", err);
  }
});

function call(method, params = {}) {
  const id = ++requestId;
  const request = { jsonrpc: "2.0", id, method, params };
  
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    serverProcess.stdin.write(JSON.stringify(request) + "\n");
    
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Timeout"));
      }
    }, 5000);
  });
}

async function main() {
  try {
    // Initialize
    await call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "seed", version: "1.0" }
    });

    console.log("Adding sample memories...");

    // Add sample memories
    const memories = [
      {
        type: "decision",
        content: "Use TypeScript for all new backend services. Static typing reduces bugs and improves maintainability.",
        importance: 5,
        scope: { repo: "backend-api" }
      },
      {
        type: "mistake",
        content: "Don't use ORM queries in loops - causes N+1 query problem. Always use batch loading or raw SQL with joins.",
        importance: 4,
        scope: { repo: "backend-api", language: "typescript" }
      },
      {
        type: "code_fact",
        content: "Authentication is handled by JWT middleware in src/middleware/auth.ts. Token validation uses RS256 algorithm.",
        importance: 3,
        scope: { repo: "backend-api", folder: "src/middleware" }
      },
      {
        type: "pattern",
        content: "All API responses follow the format: { success: boolean, data?: any, error?: string }. Maintain consistency.",
        importance: 4,
        scope: { repo: "backend-api" }
      },
      {
        type: "decision",
        content: "Frontend uses React with TypeScript and Material-UI for component library. No class components allowed.",
        importance: 5,
        scope: { repo: "frontend-app", language: "typescript" }
      },
      {
        type: "mistake",
        content: "Never store sensitive data in localStorage - use httpOnly cookies instead. localStorage is vulnerable to XSS.",
        importance: 5,
        scope: { repo: "frontend-app" }
      },
      {
        type: "code_fact",
        content: "Database migrations are in migrations/ directory. Run 'npm run migrate' to apply. Never edit migration history.",
        importance: 3,
        scope: { repo: "backend-api", folder: "migrations" }
      },
      {
        type: "pattern",
        content: "Error handling follows try-catch pattern with specific error types. Always log errors before rethrowing.",
        importance: 3,
        scope: { repo: "backend-api" }
      },
      {
        type: "decision",
        content: "Use Docker for development environments. docker-compose.yml defines all services. No local installs.",
        importance: 4,
        scope: { repo: "devops" }
      },
      {
        type: "code_fact",
        content: "CI/CD pipeline uses GitHub Actions. Deploy to staging on merge to main, production requires manual approval.",
        importance: 3,
        scope: { repo: "devops" }
      }
    ];

    for (const memory of memories) {
      try {
        const result = await call("tools/call", {
          name: "memory.store",
          arguments: memory
        });
        console.log(`✓ Added: ${memory.content.substring(0, 50)}...`);
      } catch (err) {
        console.error(`✗ Failed to add: ${memory.content.substring(0, 50)}...`, err.message);
      }
    }

    console.log("\nSample data added successfully!");
    serverProcess.kill();
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    serverProcess.kill();
    process.exit(1);
  }
}

main();
