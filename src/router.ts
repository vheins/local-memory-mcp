import { listResources, readResource } from "./resources/index.js";
import { logger } from "./utils/logger.js";
import { PROMPTS } from "./prompts/registry.js";
import { TOOL_DEFINITIONS } from "./tools/schemas.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { VectorStore } from "./types.js";
import { handleMemoryStore } from "./tools/memory.store.js";
import { handleMemoryUpdate } from "./tools/memory.update.js";
import { handleMemorySearch } from "./tools/memory.search.js";
import { handleMemorySummarize } from "./tools/memory.summarize.js";
import { handleMemoryDelete } from "./tools/memory.delete.js";
import { handleMemoryBulkDelete } from "./tools/memory.bulk-delete.js";
import { handleMemoryRecap } from "./tools/memory.recap.js";
import { handleMemoryAcknowledge } from "./tools/memory.acknowledge.js";
import { handleTaskList, handleTaskCreate, handleTaskUpdate, handleTaskDelete } from "./tools/task.manage.js";
import { handleTaskBulkManage } from "./tools/task.bulk-manage.js";

export function createRouter(
  db: SQLiteStore,
  vectors: VectorStore
): (method: string, params: any, signal?: AbortSignal) => Promise<any> {
  async function handleMethod(method: string, params: any, signal?: AbortSignal): Promise<any> {
    switch (method) {
      // ---- tools ----
      case "tools/list":
        return { tools: TOOL_DEFINITIONS };

      case "tools/call":
        return await handleToolCall(params, signal);

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

        // Clone to avoid modifying the original registry
        const result = JSON.parse(JSON.stringify(prompt));
        const args = params?.arguments || {};

        // Simple template substitution
        result.messages = result.messages.map((msg: any) => {
          if (msg.content && msg.content.type === "text") {
            let text = msg.content.text;
            for (const [key, value] of Object.entries(args)) {
              const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, "g");
              text = text.replace(placeholder, String(value));
            }
            return { ...msg, content: { ...msg.content, text } };
          }
          return msg;
        });

        return result;
      }

      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  async function handleToolCall(params: any, signal?: AbortSignal): Promise<any> {
    const { name, arguments: args } = params;
    // Normalize tool naming: accept both dot (memory.store) and hyphen (memory-store)
    const toolName = String(name).replace(/\./g, "-");

    let result: any;
    let repo = args?.repo || args?.scope?.repo || "unknown";

    switch (toolName) {
      case "memory-store":
        result = await handleMemoryStore(args, db, vectors);
        break;

      case "memory-acknowledge":
        result = await handleMemoryAcknowledge(args, db);
        break;

      case "memory-update":
        result = await handleMemoryUpdate(args, db, vectors);
        break;

      case "memory-recap":
        result = await handleMemoryRecap(args, db);
        break;

      case "memory-search":
        result = await handleMemorySearch(args, db, vectors);
        break;

      case "memory-summarize":
        result = await handleMemorySummarize(args, db);
        break;

      case "memory-delete":
        result = await handleMemoryDelete(args, db, vectors);
        break;

      case "memory-bulk-delete":
        result = await handleMemoryBulkDelete(args, db, vectors);
        break;

      case "task-create":
        result = await handleTaskCreate(args, db);
        break;

      case "task-update":
        result = await handleTaskUpdate(args, db, vectors);
        break;

      case "task-delete":
        result = await handleTaskDelete(args, db);
        break;

      case "task-list":
        result = await handleTaskList(args, db);
        break;

      case "task-search":
        // Map 'query' to 'search' and set default status if not provided
        const searchArgs = { ...args, search: args.query };
        if (!searchArgs.status) searchArgs.status = "all";
        result = await handleTaskList(searchArgs, db);
        break;

      case "task-bulk-manage":
        result = await handleTaskBulkManage(args, db, vectors);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Log the action
    try {
      const actionType = toolName.split("-")[1] || toolName;
      const options: any = {
        query: args?.query || args?.title || args?.task_code || (toolName === 'memory-recap' ? `Offset: ${args?.offset || 0}` : undefined),
        response: result,
        memoryId: args?.id || args?.memory_id || (result?.data?.id),
        taskId: args?.id || args?.task_id || (result?.data?.id),
        resultCount: Array.isArray(result?.data?.results) ? result.data.results.length : (result?.data?.count || 0)
      };
      
      db.logAction(actionType, repo, options);
    } catch (e) {
      logger.error("Failed to log action", { toolName, error: String(e) });
    }

    return result;
  }

  return handleMethod;
}
