#!/usr/bin/env node
import { spawn } from "child_process";
import { createInterface } from "readline";

const serverPath = "./dist/mcp/server.js";
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
  } catch {
    // console.error("Parse error:", err);
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
    }, 10000);
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

    // Send initialized notification
    const initNotify = { jsonrpc: "2.0", method: "notifications/initialized" };
    serverProcess.stdin.write(JSON.stringify(initNotify) + "\n");
    
    // Give it a moment to process initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

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
      }
    ];

    for (const memory of memories) {
      try {
        await call("tools/call", {
          name: "memory-store",
          arguments: { ...memory, title: memory.type.toUpperCase() + " example", agent: "seeder", model: "seed-script" }
        });
        console.log(`✓ Added memory: ${memory.content.substring(0, 30)}...`);
      } catch (err) {
        console.error(`✗ Failed to add memory: ${memory.content.substring(0, 30)}...`, err.message);
      }
    }

    console.log("\nAdding sample tasks...");
    const ts = Date.now().toString().slice(-4);

    // 1. Create a parent task
    const parentRes = await call("tools/call", {
      name: "task-create",
      arguments: {
        repo: "hierarchy-repo",
        task_code: `ROOT-${ts}`,
        phase: "planning",
        title: "Main System Architecture",
        description: "Design the core architecture for the new system.",
        status: "pending",
        priority: 5,
        agent: "architect",
        role: "architect",
        structured: true
      }
    });
    const parentId = parentRes.structuredContent?.id;
    
    if (!parentId) {
      console.error("Failed to get parentId from response:", JSON.stringify(parentRes));
      throw new Error("Could not extract parentId");
    }
    console.log(`✓ Created Parent Task: ROOT-${ts} (ID: ${parentId})`);

    // 2. Create a child task
    await call("tools/call", {
      name: "task-create",
      arguments: {
        repo: "hierarchy-repo",
        task_code: `CHILD-${ts}`,
        phase: "implementation",
        title: "Database Schema Implementation",
        description: "Implement the database schema based on the architecture.",
        status: "pending",
        priority: 4,
        parent_id: parentId,
        agent: "developer",
        role: "developer"
      }
    });
    console.log(`✓ Created Child Task: CHILD-${ts} (Parent: ROOT-${ts})`);

    // 3. Create a dependency task
    const blockerRes = await call("tools/call", {
      name: "task-create",
      arguments: {
        repo: "hierarchy-repo",
        task_code: `BLOC-${ts}`,
        phase: "infrastructure",
        title: "Setup Database Instance",
        description: "Provision the database instance on cloud.",
        status: "pending",
        priority: 4,
        agent: "devops",
        role: "devops",
        structured: true
      }
    });
    const blockerId = blockerRes.structuredContent?.id;
    
    if (!blockerId) {
       console.error("Failed to get blockerId from response:", JSON.stringify(blockerRes));
       throw new Error("Could not extract blockerId");
    }
    console.log(`✓ Created Blocker Task: BLOC-${ts} (ID: ${blockerId})`);

    // 4. Create a task that depends on the blocker
    await call("tools/call", {
      name: "task-create",
      arguments: {
        repo: "hierarchy-repo",
        task_code: `DEPN-${ts}`,
        phase: "implementation",
        title: "API Connectivity Test",
        description: "Verify that the API can connect to the database.",
        status: "backlog",
        priority: 3,
        depends_on: blockerId,
        agent: "developer",
        role: "developer"
      }
    });
    console.log(`✓ Created Dependent Task: DEPN-${ts} (Depends on: BLOC-${ts})`);

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
