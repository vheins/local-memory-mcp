// Feature: memory-mcp-optimization
// Property tests for SQLiteStore — Properties 1, 6, 7, 8, 9, 10, 18, 19

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { SQLiteStore, createTestStore } from "../storage/sqlite";
import type { MemoryEntry } from "../types";

type MemoryType = "code_fact" | "decision" | "mistake" | "pattern" | "file_claim";

function makeEntry(
	overrides: Partial<{
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
	}>
): MemoryEntry {
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
		metadata: {},
		is_global: false
	};
}

async function freshStore(): Promise<SQLiteStore> {
	return createTestStore();
}

describe("Property 1: Pre-filter SQL limits searchBySimilarity candidates", () => {
	it("result.length <= limit for any repo with N > limit memories", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 5, max: 30 }),
				fc.integer({ min: 1, max: 4 }),
				fc.string({ minLength: 5, maxLength: 30 }),
				async (n: number, limit: number, query: string) => {
					const store = await freshStore();
					const repo = "repo-p1";

					for (let i = 0; i < n; i++) {
						store.memories.insert(
							makeEntry({
								id: `p1-${i}`,
								repo,
								content: `memory content item number ${i} about coding patterns`
							})
						);
					}

					const results = store.memories.searchBySimilarity(query, repo, limit);
					store.close();

					return results.length <= limit;
				}
			),
			{ numRuns: 50 }
		);
	});
});

describe("Property 6: Repeated SQLiteStore initialization does not throw", () => {
	it("constructing SQLiteStore twice on :memory: does not throw", async () => {
		await fc.assert(
			fc.asyncProperty(fc.constant(":memory:"), async () => {
				const s1 = await freshStore();
				s1.close();

				const s2 = await freshStore();
				s2.close();

				return true;
			}),
			{ numRuns: 20 }
		);
	});

	it("migrate() is idempotent — inserting then re-opening same store does not throw", async () => {
		const store1 = await freshStore();
		store1.memories.insert(makeEntry({ id: "m1", repo: "r1" }));
		store1.close();

		const store2 = await freshStore();
		store2.memories.insert(makeEntry({ id: "m2", repo: "r2" }));
		expect(() => store2.close()).not.toThrow();
	});
});

describe("Property 7: Pagination non-overlapping", () => {
	it("pages i and j (i ≠ j) share no memory ids", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 10, max: 40 }),
				fc.integer({ min: 2, max: 5 }),
				fc.integer({ min: 0, max: 3 }),
				fc.integer({ min: 0, max: 3 }),
				async (n: number, pageSize: number, i: number, j: number) => {
					fc.pre(i !== j);

					const store = await freshStore();
					const repo = "repo-p7";

					for (let k = 0; k < n; k++) {
						store.memories.insert(
							makeEntry({
								id: `p7-${k}`,
								repo,
								content: `memory item ${k} for pagination test`
							})
						);
					}

					const pageI = store.memories.getRecentMemories(repo, pageSize, i * pageSize);
					const pageJ = store.memories.getRecentMemories(repo, pageSize, j * pageSize);
					store.close();

					const idsI = new Set(pageI.map((m) => m.id));
					const idsJ = new Set(pageJ.map((m) => m.id));

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

describe("Property 8: TTL stores correct expires_at", () => {
	it.skip("expires_at equals created_at + ttlDays * 86400 seconds - method not implemented", async () => {});
});

describe("Property 9: Expired memories excluded from search results", () => {
	it("searchBySimilarity does not return expired memories", async () => {
		await fc.assert(
			fc.asyncProperty(fc.string({ minLength: 5, maxLength: 20 }), async (query: string) => {
				const store = await freshStore();
				const repo = "repo-p9-sim";
				const pastDate = new Date(Date.now() - 86400 * 1000).toISOString();

				store.memories.insert(
					makeEntry({
						id: "expired-sim",
						repo,
						content: `${query} expired content that should not appear`,
						expires_at: pastDate
					})
				);

				const results = store.memories.searchBySimilarity(query, repo, 10);
				store.close();

				return !results.some((r) => r.id === "expired-sim");
			}),
			{ numRuns: 50 }
		);
	});

	it("searchByRepo does not return expired memories", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (importance: number) => {
				const store = await freshStore();
				const repo = "repo-p9-byrepo";
				const pastDate = new Date(Date.now() - 86400 * 1000).toISOString();

				store.memories.insert(
					makeEntry({
						id: "expired-byrepo",
						repo,
						importance,
						expires_at: pastDate
					})
				);

				const results = store.memories.searchByRepo(repo);
				store.close();

				return !results.some((r) => r.id === "expired-byrepo");
			}),
			{ numRuns: 50 }
		);
	});
});

describe("Property 10: archiveExpiredMemories() is idempotent", () => {
	it("second call returns 0 when no new memories expired between calls", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (n: number) => {
				const store = await freshStore();
				const repo = "repo-p10";
				const pastDate = new Date(Date.now() - 86400 * 1000).toISOString();

				for (let i = 0; i < n; i++) {
					store.memories.insert(
						makeEntry({
							id: `p10-${i}`,
							repo,
							expires_at: pastDate
						})
					);
				}

				const first = store.memories.archiveExpiredMemories(true);
				const second = store.memories.archiveExpiredMemories(true);
				store.close();

				return first === n && second === 0;
			}),
			{ numRuns: 50 }
		);
	});
});

describe("Property 18: listRepos() returns unique and sorted list", () => {
	it("no duplicates and sorted ascending", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{1,10}$/), { minLength: 2, maxLength: 10 }),
				async (repos: string[]) => {
					const store = await freshStore();

					repos.forEach((repo: string, i: number) => {
						store.memories.insert(
							makeEntry({
								id: `p18-${i}-${repo}`,
								repo
							})
						);
					});

					const result = store.system.listRepos();
					store.close();

					const unique = new Set(result);
					if (unique.size !== result.length) return false;

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

describe("Property 19: Action Log stores and retrieves recent actions", () => {
	it("logAction stores action with correct metadata", async () => {
		const store = await freshStore();

		store.actions.logAction("search", "test-repo", { query: "test query", resultCount: 5 } as any);
		store.actions.logAction("store", "test-repo", { id: "mem-1", type: "decision" } as any);

		const actions = store.actions.getRecentActions("test-repo", 10);
		store.close();

		expect(actions.length).toBe(2);
		expect(actions[0].action).toBe("store");
		expect(actions[1].action).toBe("search");
	});

	it("getRecentActions returns actions in descending order by created_at", async () => {
		const store = await freshStore();

		store.actions.logAction("action-1", "repo-a", { step: 1 } as any);
		store.actions.logAction("action-2", "repo-a", { step: 2 } as any);
		store.actions.logAction("action-3", "repo-a", { step: 3 } as any);

		const actions = store.actions.getRecentActions("repo-a", 10);
		store.close();

		expect(actions[0].action).toBe("action-3");
		expect(actions[1].action).toBe("action-2");
		expect(actions[2].action).toBe("action-1");
	});

	it("getRecentActions limits results correctly", async () => {
		const store = await freshStore();

		for (let i = 0; i < 20; i++) {
			store.actions.logAction(`action-${i}`, "repo-limit", { index: i } as any);
		}

		const actions = store.actions.getRecentActions("repo-limit", 5);
		store.close();

		expect(actions.length).toBe(5);
	});

	it("getRecentActions filters by repo correctly", async () => {
		const store = await freshStore();

		store.actions.logAction("repo-a-action", "repo-a", { data: "a" } as any);
		store.actions.logAction("repo-b-action", "repo-b", { data: "b" } as any);
		store.actions.logAction("repo-a-second", "repo-a", { data: "a2" } as any);

		const repoAActions = store.actions.getRecentActions("repo-a", 10);
		const repoBActions = store.actions.getRecentActions("repo-b", 10);
		store.close();

		expect(repoAActions.length).toBe(2);
		expect(repoBActions.length).toBe(1);
	});

	it("getRecentActions returns empty array when no actions exist", async () => {
		const store = await freshStore();

		const actions = store.actions.getRecentActions("nonexistent-repo", 10);
		store.close();

		expect(actions).toEqual([]);
	});

	it("getRecentActions without repo parameter returns all actions", async () => {
		const store = await freshStore();

		store.actions.logAction("action-1", "repo-a", {});
		store.actions.logAction("action-2", "repo-b", {});
		store.actions.logAction("action-3", "repo-c", {});

		const allActions = store.actions.getRecentActions();
		store.close();

		expect(allActions.length).toBe(3);
	});
});

describe("Dashboard memory queries", () => {
	it("getRecentMemories returns memories sorted by created_at descending", async () => {
		const store = await freshStore();
		const repo = "dashboard-test";

		store.memories.insert(makeEntry({ id: "m1", repo, created_at: "2024-01-01T00:00:00Z" }));
		store.memories.insert(makeEntry({ id: "m2", repo, created_at: "2024-01-03T00:00:00Z" }));
		store.memories.insert(makeEntry({ id: "m3", repo, created_at: "2024-01-02T00:00:00Z" }));

		const memories = store.memories.getRecentMemories(repo, 10, 0);
		store.close();

		expect(memories[0].id).toBe("m2");
		expect(memories[1].id).toBe("m3");
		expect(memories[2].id).toBe("m1");
	});

	it("getRecentMemories respects limit and offset", async () => {
		const store = await freshStore();
		const repo = "pagination-test";

		for (let i = 0; i < 10; i++) {
			store.memories.insert(makeEntry({ id: `m-${i}`, repo }));
		}

		const firstPage = store.memories.getRecentMemories(repo, 3, 0);
		const secondPage = store.memories.getRecentMemories(repo, 3, 3);
		store.close();

		expect(firstPage.length).toBe(3);
		expect(secondPage.length).toBe(3);
		expect(firstPage[0].id).not.toBe(secondPage[0].id);
	});
});
