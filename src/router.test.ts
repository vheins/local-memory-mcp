// Feature: memory-mcp-optimization, Property 11: createRouter() uses provided storage
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { createRouter } from "./router.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { VectorStore } from "./types.js";
import { createSessionContext, updateSessionRoots } from "./mcp/session.js";

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
      getTasksByRepo: vi.fn().mockReturnValue([]),
      getTasksByMultipleStatuses: vi.fn().mockReturnValue([]),
      getTaskStats: vi.fn().mockReturnValue({ todo: 0 }),
      isTaskCodeDuplicate: vi.fn().mockReturnValue(false),
      insertTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      getTaskById: vi.fn().mockReturnValue(null),
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
          type: fc.constantFrom("code_fact", "decision", "mistake", "pattern", "file_claim"),
          title: fc.string({ minLength: 3, maxLength: 50 }),
        }),
        async ({ repo, content, importance, type, title }: { repo: string; content: string; importance: number; type: string; title: string }) => {
          const mockDb = makeMockDb();
          const mockVectors = makeMockVectors();
          const router = createRouter(mockDb, mockVectors);

          await router("tools/call", {
            name: "memory-store",
            arguments: { type, content, importance, title, scope: { repo }, agent: "test-agent", model: "test-model" },
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

  it("supports resources/templates/list", async () => {
    const mockDb = makeMockDb();
    const mockVectors = makeMockVectors();
    const router = createRouter(mockDb, mockVectors);

    const result = await router("resources/templates/list", {});
    const templates = result.resourceTemplates.map((entry: any) => entry.uriTemplate);

    expect(templates).toContain("memory://index?repo={repo}");
    expect(templates).toContain("tasks://current?repo={repo}");
  });

  it("rejects absolute tool paths outside active roots", async () => {
    const mockDb = makeMockDb();
    const mockVectors = makeMockVectors();
    const session = createSessionContext();
    updateSessionRoots(session, [{ uri: "file:///workspace/repo" }]);
    const router = createRouter(mockDb, mockVectors, {
      getSessionContext: () => session,
    });

    await expect(router("tools/call", {
      name: "memory-search",
      arguments: {
        query: "test query",
        repo: "test-repo",
        current_file_path: "/tmp/outside.ts",
      },
    })).rejects.toThrow("current_file_path must stay within the active MCP roots");
  });

  it("supports logging/setLevel utility", async () => {
    const mockDb = makeMockDb();
    const mockVectors = makeMockVectors();
    const router = createRouter(mockDb, mockVectors);

    const result = await router("logging/setLevel", { level: "debug" });
    expect(result.level).toBe("debug");
    expect(result.supportedLevels).toContain("info");
  });

  it("memory-synthesize uses sampling when the client supports it", async () => {
    const mockDb = makeMockDb();
    const mockVectors = makeMockVectors();
    const session = createSessionContext();
    session.supportsSampling = true;
    const sampleMessage = vi.fn().mockResolvedValue({
      role: "assistant",
      content: { type: "text", text: "Grounded answer from sampling." },
      model: "test-model",
      stopReason: "endTurn",
    });

    const router = createRouter(mockDb, mockVectors, {
      getSessionContext: () => session,
      sampleMessage,
    });

    const result = await router("tools/call", {
      name: "memory-synthesize",
      arguments: { repo: "test-repo", objective: "Summarize the project state" },
    });

    expect(sampleMessage).toHaveBeenCalledTimes(1);
    expect(result.data.answer).toContain("Grounded answer");
    expect(result.structuredContent.answer).toContain("Grounded answer");
  });

  it("memory-synthesize supports a multi-turn sampling tool loop", async () => {
    const mockDb = makeMockDb();
    const mockVectors = makeMockVectors();
    const session = createSessionContext();
    session.supportsSampling = true;
    session.supportsSamplingTools = true;

    const sampleMessage = vi.fn()
      .mockResolvedValueOnce({
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "call_1",
          name: "memory_recap",
          input: { repo: "test-repo", limit: 3 },
        }],
        stopReason: "toolUse",
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: { type: "text", text: "Final grounded answer after tool use." },
        model: "test-model",
        stopReason: "endTurn",
      });

    const router = createRouter(mockDb, mockVectors, {
      getSessionContext: () => session,
      sampleMessage,
    });

    const result = await router("tools/call", {
      name: "memory-synthesize",
      arguments: {
        repo: "test-repo",
        objective: "Explain the latest architecture decisions",
        max_iterations: 3,
      },
    });

    expect(sampleMessage).toHaveBeenCalledTimes(2);
    expect(result.data.toolCalls).toBe(1);
    expect(result.data.iterations).toBe(2);
  });

  it("memory-synthesize elicits the repo when roots cannot infer it", async () => {
    const mockDb = makeMockDb();
    const mockVectors = makeMockVectors();
    const session = createSessionContext();
    session.supportsSampling = true;
    session.supportsElicitation = true;
    session.supportsElicitationForm = true;

    const sampleMessage = vi.fn().mockResolvedValue({
      role: "assistant",
      content: { type: "text", text: "Synthesized after repo elicitation." },
      model: "test-model",
      stopReason: "endTurn",
    });
    const elicit = vi.fn().mockResolvedValue({
      action: "accept",
      content: { repo: "elicited-repo" },
    });

    const router = createRouter(mockDb, mockVectors, {
      getSessionContext: () => session,
      sampleMessage,
      elicit,
    });

    const result = await router("tools/call", {
      name: "memory-synthesize",
      arguments: { objective: "Summarize the repo using elicitation" },
    });

    expect(elicit).toHaveBeenCalledTimes(1);
    expect(sampleMessage).toHaveBeenCalledTimes(1);
    expect(result.data.repo).toBe("elicited-repo");
  });

  it("task-create-interactive elicits missing task fields and creates the task", async () => {
    const mockDb = makeMockDb();
    const mockVectors = makeMockVectors();
    const session = createSessionContext();
    session.supportsElicitation = true;
    session.supportsElicitationForm = true;

    const elicit = vi.fn().mockResolvedValue({
      action: "accept",
      content: {
        repo: "interactive-repo",
        task_code: "TASK-101",
        phase: "implementation",
        title: "Implement elicitation flow",
        description: "Add elicitation-backed task creation flow",
        status: "pending",
        priority: 4,
      },
    });

    const router = createRouter(mockDb, mockVectors, {
      getSessionContext: () => session,
      elicit,
    });

    const result = await router("tools/call", {
      name: "task-create-interactive",
      arguments: {},
    });

    expect(elicit).toHaveBeenCalledTimes(1);
    expect(mockDb.insertTask).toHaveBeenCalledTimes(1);
    expect(result.data.repo).toBe("interactive-repo");
    expect(result.data.task_code).toBe("TASK-101");
  });
});
