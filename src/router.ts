import { listResources, readResource } from "./resources/index.js";
import { PROMPTS } from "./prompts/registry.js";
import { TOOL_DEFINITIONS } from "./tools/schemas.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { VectorStore } from "./types.js";
import { handleMemoryStore } from "./tools/memory.store.js";
import { handleMemoryUpdate } from "./tools/memory.update.js";
import { handleMemorySearch } from "./tools/memory.search.js";
import { handleMemorySummarize } from "./tools/memory.summarize.js";
import { handleMemoryDelete } from "./tools/memory.delete.js";
import { handleMemoryRecap } from "./tools/memory.recap.js";
import { handleMemoryAcknowledge } from "./tools/memory.acknowledge.js";
import { handleTaskManage, handleTaskList } from "./tools/task.manage.js";

export function createRouter(
  db: SQLiteStore,
  vectors: VectorStore
): (method: string, params: any) => Promise<any> {
  async function handleMethod(method: string, params: any): Promise<any> {
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

      case "prompts/get": {
        const prompt = PROMPTS[params?.name as keyof typeof PROMPTS];
        if (!prompt) {
          throw new Error(`Unknown prompt: ${params?.name}`);
        }
        return prompt;
      }

      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  async function handleToolCall(params: any): Promise<any> {
    const { name, arguments: args } = params;
    // Normalize tool naming: accept both dot (memory.store) and hyphen (memory-store)
    const toolName = String(name).replace(/\./g, "-");

    switch (toolName) {
      case "memory-store":
        return await handleMemoryStore(args, db, vectors);

      case "memory-acknowledge":
        return await handleMemoryAcknowledge(args, db);

      case "memory-update":
        return await handleMemoryUpdate(args, db, vectors);

      case "memory-recap":
        return await handleMemoryRecap(args, db);

      case "memory-search":
        return await handleMemorySearch(args, db, vectors);

      case "memory-summarize":
        return await handleMemorySummarize(args, db);

      case "memory-delete":
        return await handleMemoryDelete(args, db, vectors);

      case "task-manage":
        return await handleTaskManage(args, db);

      case "task-list":
        return await handleTaskList(args, db);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  return handleMethod;
}
