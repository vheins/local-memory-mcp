import { listResources, readResource } from "./resources/index.js";
import { PROMPTS } from "./prompts/registry.js";
import { TOOL_DEFINITIONS } from "./tools/schemas.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { StubVectorStore } from "./storage/vectors.stub.js";
import { handleMemoryStore } from "./tools/memory.store.js";
import { handleMemoryUpdate } from "./tools/memory.update.js";
import { handleMemorySearch } from "./tools/memory.search.js";
import { handleMemorySummarize } from "./tools/memory.summarize.js";
import { handleMemoryDelete } from "./tools/memory.delete.js";

// Initialize storage
const db = new SQLiteStore();
const vectors = new StubVectorStore();

export async function handleMethod(method: string, params: any) {
  switch (method) {
    // ---- tools ----
    case "tools/list":
      return { tools: TOOL_DEFINITIONS };

    case "tools/call":
      return await handleToolCall(params);

    // ---- resources ----
    case "resources/list":
      return listResources();

    case "resources/read":
      return readResource(params?.uri, db);

    // ---- prompts ----
    case "prompts/list":
      return { prompts: Object.values(PROMPTS) };

    case "prompts/get":
      const prompt = PROMPTS[params?.name as keyof typeof PROMPTS];
      if (!prompt) {
        throw new Error(`Unknown prompt: ${params?.name}`);
      }
      return prompt;

    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

async function handleToolCall(params: any): Promise<any> {
  const { name, arguments: args } = params;

  switch (name) {
    case "memory-store":
      return await handleMemoryStore(args, db, vectors);

    case "memory-update":
      return await handleMemoryUpdate(args, db, vectors);

    case "memory-search":
      return await handleMemorySearch(args, db, vectors);

    case "memory-summarize":
      return await handleMemorySummarize(args, db);

    case "memory-delete":
      return await handleMemoryDelete(args, db, vectors);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Cleanup on exit
process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  db.close();
  process.exit(0);
});
