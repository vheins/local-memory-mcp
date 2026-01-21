import { SQLiteStore } from "../storage/sqlite.js";

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
      }
    ]
  };
}

export function readResource(uri: string, db: SQLiteStore) {
  if (uri === "memory://index") {
    const entries = db.listRecent(20);
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

  if (uri.startsWith("memory://")) {
    const id = uri.replace("memory://", "");
    const entry = db.getById(id);

    if (!entry) {
      throw new Error(`Memory not found: ${id}`);
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

  throw new Error(`Unknown resource URI: ${uri}`);
}
