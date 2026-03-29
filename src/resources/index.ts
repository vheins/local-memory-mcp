import { SQLiteStore } from "../storage/sqlite.js";
import { logger } from "../utils/logger.js";

export function listResources() {
  return {
    resources: [
      {
        uri: "memory://index",
        name: "Memory Index",
        description: "Recent memory entries (metadata only)",
        mimeType: "application/json"
      },
      {
        uri: "memory://summary/{repo}",
        name: "Project Summary",
        description: "Antigravity summary for a repository",
        mimeType: "text/plain"
      },
      {
        uri: "memory://{id}",
        name: "Memory by ID",
        description: "View a specific memory by UUID",
        mimeType: "application/json"
      },
      {
        uri: "memory://{base64_query}",
        name: "Search Memories",
        description: "Search memories by query (base64 encoded)",
        mimeType: "application/json"
      }
    ]
  };
}

export function readResource(uri: string, db: SQLiteStore) {
  logger.info("[MCP] resource.read", { uri });

  if (uri === "memory://index" || uri.startsWith("memory://index?")) {
    const parsed = new URL(uri.replace("memory://", "http://memory/"));
    const repo = parsed.searchParams.get("repo");

    const entries = repo
      ? db.searchByRepo(repo, { limit: 20 })
      : db.listRecent(20);

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

  if (uri.startsWith("memory://summary/")) {
    const repo = uri.replace("memory://summary/", "");
    const summary = db.getSummary(repo);

    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: summary?.summary || "No summary available for this repository"
        }
      ]
    };
  }

  // View memory by ID: memory://{uuid}
  const idMatch = uri.match(/^memory:\/\/([0-9a-f-]{36})$/i);
  if (idMatch) {
    const id = idMatch[1];
    const entry = db.getById(id);
    
    if (!entry) {
      throw new Error(`Memory not found: ${id}`);
    }

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(entry)
        }
      ]
    };
  }

  // Search by query: memory://{base64_query}
  if (uri.startsWith("memory://") && !uri.startsWith("memory://index") && !uri.startsWith("memory://summary")) {
    const searchId = uri.replace("memory://", "");
    const query = Buffer.from(searchId, 'base64').toString('utf-8');
    const parsed = new URL(uri.replace("memory://", "http://memory/"));
    const repo = parsed.searchParams.get("repo") || undefined;
    
    const results = repo 
      ? db.searchBySimilarity(query, repo, 10)
      : db.searchBySimilarity(query, "", 10);
    
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ query, repo, results })
        }
      ]
    };
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}
