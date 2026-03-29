import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRouter } from "./router.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { RealVectorStore } from "./storage/vectors.js"; 
import type { VectorStore } from "./types.js";

// Increase timeout for AI model loading and execution
vi.setConfig({ testTimeout: 60000 });

/**
 * MCP Realistic E2E Test
 * Scenario: An AI Agent onboarding a project and managing architectural decisions.
 */
describe("MCP Local Memory - Realistic Agent Workflow", () => {
  let db: SQLiteStore;
  let vectors: VectorStore;
  let router: (method: string, params: any) => Promise<any>;

  const REPO = "modern-payment-gateway";
  const APP_TS = "src/modules/billing/processor.ts";

  beforeEach(() => {
    db = new SQLiteStore(":memory:");
    vectors = new RealVectorStore(db);
    router = createRouter(db, vectors);
  });

  it("should complete a full agent lifecycle: Discovery -> Store -> Search -> Conflict -> Supersede -> Feedback", async () => {
    // --- 1. DISCOVERY ---
    const toolList = await router("tools/list", {});
    expect(toolList.tools.some((t: any) => t.name === "memory-store")).toBe(true);

    // --- 2. INITIAL STORAGE ---
    const storeRes1 = await router("tools/call", {
      name: "memory-store",
      arguments: {
        type: "decision",
        title: "Billing Retry Logic",
        content: "Retry payment processing 3 times before failing.",
        importance: 4,
        scope: { repo: REPO, folder: "src/modules/billing" }
      }
    });
    expect(storeRes1.isError).toBeFalsy();

    // --- 3. CONTEXTUAL SEARCH (Workspace-Aware) ---
    const searchRes = await router("tools/call", {
      name: "memory-search",
      arguments: {
        query: "How many billing retries?",
        repo: REPO,
        current_file_path: APP_TS
      }
    });
    // Should find the memory due to semantic overlap and workspace boost
    expect(searchRes.content[0].text).toContain("Found 1 memories");
    expect(searchRes.content[0].text).toContain("Billing Retry Logic");

    // --- 4. CONFLICT DETECTION ---
    const conflictRes = await router("tools/call", {
      name: "memory-store",
      arguments: {
        type: "decision",
        title: "New Policy",
        content: "Change retry logic to 5 times.",
        importance: 4,
        scope: { repo: REPO }
      }
    });
    // Should be rejected because it's too similar to existing rule
    expect(conflictRes.content[0].text).toContain("conflict");

    // --- 5. RESOLUTION VIA SUPERSEDES ---
    const oldId = storeRes1.data.id;
    const resolveRes = await router("tools/call", {
      name: "memory-store",
      arguments: {
        type: "decision",
        title: "V2 Billing Policy",
        content: "We now retry 5 times.",
        importance: 4,
        scope: { repo: REPO },
        supersedes: oldId
      }
    });
    expect(resolveRes.isError).toBeFalsy();
    
    // Verify old is archived
    const oldMem = db.getById(oldId);
    expect(oldMem?.status).toBe("archived");

    // --- 6. FEEDBACK LOOP (Learning) ---
    const newId = resolveRes.data.id;
    await router("tools/call", {
      name: "memory-acknowledge",
      arguments: {
        memory_id: newId,
        status: "used",
        application_context: "Applied V2 policy to payment processor."
      }
    });

    const stats = db.getByIdWithStats(newId);
    expect(stats?.recall_count).toBe(1);

    // --- 7. RESOURCE INTEGRITY ---
    const resource = await router("resources/read", {
      uri: `memory://index?repo=${REPO}`
    });
    const entries = JSON.parse(resource.contents[0].text);
    // Should only contain the active V2 policy, not the archived V1
    expect(entries.some((e: any) => e.id === newId)).toBe(true);
    expect(entries.some((e: any) => e.id === oldId)).toBe(false);
  });

  it("should enforce repo isolation", async () => {
    await router("tools/call", {
      name: "memory-store",
      arguments: {
        type: "code_fact",
        title: "Secret",
        content: "Repo A uses password '123'",
        importance: 1,
        scope: { repo: "repo-a" }
      }
    });

    const searchRes = await router("tools/call", {
      name: "memory-search",
      arguments: { query: "password", repo: "repo-b" }
    });

    expect(searchRes.content[0].text).toContain("Found 0 memories");
  });
});
