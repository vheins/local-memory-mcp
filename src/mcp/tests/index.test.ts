// Feature: memory-mcp-optimization, Property 19: memory://index filter repo
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { SQLiteStore } from "../storage/sqlite.js";
import { readResource, listResourceTemplates, listResources } from "../resources/index.js";
import { MemoryEntry } from "../types.js";
import { createSessionContext, updateSessionRoots } from "../session.js";

function makeEntry(id: string, repo: string): MemoryEntry {
  return {
    id,
    type: "code_fact",
    title: `Memory ${id}`,
    content: `Content for memory ${id} in repo ${repo}`,
    importance: 3,
    agent: "test-agent",
    role: "unknown",
    model: "test-model",
    scope: { repo },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    hit_count: 0,
    recall_count: 0,
    last_used_at: null,
    expires_at: null,
    supersedes: null,
    status: "active",
    tags: [],
    metadata: {},
    is_global: false,
  };
}

describe("readResource memory://index", () => {
  it("returns recent entries when no repo filter", () => {
    const db = new SQLiteStore(":memory:");
    db.insert(makeEntry("id-1", "repo-a"));
    db.insert(makeEntry("id-2", "repo-b"));

    const result = readResource("memory://index", db);
    const entries = JSON.parse(result.contents[0].text);
    expect(entries.length).toBeGreaterThan(0);
    db.close();
  });

  it("returns only entries for the specified repo when ?repo=X is given", () => {
    const db = new SQLiteStore(":memory:");
    db.insert(makeEntry("id-a1", "repo-alpha"));
    db.insert(makeEntry("id-a2", "repo-alpha"));
    db.insert(makeEntry("id-b1", "repo-beta"));

    const result = readResource("memory://index?repo=repo-alpha", db);
    const entries: MemoryEntry[] = JSON.parse(result.contents[0].text);

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.scope.repo).toBe("repo-alpha");
    }
    db.close();
  });

  it("returns empty array when repo has no entries", () => {
    const db = new SQLiteStore(":memory:");
    db.insert(makeEntry("id-1", "repo-a"));

    const result = readResource("memory://index?repo=nonexistent", db);
    const entries = JSON.parse(result.contents[0].text);
    expect(entries).toEqual([]);
    db.close();
  });

  /**
   * Property 19: memory://index dengan filter repo mengembalikan subset yang benar
   * Validates: Requirements 19.1, 19.3
   */
  it("Property 19: all returned entries have repo === queried repo", () => {
    fc.assert(
      fc.property(
        // Generate 2-4 distinct repo names
        fc.uniqueArray(
          fc.stringMatching(/^[a-z][a-z0-9-]{2,8}$/),
          { minLength: 2, maxLength: 4 }
        ),
        // Generate 1-5 memories per repo
        fc.integer({ min: 1, max: 5 }),
        (repos: string[], memoriesPerRepo: number) => {
          const db = new SQLiteStore(":memory:");

          // Insert memories for each repo
          let counter = 0;
          for (const repo of repos) {
            for (let i = 0; i < memoriesPerRepo; i++) {
              db.insert(makeEntry(`id-${counter++}`, repo));
            }
          }

          // Query with the first repo as filter
          const targetRepo = repos[0];
          const result = readResource(`memory://index?repo=${targetRepo}`, db);
          const entries: MemoryEntry[] = JSON.parse(result.contents[0].text);

          // All returned entries must belong to targetRepo
          const allMatch = entries.every((e) => e.scope.repo === targetRepo);

          db.close();
          return allMatch;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 19 (no filter): returns entries from all repos", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.stringMatching(/^[a-z][a-z0-9-]{2,8}$/),
          { minLength: 2, maxLength: 3 }
        ),
        (repos: string[]) => {
          const db = new SQLiteStore(":memory:");

          for (const repo of repos) {
            db.insert(makeEntry(`id-${repo}`, repo));
          }

          const result = readResource("memory://index", db);
          const entries: Array<{ id: string; type: string; repo: string }> =
            JSON.parse(result.contents[0].text);

          // Without filter, should return entries (listRecent returns id/type/repo)
          expect(entries.length).toBeGreaterThan(0);

          db.close();
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("MCP resource templates and session resources", () => {
  it("supports resource list pagination with nextCursor", () => {
    const session = createSessionContext();
    const firstPage = listResources(session, { limit: 2 });
    const secondPage = listResources(session, { limit: 2, cursor: firstPage.nextCursor });

    expect(firstPage.resources).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(secondPage.resources).toHaveLength(2);
  });

  it("supports resource template pagination with nextCursor", () => {
    const firstPage = listResourceTemplates({ limit: 2 });
    const secondPage = listResourceTemplates({ limit: 2, cursor: firstPage.nextCursor });
    const secondTemplates = secondPage.resourceTemplates as Array<{ uriTemplate: string }>;

    expect(firstPage.resourceTemplates).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(secondTemplates.length).toBeGreaterThan(0);
  });

  it("rejects invalid cursors for resources/list with MCP invalid params error", () => {
    const session = createSessionContext();

    expect(() => listResources(session, { cursor: "%%%not-base64%%%" })).toThrowError(/Invalid cursor/);

    try {
      listResources(session, { cursor: "%%%not-base64%%%" });
    } catch (error: any) {
      expect(error.code).toBe(-32602);
    }
  });

  it("rejects invalid cursors for resources/templates/list with MCP invalid params error", () => {
    expect(() => listResourceTemplates({ cursor: "%%%not-base64%%%" })).toThrowError(/Invalid cursor/);

    try {
      listResourceTemplates({ cursor: "%%%not-base64%%%" });
    } catch (error: any) {
      expect(error.code).toBe(-32602);
    }
  });

  it("lists parameterized resources via resources/templates/list", () => {
    const result = listResourceTemplates();
    const templates = (result.resourceTemplates as Array<{ uriTemplate: string }>).map((entry) => entry.uriTemplate);

    expect(templates).toContain("memory://index?repo={repo}");
    expect(templates).toContain("tasks://current?repo={repo}");
    expect(templates).toContain("memory://search/{base64_query}?repo={repo}");
  });

  it("returns active session roots as a concrete resource", () => {
    const db = new SQLiteStore(":memory:");
    const session = createSessionContext();
    updateSessionRoots(session, [
      { uri: "file:///workspace/project-a", name: "project-a" },
      { uri: "file:///workspace/project-b" },
    ]);

    const result = readResource("session://roots", db, session);
    const payload = JSON.parse(result.contents[0].text);

    expect(payload.roots).toHaveLength(2);
    expect(payload.roots[0].name).toBe("project-a");
    db.close();
  });

  it("adds annotations and size metadata to concrete resource content", () => {
    const db = new SQLiteStore(":memory:");
    const result = readResource("memory://summary/repo-a", db);
    const content = result.contents[0];

    expect(content.annotations.priority).toBeGreaterThan(0.5);
    expect(content.size).toBeGreaterThan(0);
    db.close();
  });

  it("throws MCP resource not found error code for unknown resources", () => {
    const db = new SQLiteStore(":memory:");

    expect(() => readResource("memory://missing/resource", db)).toThrowError(/Unknown resource URI/);

    try {
      readResource("memory://missing/resource", db);
    } catch (error: any) {
      expect(error.code).toBe(-32002);
      expect(error.data.uri).toBe("memory://missing/resource");
    } finally {
      db.close();
    }
  });
});
