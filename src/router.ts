import path from "node:path";
import { listResources, listResourceTemplates, readResource } from "./resources/index.js";
import { SessionContext, findContainingRoot, inferRepoFromSession, isPathWithinRoots } from "./mcp/session.js";
import { logger } from "./utils/logger.js";
import { getPrompt, listPrompts } from "./prompts/registry.js";
import { TOOL_DEFINITIONS } from "./tools/schemas.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { VectorStore } from "./types.js";
import { handleMemoryStore } from "./tools/memory.store.js";
import { handleMemoryUpdate } from "./tools/memory.update.js";
import { handleMemorySearch } from "./tools/memory.search.js";
import { handleMemorySummarize } from "./tools/memory.summarize.js";
import { handleMemorySynthesize } from "./tools/memory.synthesize.js";
import { handleMemoryDelete } from "./tools/memory.delete.js";
import { handleMemoryBulkDelete } from "./tools/memory.bulk-delete.js";
import { handleMemoryRecap } from "./tools/memory.recap.js";
import { handleMemoryAcknowledge } from "./tools/memory.acknowledge.js";
import {
  handleTaskList,
  handleTaskCreate,
  handleTaskCreateInteractive,
  handleTaskUpdate,
  handleTaskDelete,
} from "./tools/task.manage.js";
import { handleTaskBulkManage } from "./tools/task.bulk-manage.js";
import { SamplingRequestHandler } from "./mcp/sampling.js";
import { ElicitationRequestHandler } from "./mcp/elicitation.js";
import { getLogLevel, LOG_LEVEL_VALUES, setLogLevel } from "./utils/logger.js";

type RouterOptions = {
  getSessionContext?: () => SessionContext;
  sampleMessage?: SamplingRequestHandler;
  elicit?: ElicitationRequestHandler;
  onResourcesMutated?: (uris: string[]) => void;
};

export function createRouter(
  db: SQLiteStore,
  vectors: VectorStore,
  options?: RouterOptions
): (method: string, params: any, signal?: AbortSignal, onProgress?: (progress: number, total?: number) => void) => Promise<any> {
  const getSessionContext = options?.getSessionContext;

  async function handleMethod(method: string, params: any, signal?: AbortSignal, onProgress?: (progress: number, total?: number) => void): Promise<any> {
    switch (method) {
      // ---- tools ----
      case "tools/list":
        return listTools(getSessionContext?.(), params);

      case "tools/call":
        return await handleToolCall(params, signal, onProgress);

      // ---- resources ----
      case "resources/list":
        return listResources(getSessionContext?.(), params);

      case "resources/templates/list":
        return listResourceTemplates(params);

      case "resources/read":
        return readResource(params?.uri, db, getSessionContext?.());

      // ---- prompts ----
      case "prompts/list":
        return listPrompts(db, getSessionContext?.(), params);

      case "logging/setLevel": {
        const requestedLevel = typeof params?.level === "string" ? params.level : "";
        const previousLevel = getLogLevel();
        const level = setLogLevel(requestedLevel);
        return {
          level,
          supportedLevels: LOG_LEVEL_VALUES,
          previousLevel,
        };
      }

      case "prompts/get": {
        return getPrompt(params?.name, params?.arguments || {}, db, getSessionContext?.());
      }

      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  async function handleToolCall(params: any, signal?: AbortSignal, onProgress?: (progress: number, total?: number) => void): Promise<any> {
    const { name } = params;
    const args = normalizeToolArguments(params?.arguments, getSessionContext?.());
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

      case "memory-synthesize":
        result = await handleMemorySynthesize(args, db, vectors, {
          session: getSessionContext?.(),
          sampleMessage: options?.sampleMessage,
          elicit: options?.elicit,
        });
        break;

      case "memory-delete":
        result = await handleMemoryDelete(args, db, vectors);
        break;

      case "memory-bulk-delete":
        result = await handleMemoryBulkDelete(args, db, vectors, onProgress);
        break;

      case "task-create":
        result = await handleTaskCreate(args, db);
        break;

      case "task-create-interactive":
        result = await handleTaskCreateInteractive(args, db, {
          session: getSessionContext?.(),
          elicit: options?.elicit,
        });
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
        result = await handleTaskBulkManage(args, db, vectors, onProgress);
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

    const affectedResources = collectAffectedResourceUris(toolName, args, result);
    if (affectedResources.length > 0) {
      options?.onResourcesMutated?.(affectedResources);
    }

    return result;
  }

  return handleMethod;
}

function listTools(session: SessionContext | undefined, params: any) {
  const tools = getAvailableToolDefinitions(session);
  const limit = normalizePageLimit(params?.limit, tools.length || 1);
  const start = decodeCursor(params?.cursor);
  const page = tools.slice(start, start + limit);
  const nextCursor = start + limit < tools.length ? encodeCursor(start + limit) : undefined;

  return {
    tools: page,
    nextCursor,
  };
}

function getAvailableToolDefinitions(session?: SessionContext) {
  return TOOL_DEFINITIONS.filter((tool) => {
    if (tool.name === "memory-synthesize" && !session?.supportsSampling) {
      return false;
    }

    if (tool.name === "task-create-interactive" && !session?.supportsElicitationForm) {
      return false;
    }

    return true;
  });
}

function collectAffectedResourceUris(toolName: string, args: any, result: any): string[] {
  const repo = args?.repo || args?.scope?.repo || result?.data?.repo;
  const uris = new Set<string>();

  const touchesMemory = toolName.startsWith("memory-")
    || toolName === "task-update"
    || toolName === "task-bulk-manage"
    || toolName === "task-delete";
  const touchesTasks = toolName.startsWith("task-");

  if (touchesMemory) {
    uris.add("memory://index");
    if (repo) {
      uris.add(`memory://index?repo=${encodeURIComponent(repo)}`);
      uris.add(`memory://summary/${repo}`);
    }
  }

  if (touchesTasks && repo) {
    uris.add(`tasks://current?repo=${encodeURIComponent(repo)}`);
  }

  const memoryId = args?.id || args?.memory_id || result?.data?.id;
  if (typeof memoryId === "string" && /^[0-9a-f-]{36}$/i.test(memoryId) && toolName.startsWith("memory-")) {
    uris.add(`memory://${memoryId}`);
  }

  return [...uris];
}

function normalizeToolArguments(args: any, session?: SessionContext): any {
  if (!args || typeof args !== "object") {
    return args;
  }

  const nextArgs = {
    ...args,
    scope: args.scope ? { ...args.scope } : undefined,
  };

  validateRootBoundPath(nextArgs.current_file_path, "current_file_path", session);
  validateRootBoundPath(nextArgs.doc_path, "doc_path", session);

  if (!nextArgs.repo) {
    nextArgs.repo = inferRepoFromSession(session);
  }

  if (nextArgs.scope && !nextArgs.scope.repo) {
    nextArgs.scope.repo = nextArgs.repo ?? inferRepoFromSession(session);
  }

  if (typeof nextArgs.current_file_path === "string" && nextArgs.scope) {
    const containingRoot = path.isAbsolute(nextArgs.current_file_path)
      ? findContainingRoot(nextArgs.current_file_path, session)
      : null;

    if (containingRoot) {
      const relativePath = path.relative(containingRoot, path.resolve(nextArgs.current_file_path));
      const relativeFolder = path.dirname(relativePath);
      if (relativeFolder && relativeFolder !== "." && !nextArgs.scope.folder) {
        nextArgs.scope.folder = relativeFolder;
      }
    }
  }

  return nextArgs;
}

function validateRootBoundPath(value: unknown, field: string, session?: SessionContext): void {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    return;
  }

  if (!isPathWithinRoots(value, session)) {
    throw new Error(`${field} must stay within the active MCP roots`);
  }
}

function normalizePageLimit(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return Math.max(1, fallback);
  }

  return Math.min(value, 100);
}

function encodeCursor(offset: number) {
  return Buffer.from(String(offset), "utf8").toString("base64");
}

function decodeCursor(cursor: unknown) {
  if (typeof cursor !== "string" || !cursor) return 0;

  try {
    const decoded = Number(Buffer.from(cursor, "base64").toString("utf8"));
    return Number.isInteger(decoded) && decoded >= 0 ? decoded : 0;
  } catch {
    return 0;
  }
}
