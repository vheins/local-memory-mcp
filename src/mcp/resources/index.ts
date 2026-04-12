import { SQLiteStore } from "../storage/sqlite.js";
import { SessionContext } from "../session.js";
import { logger } from "../utils/logger.js";
import { rankCompletionValues } from "../utils/completion.js";
import { decodeCursor, encodeCursor } from "../utils/pagination.js";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export function listResources(session?: SessionContext, params?: { cursor?: string; limit?: number }) {
  const resources = [
    {
      uri: "memory://memories",
      name: "Memories",
      title: "Memories",
      description: "List of all active memory entries across projects",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.85,
        lastModified: new Date().toISOString(),
      },
    },
    {
      uri: "tasks://tasks",
      name: "Tasks",
      title: "Tasks",
      description: "List of all active tasks across projects",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.8,
        lastModified: new Date().toISOString(),
      },
    },
    {
      uri: "action://actions",
      name: "Audit Log (Actions)",
      title: "Audit Log",
      description: "Audit trail of tool interactions and agent decisions",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.6,
        lastModified: new Date().toISOString(),
      },
    },
    {
      uri: "session://roots",
      name: "Session Roots",
      title: "Session Roots",
      description: session?.roots.length
        ? "Active workspace roots provided by the MCP client"
        : "No active workspace roots were provided by the MCP client",
      mimeType: "application/json",
      size: Buffer.byteLength(JSON.stringify({ roots: session?.roots ?? [] }), "utf8"),
      annotations: {
        audience: ["assistant"],
        priority: 1,
        lastModified: new Date().toISOString(),
      },
    }
  ];

  return paginateEntries("resources", resources, params);
}

export function listResourceTemplates(params?: { cursor?: string; limit?: number }) {
  const templates = [
    {
      uriTemplate: "memory://memories/{id}",
      name: "Memory Detail",
      title: "Memory Detail",
      description: "Full content and statistics for a specific memory UUID",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.75,
      },
    },
    {
      uriTemplate: "memory://memories?repo={repo}&type={type}&tag={tag}&archived={archived}",
      name: "Filtered Memories",
      title: "Filtered Memories",
      description: "Filter memories by repository, type, tag, or archival status",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.7,
      },
    },
    {
      uriTemplate: "memory://memories/search/{base64_query}?repo={repo}",
      name: "Memories Search",
      title: "Memories Search",
      description: "Run a semantic search over memories using a base64-encoded query",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.65,
      },
    },
    {
      uriTemplate: "memory://repositories/{repo}/summary",
      name: "Project Summary",
      title: "Project Summary",
      description: "High-level summary of architectural decisions for a repository",
      mimeType: "text/plain",
      annotations: {
        audience: ["assistant"],
        priority: 0.95,
      },
    },
    {
      uriTemplate: "tasks://tasks/{id}",
      name: "Task Detail",
      title: "Task Detail",
      description: "Full content and comments for a specific task UUID",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.8,
      },
    },
    {
      uriTemplate: "tasks://tasks?repo={repo}&status={status}&priority={priority}",
      name: "Filtered Tasks",
      title: "Filtered Tasks",
      description: "Filter tasks by repository, status, or priority level",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.9,
      },
    },
    {
      uriTemplate: "action://actions?repo={repo}&action={action}",
      name: "Filtered Actions",
      title: "Filtered Actions",
      description: "Filter audit logs by repository or action type",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.6,
      },
    }
  ];

  return paginateEntries("resourceTemplates", templates, params);
}

export function completeResourceArgument(
  resourceUri: string,
  argumentName: string,
  argumentValue: string,
  _contextArguments: Record<string, unknown>,
  dataSources: {
    repos: string[];
    tags: string[];
  },
) {
  // Repo Autocomplete
  if (
    resourceUri === "memory://memories?repo={repo}&type={type}&tag={tag}&archived={archived}"
    || resourceUri === "memory://memories/search/{base64_query}?repo={repo}"
    || resourceUri === "memory://repositories/{repo}/summary"
    || resourceUri === "tasks://tasks?repo={repo}&status={status}&priority={priority}"
    || resourceUri === "action://actions?repo={repo}&action={action}"
  ) {
    if (argumentName === "repo") {
      return rankCompletionValues(dataSources.repos, argumentValue);
    }
  }

  // Tag Autocomplete
  if (resourceUri === "memory://memories?repo={repo}&type={type}&tag={tag}&archived={archived}") {
    if (argumentName === "tag") {
      return rankCompletionValues(dataSources.tags, argumentValue);
    }
  }

  throw invalidCompletionParams(`Unknown resource template or argument: ${resourceUri} (${argumentName})`);
}

export function readResource(uri: string, db: SQLiteStore, session?: SessionContext) {
  logger.info("[MCP] resource.read", { uri });

  // 1. Session Roots
  if (uri === "session://roots") {
    const payload = JSON.stringify({ roots: session?.roots ?? [] }, null, 2);
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: payload,
        size: Buffer.byteLength(payload, "utf8"),
        annotations: {
          audience: ["assistant"],
          priority: 1,
          lastModified: new Date().toISOString(),
        },
      }]
    };
  }

  // 2. Repo Summary: memory://repositories/{repo}/summary
  if (uri.startsWith("memory://repositories/")) {
    const repo = uri.replace("memory://repositories/", "").replace("/summary", "");
    const summary = db.summaries.getSummary(repo);
    const text = summary?.summary || `No summary available for repository: ${repo}`;

    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text,
        size: Buffer.byteLength(text, "utf8"),
        annotations: {
          audience: ["assistant"],
          priority: 0.95,
          lastModified: summary?.updated_at || new Date().toISOString(),
        },
      }]
    };
  }

  // 3. Task Detail: tasks://tasks/{id}
  const taskIdMatch = uri.match(/^tasks:\/\/tasks\/([0-9a-f-]{36})$/i);
  if (taskIdMatch) {
    const id = taskIdMatch[1];
    const task = db.tasks.getTaskById(id);
    if (!task) throw resourceNotFound(`Task with ID ${id} not found.`, uri);

    const payload = JSON.stringify(task, null, 2);
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: payload,
        size: Buffer.byteLength(payload, "utf8"),
        annotations: {
          audience: ["assistant"],
          priority: 0.8,
          lastModified: task.updated_at || task.created_at,
        },
      }]
    };
  }

  // 4. Task List/Filter: tasks://tasks[?params]
  if (uri === "tasks://tasks" || uri.startsWith("tasks://tasks?")) {
    const parsed = new URL(uri.replace("tasks://", "http://task/"));
    const repo = parsed.searchParams.get("repo") || "";
    const status = parsed.searchParams.get("status");
    const priority = parsed.searchParams.get("priority");

    let tasks: Task[];
    if (repo && !status) {
      // Default to active tasks if no status provided (matches legacy tasks://current)
      tasks = db.tasks.getTasksByMultipleStatuses(repo, ["backlog", "pending", "in_progress", "blocked"]);
    } else if (repo) {
      tasks = db.tasks.getTasksByRepo(repo);
    } else {
      tasks = db.tasks.listRecentTasks(50);
    }

    if (status && status !== "all") {
      tasks = tasks.filter(t => t.status === status);
    }
    if (priority) {
      tasks = tasks.filter(t => t.priority === (isNaN(Number(priority)) ? t.priority : Number(priority)));
    }

    const payload = JSON.stringify(tasks, null, 2);
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: payload,
        size: Buffer.byteLength(payload, "utf8"),
        annotations: {
          audience: ["assistant"],
          priority: repo ? 0.9 : 0.7,
          lastModified: deriveLastModifiedFromCollection(tasks.map(t => t.updated_at)),
        },
      }]
    };
  }

  // 5. Memory Detail: memory://memories/{id}
  const memoryIdMatch = uri.match(/^memory:\/\/memories\/([0-9a-f-]{36})$/i);
  if (memoryIdMatch) {
    const id = memoryIdMatch[1];
    const entry = db.memories.getByIdWithStats(id);
    if (!entry) throw resourceNotFound(`Memory with ID ${id} not found.`, uri);

    const payload = JSON.stringify(entry, null, 2);
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: payload,
        size: Buffer.byteLength(payload, "utf8"),
        annotations: {
          audience: ["assistant"],
          priority: 0.75,
          lastModified: entry.updated_at || entry.created_at,
        },
      }]
    };
  }

  // 6. Memory List/Filter: memory://memories[?params]
  if (uri === "memory://memories" || uri.startsWith("memory://memories?")) {
    const parsed = new URL(uri.replace("memory://", "http://memory/"));
    const repo = parsed.searchParams.get("repo") || "";
    const type = parsed.searchParams.get("type");
    const tag = parsed.searchParams.get("tag");
    const includeArchived = parsed.searchParams.get("archived") === "true";

    const result = db.memories.listMemoriesForDashboard({ 
      repo: repo || undefined,
      type: type || undefined,
      tag: tag || undefined,
      includeArchived,
      limit: 50
    });
    const entries = result.items;

    const payload = JSON.stringify(entries, null, 2);
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: payload,
        size: Buffer.byteLength(payload, "utf8"),
        annotations: {
          audience: ["assistant"],
          priority: repo ? 0.85 : 0.7,
          lastModified: deriveLastModifiedFromCollection(entries.map((e: any) => e.updated_at || e.created_at)),
        },
      }]
    };
  }

  // 7. Memory Search: memory://memories/search/{query}[?repo]
  if (uri.startsWith("memory://memories/search/")) {
    const parts = uri.replace("memory://memories/search/", "").split('?');
    const encodedQuery = parts[0];
    const query = Buffer.from(encodedQuery, 'base64').toString('utf-8');
    const parsed = new URL("http://memory/" + (parts[1] || ""));
    const repo = parsed.searchParams.get("repo") || "";
    
    const results = db.memories.searchBySimilarity(query, repo, 10);
    const payload = JSON.stringify({ query, repo, results }, null, 2);
    
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: payload,
        size: Buffer.byteLength(payload, "utf8"),
        annotations: {
          audience: ["assistant"],
          priority: 0.65,
          lastModified: deriveLastModifiedFromCollection(results.map((e: any) => e.updated_at || e.created_at)),
        },
      }]
    };
  }

  // 8. Action List: action://actions[?params]
  if (uri === "action://actions" || uri.startsWith("action://actions?")) {
    const parsed = new URL(uri.replace("action://", "http://action/"));
    const repo = parsed.searchParams.get("repo") || "";
    const actionType = parsed.searchParams.get("action");

    const actions = db.actions.getRecentActions(repo || undefined, 100);
    const payload = JSON.stringify(actions, null, 2);

    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: payload,
        size: Buffer.byteLength(payload, "utf8"),
        annotations: {
          audience: ["assistant"],
          priority: 0.6,
          lastModified: deriveLastModifiedFromCollection(actions.map(a => a.created_at)),
        },
      }]
    };
  }

  throw resourceNotFound(`Unknown resource URI: ${uri}`, uri);
}

function paginateEntries<T extends object>(key: "resources" | "resourceTemplates", entries: T[], params?: { cursor?: string; limit?: number }) {
  const limit = normalizeLimit(params?.limit);
  const offset = decodeCursor(params?.cursor);
  const sliced = entries.slice(offset, offset + limit);
  const nextOffset = offset + sliced.length;

  return {
    [key]: sliced,
    nextCursor: nextOffset < entries.length ? encodeCursor(nextOffset) : undefined,
  };
}

function normalizeLimit(limit: unknown) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(limit)));
}

function deriveLastModifiedFromCollection(values: Array<string | undefined | null>) {
  const normalized = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  return normalized.sort().at(-1) ?? new Date().toISOString();
}

function resourceNotFound(message: string, uri: string) {
  const error = new Error(message) as Error & { code: number; data?: Record<string, unknown> };
  error.code = -32002;
  error.data = { uri };
  return error;
}

function invalidCompletionParams(message: string) {
  const error = new Error(message) as Error & { code: number };
  error.code = -32602;
  return error;
}
