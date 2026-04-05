import { SQLiteStore } from "../storage/sqlite.js";
import { logger } from "../utils/logger.js";

export function listResources() {
  return {
    resources: [
      {
        uri: "memory://index",
        name: "Active Memory Index",
        description: "List of all active memory entries across projects",
        mimeType: "application/json"
      },
      {
        uri: "memory://index?repo={repo}",
        name: "Project Memory Index",
        description: "Metadata for all active memories in a specific project",
        mimeType: "application/json"
      },
      {
        uri: "memory://tags/{tag}",
        name: "Memories by Tech Stack",
        description: "Retrieve best practices and decisions by technology tag (e.g., filament, react)",
        mimeType: "application/json"
      },
      {
        uri: "memory://summary/{repo}",
        name: "Project Summary",
        description: "High-level summary of architectural decisions for a repository",
        mimeType: "text/plain"
      },
      {
        uri: "memory://{id}",
        name: "Memory Detail",
        description: "Full content and statistics for a specific memory UUID",
        mimeType: "application/json"
      },
      {
        uri: "tasks://current?repo={repo}",
        name: "Current Tasks",
        description: "List of all active tasks (pending, in_progress, blocked) for a specific project",
        mimeType: "application/json"
      }
    ]
  };
}

export function readResource(uri: string, db: SQLiteStore) {
  logger.info("[MCP] resource.read", { uri });

  // 6. Current Tasks: tasks://current?repo={repo}
  if (uri.startsWith("tasks://current?")) {
    const parsed = new URL(uri.replace("tasks://", "http://tasks/"));
    const repo = parsed.searchParams.get("repo");
    if (!repo) throw new Error("Repo parameter is required for tasks://current");
    
    // Include backlog, pending, in_progress, and blocked by default for 'current' view
    const tasks = db.getTasksByRepo(repo).filter(t => ["backlog", "pending", "in_progress", "blocked"].includes(t.status));

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(tasks, null, 2)
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
      : db.listRecent(50); // Fallback to global recent

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(entries, null, 2)
        }
      ]
    };
  }

  // 2. Tag Affinity Resource: memory://tags/{tag}
  if (uri.startsWith("memory://tags/")) {
    const tag = uri.replace("memory://tags/", "");
    // Search across all repos for this specific technology tag
    const entries = db.searchByRepo("", { 
      tags: [tag], 
      limit: 50,
      includeArchived: false 
    });

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ tag, count: entries.length, entries }, null, 2)
        }
      ]
    };
  }

  // 3. Project Summary: memory://summary/{repo}
  if (uri.startsWith("memory://summary/")) {
    const repo = uri.replace("memory://summary/", "");
    const summary = db.getSummary(repo);

    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: summary?.summary || `No summary available for repository: ${repo}`
        }
      ]
    };
  }

  // 4. View memory by ID: memory://{uuid}
  const idMatch = uri.match(/^memory:\/\/([0-9a-f-]{36})$/i);
  if (idMatch) {
    const id = idMatch[1];
    const entry = db.getByIdWithStats(id); // Use version with stats for full detail
    
    if (!entry) {
      throw new Error(`Memory with ID ${id} not found.`);
    }

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(entry, null, 2)
        }
      ]
    };
  }

  // 5. Semantic Search via URI: memory://search/{base64_query}?repo={repo}
  if (uri.startsWith("memory://search/")) {
    const parts = uri.replace("memory://search/", "").split('?');
    const encodedQuery = parts[0];
    const query = Buffer.from(encodedQuery, 'base64').toString('utf-8');
    
    const parsed = new URL("http://memory/" + (parts[1] || ""));
    const repo = parsed.searchParams.get("repo") || "";
    
    const results = db.searchBySimilarity(query, repo, 10);
    
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ query, repo, results }, null, 2)
        }
      ]
    };
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}
