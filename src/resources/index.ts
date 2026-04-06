import { SQLiteStore } from "../storage/sqlite.js";
import { SessionContext } from "../mcp/session.js";
import { logger } from "../utils/logger.js";
import { rankCompletionValues } from "../utils/completion.js";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export function listResources(session?: SessionContext, params?: { cursor?: string; limit?: number }) {
  const resources = [
    {
      uri: "memory://index",
      name: "Active Memory Index",
      title: "Active Memory Index",
      description: "List of all active memory entries across projects",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.85,
        lastModified: new Date().toISOString(),
      },
    },
    {
      uri: "memory://{id}",
      name: "Memory Detail",
      title: "Memory Detail",
      description: "Full content and statistics for a specific memory UUID",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.7,
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
      uriTemplate: "memory://index?repo={repo}",
      name: "Project Memory Index",
      title: "Project Memory Index",
      description: "Metadata for all active memories in a specific project",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.7,
      },
    },
    {
      uriTemplate: "memory://tags/{tag}",
      name: "Memories by Tech Stack",
      title: "Memories by Tech Stack",
      description: "Retrieve best practices and decisions by technology tag (e.g., filament, react)",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.55,
      },
    },
    {
      uriTemplate: "memory://summary/{repo}",
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
      uriTemplate: "tasks://current?repo={repo}",
      name: "Current Tasks",
      title: "Current Tasks",
      description: "List of all active tasks (pending, in_progress, blocked) for a specific project",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.9,
      },
    },
    {
      uriTemplate: "memory://search/{base64_query}?repo={repo}",
      name: "Semantic Memory Search",
      title: "Semantic Memory Search",
      description: "Run a semantic search over memories using a base64-encoded query",
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
  if (
    resourceUri === "memory://index?repo={repo}"
    || resourceUri === "memory://summary/{repo}"
    || resourceUri === "tasks://current?repo={repo}"
  ) {
    if (argumentName !== "repo") {
      throw invalidCompletionParams(`Unknown resource argument "${argumentName}" for "${resourceUri}"`);
    }
    return rankCompletionValues(dataSources.repos, argumentValue);
  }

  if (resourceUri === "memory://tags/{tag}") {
    if (argumentName !== "tag") {
      throw invalidCompletionParams(`Unknown resource argument "${argumentName}" for "${resourceUri}"`);
    }
    return rankCompletionValues(dataSources.tags, argumentValue);
  }

  throw invalidCompletionParams(`Unknown resource template: ${resourceUri}`);
}

export function readResource(uri: string, db: SQLiteStore, session?: SessionContext) {
  logger.info("[MCP] resource.read", { uri });

  if (uri === "session://roots") {
    const payload = JSON.stringify({ roots: session?.roots ?? [] }, null, 2);
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: payload,
          size: Buffer.byteLength(payload, "utf8"),
          annotations: {
            audience: ["assistant"],
            priority: 1,
            lastModified: new Date().toISOString(),
          },
        }
      ]
    };
  }

  // 6. Current Tasks: tasks://current?repo={repo}
  if (uri.startsWith("tasks://current?")) {
    const parsed = new URL(uri.replace("tasks://", "http://tasks/"));
    const repo = parsed.searchParams.get("repo");
    if (!repo) throw resourceNotFound("Repo parameter is required for tasks://current", uri);
    
    const tasks = db.getTasksByRepo(repo).filter(t => ["backlog", "pending", "in_progress", "blocked"].includes(t.status));
    const payload = JSON.stringify(tasks, null, 2);

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: payload,
          size: Buffer.byteLength(payload, "utf8"),
          annotations: {
            audience: ["assistant"],
            priority: 0.9,
            lastModified: deriveLastModifiedFromCollection(tasks.map((task) => task.updated_at)),
          },
        }
      ]
    };
  }

  // 1. Index Resource (Repo specific or Global)
  if (uri === "memory://index" || uri.startsWith("memory://index?")) {
    const parsed = new URL(uri.replace("memory://", "http://memory/"));
    const repo = parsed.searchParams.get("repo");
    const includeArchived = parsed.searchParams.get("archived") === "true";

    const entries = repo
      ? db.searchByRepo(repo, { limit: 50, includeArchived })
      : db.listRecent(50);
    const payload = JSON.stringify(entries, null, 2);

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: payload,
          size: Buffer.byteLength(payload, "utf8"),
          annotations: {
            audience: ["assistant"],
            priority: repo ? 0.85 : 0.7,
            lastModified: deriveLastModifiedFromCollection(entries.map((entry: any) => entry.updated_at || entry.created_at)),
          },
        }
      ]
    };
  }

  // 2. Tag Affinity Resource: memory://tags/{tag}
  if (uri.startsWith("memory://tags/")) {
    const tag = uri.replace("memory://tags/", "");
    const entries = db.searchByRepo("", { 
      tags: [tag], 
      limit: 50,
      includeArchived: false 
    });
    const payload = JSON.stringify({ tag, count: entries.length, entries }, null, 2);

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: payload,
          size: Buffer.byteLength(payload, "utf8"),
          annotations: {
            audience: ["assistant"],
            priority: 0.55,
            lastModified: deriveLastModifiedFromCollection(entries.map((entry: any) => entry.updated_at || entry.created_at)),
          },
        }
      ]
    };
  }

  // 3. Project Summary: memory://summary/{repo}
  if (uri.startsWith("memory://summary/")) {
    const repo = uri.replace("memory://summary/", "");
    const summary = db.getSummary(repo);
    const text = summary?.summary || `No summary available for repository: ${repo}`;

    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text,
          size: Buffer.byteLength(text, "utf8"),
          annotations: {
            audience: ["assistant"],
            priority: 0.95,
            lastModified: summary?.updated_at || new Date().toISOString(),
          },
        }
      ]
    };
  }

  const idMatch = uri.match(/^memory:\/\/([0-9a-f-]{36})$/i);
  if (idMatch) {
    const id = idMatch[1];
    const entry = db.getByIdWithStats(id);
    
    if (!entry) {
      throw resourceNotFound(`Memory with ID ${id} not found.`, uri);
    }

    const payload = JSON.stringify(entry, null, 2);
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: payload,
          size: Buffer.byteLength(payload, "utf8"),
          annotations: {
            audience: ["assistant"],
            priority: 0.75,
            lastModified: entry.updated_at || entry.created_at,
          },
        }
      ]
    };
  }

  if (uri.startsWith("memory://search/")) {
    const parts = uri.replace("memory://search/", "").split('?');
    const encodedQuery = parts[0];
    const query = Buffer.from(encodedQuery, 'base64').toString('utf-8');
    
    const parsed = new URL("http://memory/" + (parts[1] || ""));
    const repo = parsed.searchParams.get("repo") || "";
    
    const results = db.searchBySimilarity(query, repo, 10);
    const payload = JSON.stringify({ query, repo, results }, null, 2);
    
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: payload,
          size: Buffer.byteLength(payload, "utf8"),
          annotations: {
            audience: ["assistant"],
            priority: 0.65,
            lastModified: deriveLastModifiedFromCollection(results.map((entry: any) => entry.updated_at || entry.created_at)),
          },
        }
      ]
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

function encodeCursor(offset: number) {
  return Buffer.from(String(offset), "utf8").toString("base64");
}

function decodeCursor(cursor: unknown) {
  if (typeof cursor !== "string" || cursor.trim() === "") {
    return 0;
  }

  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const offset = Number.parseInt(decoded, 10);
    return Number.isFinite(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
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
