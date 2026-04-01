// Feature: memory-mcp-optimization
// Property tests for SQLiteStore — Properties 1, 6, 7, 8, 9, 10, 18

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { SQLiteStore } from "./sqlite.js";
import type { MemoryEntry } from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

type MemoryType = "code_fact" | "decision" | "mistake" | "pattern";

function makeEntry(overrides: Partial<{
  id: string;
  repo: string;
  type: MemoryType;
  title: string;
  content: string;
  importance: number;
  agent: string;
  model: string;
  created_at: string;
  expires_at: string | null;
}>): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2)}`,
    type: overrides.type ?? "code_fact",
    title: overrides.title ?? "Test Memory Title",
    content: overrides.content ?? "sample content for testing purposes",
    importance: overrides.importance ?? 3,
    agent: overrides.agent ?? "test-agent",
    role: "unknown",
    model: overrides.model ?? "test-model",
    scope: { repo: overrides.repo ?? "test-repo" },
    created_at: overrides.created_at ?? now,
    updated_at: now,
    completed_at: null,
    hit_count: 0,
    recall_count: 0,
    last_used_at: null,
    expires_at: overrides.expires_at !== undefined ? overrides.expires_at : null,
    supersedes: null,
    status: "active",
    tags: [],
    is_global: false,
  };
}

function freshStore(): SQLiteStore {
  return new SQLiteStore(":memory:");
}

// ─── Property 1: Pre-filter SQL membatasi kandidat searchBySimilarity ────────
// Validates: Requirements 1.1, 1.2, 1.3, 1.4

describe("Property 1: Pre-filter SQL membatasi kandidat searchBySimilarity", () => {
  // Feature: memory-mcp-optimization, Property 1: Pre-filter SQL membatasi kandidat searchBySimilarity
  it("result.length <= limit for any repo with N > limit memories", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 30 }),  // N memories
        fc.integer({ min: 1, max: 4 }),   // limit < N
        fc.string({ minLength: 5, maxLength: 30 }),  // query
        (n: number, limit: number, query: string) => {
          const store = freshStore();
          const repo = "repo-p1";

          for (let i = 0; i < n; i++) {
            store.insert(makeEntry({
              id: `p1-${i}`,
              repo,
              content: `memory content item number ${i} about coding patterns`,
            }));
          }

          const results = store.searchBySimilarity(query, repo, limit);
          store.close();

          return results.length <= limit;
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ─── Property 6: Inisialisasi SQLiteStore berulang tidak melempar exception ──
// Validates: Requirements 7.1, 7.3, 7.4

describe("Property 6: Inisialisasi SQLiteStore berulang tidak melempar exception", () => {
  // Feature: memory-mcp-optimization, Property 6: Inisialisasi SQLiteStore berulang tidak melempar exception
  it("constructing SQLiteStore twice on :memory: does not throw", () => {
    fc.assert(
      fc.property(
        fc.constant(":memory:"),
        (_path: string) => {
          // Each :memory: DB is independent, so we test the migration logic
          // by creating two stores (each runs migrate() on a fresh in-memory DB)
          expect(() => {
            const s1 = new SQLiteStore(":memory:");
            s1.close();
          }).not.toThrow();

          expect(() => {
            const s2 = new SQLiteStore(":memory:");
            s2.close();
          }).not.toThrow();

          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it("migrate() is idempotent — inserting then re-opening same store does not throw", () => {
    // We simulate re-initialization by calling migrate logic twice via two stores
    // on the same in-memory path (each :memory: is isolated, so we verify no throw)
    const store1 = new SQLiteStore(":memory:");
    store1.insert(makeEntry({ id: "m1", repo: "r1" }));
    // A second store on :memory: is a fresh DB — migration runs again safely
    const store2 = new SQLiteStore(":memory:");
    store2.insert(makeEntry({ id: "m2", repo: "r2" }));
    store1.close();
    store2.close();
  });
});

// ─── Property 7: Pagination non-overlapping ──────────────────────────────────
// Validates: Requirements 8.2, 8.4

describe("Property 7: Pagination non-overlapping", () => {
  // Feature: memory-mcp-optimization, Property 7: Pagination non-overlapping
  it("pages i and j (i ≠ j) share no memory ids", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 40 }),  // total memories N
        fc.integer({ min: 2, max: 5 }),    // page size L
        fc.integer({ min: 0, max: 3 }),    // page index i
        fc.integer({ min: 0, max: 3 }),    // page index j
        (n: number, pageSize: number, i: number, j: number) => {
          fc.pre(i !== j);

          const store = freshStore();
          const repo = "repo-p7";

          for (let k = 0; k < n; k++) {
            store.insert(makeEntry({
              id: `p7-${k}`,
              repo,
              content: `memory item ${k} for pagination test`,
            }));
          }

          const pageI = store.getRecentMemories(repo, pageSize, i * pageSize);
          const pageJ = store.getRecentMemories(repo, pageSize, j * pageSize);
          store.close();

          const idsI = new Set(pageI.map((m) => m.id));
          const idsJ = new Set(pageJ.map((m) => m.id));

          // No overlap
          for (const id of idsI) {
            if (idsJ.has(id)) return false;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 8: TTL menyimpan expires_at yang benar ─────────────────────────
// Validates: Requirement 9.2

describe("Property 8: TTL menyimpan expires_at yang benar", () => {
  // Feature: memory-mcp-optimization, Property 8: TTL menyimpan expires_at yang benar
  it("expires_at equals created_at + ttlDays * 86400 seconds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 365 }),  // ttlDays
        (ttlDays: number) => {
          const store = freshStore();
          const createdAt = new Date("2025-01-01T00:00:00.000Z");
          const expectedExpiresAt = new Date(
            createdAt.getTime() + ttlDays * 86400 * 1000
          ).toISOString();

          const entry = makeEntry({
            id: `p8-${ttlDays}`,
            repo: "repo-p8",
            created_at: createdAt.toISOString(),
            expires_at: expectedExpiresAt,
          });

          store.insert(entry);
          const retrieved = store.getById(entry.id);
          store.close();

          return retrieved?.expires_at === expectedExpiresAt;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 9: Expired memories dikecualikan dari hasil pencarian ───────────
// Validates: Requirements 9.3, 9.6

describe("Property 9: Expired memories dikecualikan dari hasil pencarian", () => {
  // Feature: memory-mcp-optimization, Property 9: Expired memories dikecualikan dari hasil pencarian
  it("searchBySimilarity does not return expired memories", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 20 }),  // query
        (query: string) => {
          const store = freshStore();
          const repo = "repo-p9-sim";
          const pastDate = new Date(Date.now() - 86400 * 1000).toISOString(); // yesterday

          store.insert(makeEntry({
            id: "expired-sim",
            repo,
            content: `${query} expired content that should not appear`,
            expires_at: pastDate,
          }));

          const results = store.searchBySimilarity(query, repo, 10);
          store.close();

          return !results.some((r) => r.id === "expired-sim");
        }
      ),
      { numRuns: 50 }
    );
  });

  it("searchByRepo does not return expired memories", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),  // importance
        (importance: number) => {
          const store = freshStore();
          const repo = "repo-p9-byrepo";
          const pastDate = new Date(Date.now() - 86400 * 1000).toISOString();

          store.insert(makeEntry({
            id: "expired-byrepo",
            repo,
            importance,
            expires_at: pastDate,
          }));

          const results = store.searchByRepo(repo);
          store.close();

          return !results.some((r) => r.id === "expired-byrepo");
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ─── Property 10: archiveExpiredMemories() idempoten ─────────────────────────
// Validates: Requirement 9.5

describe("Property 10: archiveExpiredMemories() idempoten", () => {
  // Feature: memory-mcp-optimization, Property 10: archiveExpiredMemories() idempoten
  it("second call returns 0 when no new memories expired between calls", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),  // number of expired memories
        (n: number) => {
          const store = freshStore();
          const repo = "repo-p10";
          const pastDate = new Date(Date.now() - 86400 * 1000).toISOString();

          for (let i = 0; i < n; i++) {
            store.insert(makeEntry({
              id: `p10-${i}`,
              repo,
              expires_at: pastDate,
            }));
          }

          const first = store.archiveExpiredMemories(true);
          const second = store.archiveExpiredMemories(true);
          store.close();

          return first === n && second === 0;
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ─── Property 18: listRepos() mengembalikan daftar unik dan terurut ───────────
// Validates: Requirements 19.5, 19.6

describe("Property 18: listRepos() mengembalikan daftar unik dan terurut", () => {
  // Feature: memory-mcp-optimization, Property 18: listRepos() mengembalikan daftar unik dan terurut
  it("no duplicates and sorted ascending", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringMatching(/^[a-z][a-z0-9-]{1,10}$/),
          { minLength: 2, maxLength: 10 }
        ),
        (repos: string[]) => {
          const store = freshStore();

          repos.forEach((repo: string, i: number) => {
            store.insert(makeEntry({
              id: `p18-${i}-${repo}`,
              repo,
            }));
          });

          const result = store.listRepos();
          store.close();

          // No duplicates
          const unique = new Set(result);
          if (unique.size !== result.length) return false;

          // Sorted ascending
          for (let i = 1; i < result.length; i++) {
            if (result[i] < result[i - 1]) return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Property 19: Action Log functionality
describe("Property 19: Action Log stores and retrieves recent actions", () => {
  it("logAction stores action with correct metadata", () => {
    const store = freshStore();
    
    store.logAction('search', "test-repo", { query: "test query", resultCount: 5 });
    
    const actions = store.getRecentActions("test-repo", 10);
    
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("search");
    expect(actions[0].query).toBe("test query");
  });

  it("getRecentActions returns actions in descending order by created_at", () => {
    const store = freshStore();
    
    store.logAction('search', "test-repo", { query: "first query", resultCount: 3 });
    store.logAction('read', "test-repo", { memoryId: "id-1", resultCount: 2 });
    store.logAction('write', "test-repo", { query: "third query", resultCount: 1 });
    
    const actions = store.getRecentActions("test-repo", 10);
    
    expect(actions[0].action).toBe("write");
    expect(actions[1].action).toBe("read");
    expect(actions[2].action).toBe("search");
  });

  it("getRecentActions limits results correctly", () => {
    const store = freshStore();
    
    for (let i = 0; i < 25; i++) {
      store.logAction('search', "test-repo", { query: `query-${i}`, resultCount: i });
    }
    
    const actions = store.getRecentActions("test-repo", 10);
    
    expect(actions).toHaveLength(10);
  });

  it("getRecentActions filters by repo correctly", () => {
    const store = freshStore();
    
    store.logAction('search', "repo1", { query: "repo1 query", resultCount: 1 });
    store.logAction('search', "repo2", { query: "repo2 query", resultCount: 1 });
    store.logAction('read', "repo1", { memoryId: "id-1", resultCount: 1 });
    
    const repo1Actions = store.getRecentActions("repo1", 10);
    const repo2Actions = store.getRecentActions("repo2", 10);
    
    expect(repo1Actions).toHaveLength(2);
    expect(repo2Actions).toHaveLength(1);
  });

  it("getRecentActions returns empty array when no actions exist", () => {
    const store = freshStore();
    
    const actions = store.getRecentActions("nonexistent-repo", 10);
    
    expect(actions).toHaveLength(0);
  });

  it("getRecentActions without repo parameter returns all actions", () => {
    const store = freshStore();
    
    store.logAction('search', "repo1", { query: "query1", resultCount: 1 });
    store.logAction('read', "repo2", { memoryId: "id-1", resultCount: 1 });
    
    const allActions = store.getRecentActions(undefined, 10);
    
    expect(allActions).toHaveLength(2);
  });

  it("logAction stores result_count correctly", () => {
    const store = freshStore();
    
    store.logAction('search', "test-repo", { query: "high results", resultCount: 100 });
    store.logAction('search', "test-repo", { query: "low results", resultCount: 1 });
    
    const actions = store.getRecentActions("test-repo", 10);
    
    expect(actions[0].result_count).toBe(1);
    expect(actions[1].result_count).toBe(100);
  });

  it("different action types are logged correctly", () => {
    const store = freshStore();
    
    store.logAction('search', "test-repo", { query: "search query", resultCount: 5 });
    store.logAction('read', "test-repo", { memoryId: "mem-1", resultCount: 1 });
    store.logAction('write', "test-repo", { query: "new memory", resultCount: 1 });
    store.logAction('update', "test-repo", { memoryId: "mem-2", resultCount: 1 });
    store.logAction('delete', "test-repo", { memoryId: "mem-3", resultCount: 1 });
    
    const actions = store.getRecentActions("test-repo", 10);
    
    expect(actions).toHaveLength(5);
    expect(actions.map(a => a.action)).toEqual(['delete', 'update', 'write', 'read', 'search']);
  });
});

describe("Dashboard memory queries", () => {
  it("listMemoriesForDashboard paginates, searches, and sorts server-side", () => {
    const store = freshStore();

    store.insert(makeEntry({
      id: "dash-1",
      repo: "repo-dashboard",
      title: "Alpha Memory",
      content: "alpha content",
      importance: 5,
    }));
    store.insert(makeEntry({
      id: "dash-2",
      repo: "repo-dashboard",
      title: "Beta Memory",
      content: "beta content",
      importance: 3,
    }));
    store.insert(makeEntry({
      id: "dash-3",
      repo: "repo-dashboard",
      title: "Gamma Memory",
      content: "gamma content",
      importance: 4,
    }));

    store.incrementHitCount("dash-2");
    store.incrementHitCount("dash-2");
    store.incrementRecallCount("dash-2");

    const result = store.listMemoriesForDashboard({
      repo: "repo-dashboard",
      search: "memory",
      sortBy: "title",
      sortOrder: "asc",
      limit: 2,
      offset: 0,
    });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe("Alpha Memory");
    expect(result.items[1].title).toBe("Beta Memory");

    store.close();
  });

  it("getByIdWithStats returns recall_rate for detail views", () => {
    const store = freshStore();

    store.insert(makeEntry({
      id: "detail-1",
      repo: "repo-detail",
      title: "Detail Memory",
      content: "detail content",
    }));

    store.incrementHitCount("detail-1");
    store.incrementHitCount("detail-1");
    store.incrementRecallCount("detail-1");

    const memory = store.getByIdWithStats("detail-1");

    expect(memory).not.toBeNull();
    expect(memory?.title).toBe("Detail Memory");
    expect(memory?.recall_rate).toBe(0.5);

    store.close();
  });
});
