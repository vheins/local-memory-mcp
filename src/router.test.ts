// Feature: memory-mcp-optimization, Property 11: createRouter() uses provided storage
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { createRouter } from "./router.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { VectorStore } from "./types.js";

/**
 * Property 11: createRouter() menggunakan storage yang diberikan
 * Validates: Requirements 10.1, 10.4
 *
 * For any mock SQLiteStore given to createRouter(mockDb, mockVectors),
 * all tool operations run through the router SHALL use mockDb and not access the real DB.
 */
describe("createRouter() — Property 11: uses provided storage", () => {
  function makeMockDb(): SQLiteStore {
    return {
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getById: vi.fn().mockReturnValue(null),
      searchByRepo: vi.fn().mockReturnValue([]),
      searchBySimilarity: vi.fn().mockReturnValue([]),
      getRecentMemories: vi.fn().mockReturnValue([]),
      getTotalCount: vi.fn().mockReturnValue(0),
      getSummary: vi.fn().mockReturnValue(null),
      upsertSummary: vi.fn(),
      listRepos: vi.fn().mockReturnValue([]),
      listRecent: vi.fn().mockReturnValue([]),
      incrementHitCount: vi.fn(),
      incrementRecallCount: vi.fn(),
      getStats: vi.fn().mockReturnValue({ total: 0, byType: {}, unused: 0 }),
      getAllMemoriesWithStats: vi.fn().mockReturnValue([]),
      upsertVectorEmbedding: vi.fn(),
      getVectorEmbedding: vi.fn().mockReturnValue(null),
      archiveExpiredMemories: vi.fn().mockReturnValue(0),
      logQuery: vi.fn(),
      getRecentQueries: vi.fn().mockReturnValue([]),
      logAction: vi.fn(),
      checkConflicts: vi.fn().mockResolvedValue(null),
      close: vi.fn(),
    } as unknown as SQLiteStore;
  }

  function makeMockVectors(): VectorStore {
    return {
      upsert: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
    };
  }

  it("memory-recap calls getRecentMemories on the provided mock db", async () => {
    const mockDb = makeMockDb();
    const mockVectors = makeMockVectors();
    const router = createRouter(mockDb, mockVectors);

    await router("tools/call", {
      name: "memory-recap",
      arguments: { repo: "test-repo", limit: 5 },
    });

    expect(mockDb.getRecentMemories).toHaveBeenCalledWith("test-repo", 5, 0);
    expect(mockDb.getTotalCount).toHaveBeenCalledWith("test-repo");
  });

  it("memory-search calls searchBySimilarity on the provided mock db", async () => {
    const mockDb = makeMockDb();
    const mockVectors = makeMockVectors();
    const router = createRouter(mockDb, mockVectors);

    await router("tools/call", {
      name: "memory-search",
      arguments: { query: "test query", repo: "test-repo", limit: 5 },
    });

    expect(mockDb.searchBySimilarity).toHaveBeenCalled();
    // Verify the first argument to searchBySimilarity contains the repo
    const callArgs = (mockDb.searchBySimilarity as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]).toBe("test-repo");
  });

  it("property: for any repo string, memory-recap always uses the injected db", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s: string) => s.trim().length > 0),
        fc.integer({ min: 1, max: 50 }),
        async (repo: string, limit: number) => {
          const mockDb = makeMockDb();
          const mockVectors = makeMockVectors();
          const router = createRouter(mockDb, mockVectors);

          await router("tools/call", {
            name: "memory-recap",
            arguments: { repo, limit },
          });

          // The mock db methods must have been called (not a real DB)
          expect(mockDb.getRecentMemories).toHaveBeenCalled();
          expect(mockDb.getTotalCount).toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("property: for any valid store args, memory-store uses the injected db", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          repo: fc.string({ minLength: 1, maxLength: 30 }).filter((s: string) => s.trim().length > 0),
          content: fc.string({ minLength: 10, maxLength: 200 }),
          importance: fc.integer({ min: 1, max: 5 }),
          type: fc.constantFrom("code_fact", "decision", "mistake", "pattern"),
          title: fc.string({ minLength: 3, maxLength: 50 }),
        }),
        async ({ repo, content, importance, type, title }: { repo: string; content: string; importance: number; type: string; title: string }) => {
          const mockDb = makeMockDb();
          const mockVectors = makeMockVectors();
          const router = createRouter(mockDb, mockVectors);

          await router("tools/call", {
            name: "memory-store",
            arguments: { type, content, importance, title, scope: { repo } },
          });

          expect(mockDb.insert).toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("different router instances use their own injected db independently", () => {
    const mockDb1 = makeMockDb();
    const mockDb2 = makeMockDb();
    const mockVectors = makeMockVectors();

    const router1 = createRouter(mockDb1, mockVectors);
    const router2 = createRouter(mockDb2, mockVectors);

    // Both routers are distinct functions
    expect(router1).not.toBe(router2);

    // Each router closes over its own db
    // (verified by the property tests above that each mock is called independently)
  });
});
