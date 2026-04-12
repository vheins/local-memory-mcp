import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { RealVectorStore } from "../storage/vectors";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

// Global configuration for heavy AI tests
vi.setConfig({ testTimeout: 90000 });

describe("MCP Local Memory - High-Complexity E2E Scenarios", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (
		method: string,
		params: Record<string, unknown>
	) => Promise<{ structuredContent: Record<string, unknown>; contents: Array<{ text: string }> }>;

	const REPO = "enterprise-app-v2";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new RealVectorStore(db);
		router = createRouter(db, vectors);
	});

	/**
	 * SCENARIO 1: Semantic Precision & Ranking
	 * Test if the system can distinguish between closely related topics.
	 */
	it("should maintain high precision ranking among related but distinct technical concepts", async () => {
		const memories = [
			{ title: "Primary Database", content: "We use SQLite for local persistence to ensure local-first capability." },
			{ title: "Cache Layer", content: "Redis is used for session management and fast lookups." },
			{ title: "Database Migration", content: "Run 'npm run migrate' to update the SQLite schema safely." },
			{ title: "Backup Policy", content: "Hourly snapshots of the .db file are stored in the backups folder." },
			{ title: "External API Integration", content: "The system connects to Postgres only for reporting services." }
		];

		for (const m of memories) {
			await router("tools/call", {
				name: "memory-store",
				arguments: {
					type: "decision",
					title: m.title,
					content: m.content,
					importance: 4,
					scope: { repo: REPO },
					agent: "test-agent",
					model: "test-model"
				}
			});
		}

		// QUERY: "How do I update the database?"
		// EXPECT: "Database Migration" should be Top Match, not "Primary Database"
		const searchRes = await router("tools/call", {
			name: "memory-search",
			arguments: { query: "How do I update the database schema?", repo: REPO }
		});

		// New tabular format: results.rows[i] = [id, code, title, type, importance]
		const results = searchRes.structuredContent.results;
		expect(results.rows[0][2]).toBe("Database Migration"); // index 2 = title
		expect(results.rows.length).toBeGreaterThan(1); // Should find related db facts too but lower
	});

	/**
	 * SCENARIO 2: The Correction & Learning Loop
	 * Agent makes a mistake -> Stores it -> Learns -> Replaces it with a pattern.
	 */
	it("should guide the agent away from past mistakes using supersedes and status", async () => {
		// 1. Store a mistake
		const mistakeRes = await router("tools/call", {
			name: "memory-store",
			arguments: {
				type: "mistake",
				title: "Large File Upload Failure",
				content: "Don't use fs.readFileSync for large files, it causes OOM errors.",
				importance: 5,
				scope: { repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const mistakeId = mistakeRes.structuredContent.id;

		// 2. Store the correct pattern that replaces the mistake
		await router("tools/call", {
			name: "memory-store",
			arguments: {
				type: "pattern",
				title: "Streaming File Upload",
				content: "Always use streams (fs.createReadStream) for files > 10MB.",
				importance: 5,
				scope: { repo: REPO },
				agent: "test-agent",
				model: "test-model",
				supersedes: mistakeId
			}
		});

		// 3. Search for "file upload"
		const searchRes = await router("tools/call", {
			name: "memory-search",
			arguments: { query: "How to handle file uploads?", repo: REPO }
		});

		// EXPECT: Mistake is archived and NOT in search results by default
		// New tabular format: results.rows[i] = [id, code, title, type, importance]
		const results = searchRes.structuredContent.results;
		expect(results.rows.some((r: string[]) => r[2] === "Streaming File Upload")).toBe(true);
		expect(results.rows.some((r: string[]) => r[2] === "Large File Upload Failure")).toBe(false);
		expect(results.rows.some((r: string[]) => r[0] === mistakeId)).toBe(false);

		// 4. Audit: Verify we can still find the mistake if we EXPLICITLY ask for archived
		const auditRes = await router("tools/call", {
			name: "memory-search",
			arguments: { query: "file upload", repo: REPO, include_archived: true }
		});
		expect(auditRes.structuredContent.results.rows.some((r: string[]) => r[0] === mistakeId)).toBe(true);
	});

	/**
	 * SCENARIO 3: Workspace-Aware Context Nuance
	 * Boost based on folder depth and language extensions.
	 */
	it("should provide relevant boost when working in deep subdirectories", async () => {
		// Memory A: Global
		await router("tools/call", {
			name: "memory-store",
			arguments: {
				type: "code_fact",
				title: "Global Logging",
				content: "Use logger.info for all modules.",
				importance: 2,
				scope: { repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		// Memory B: Auth Specific
		await router("tools/call", {
			name: "memory-store",
			arguments: {
				type: "code_fact",
				title: "Auth Security Audit",
				content: "Auth module requires PII masking in logs.",
				importance: 5,
				scope: { repo: REPO, folder: "src/auth" },
				agent: "test-agent",
				model: "test-model"
			}
		});

		// Working in a deep auth file
		const searchRes = await router("tools/call", {
			name: "memory-search",
			arguments: {
				query: "How to log data?",
				repo: REPO,
				current_file_path: "src/auth/services/ldap/provider.ts"
			}
		});

		// EXPECT: Auth Specific memory should be the Top Match despite the query being generic "log"
		// New tabular format: results.rows[i] = [id, code, title, type, importance]
		const results = searchRes.structuredContent.results;
		expect(results.rows[0][2]).toBe("Auth Security Audit"); // index 2 = title
	});

	/**
	 * SCENARIO 4: Bulk Operations & Pagination Integrity
	 */
	it("should handle large volumes of memories and maintain pagination integrity", async () => {
		// Store 15 memories about different microservices
		for (let i = 1; i <= 15; i++) {
			await router("tools/call", {
				name: "memory-store",
				arguments: {
					type: "code_fact",
					title: `Service ${i} Specs`,
					content: `Documentation for microservice number ${i} in our mesh network.`,
					importance: 3,
					scope: { repo: "cloud-infra" },
					agent: "test-agent",
					model: "test-model"
				}
			});
		}

		// Call memory-recap (which uses pagination)
		const recapRes = await router("tools/call", {
			name: "memory-recap",
			arguments: { repo: "cloud-infra", limit: 5, offset: 0 }
		});

		// Based on memory-recap implementation
		expect(getPrimaryTextContent(recapRes)).toContain("Service 1 Specs");

		// Check Resource Pagination via URI
		const resourceRes = await router("resources/read", {
			uri: "repository://cloud-infra/memories"
		});
		const entries = JSON.parse(resourceRes.contents[0].text);
		expect(entries.length).toBeLessThanOrEqual(20); // Default limit in resource.read is 20
	});

	/**
	 * SCENARIO 5: Semantic Conflict Denial (Deep Overlap)
	 */
	it("should strictly deny near-duplicate decisions to prevent prompt bloat", async () => {
		const originalContent = "We use TailwindCSS for styling all components.";

		await router("tools/call", {
			name: "memory-store",
			arguments: {
				type: "decision",
				title: "Styling Standard",
				content: originalContent,
				importance: 3,
				scope: { repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		// Try to store almost the same thing with a different title
		const duplicateRes = await router("tools/call", {
			name: "memory-store",
			arguments: {
				type: "decision",
				title: "CSS Rule",
				content: "Use Tailwind CSS for styling our UI components.", // Subtly different but semantically identical
				importance: 3,
				scope: { repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const summaryText = getPrimaryTextContent(duplicateRes);
		expect(summaryText).toContain("conflict");
		expect(summaryText).toContain("Hint:");
		expect(summaryText).toContain("memory-delete");
		expect(db.memories.getTotalCount(REPO)).toBe(1); // Should still be 1
	});

	/**
	 * SCENARIO 6: Cross-Project Knowledge Sharing (Tech-Stack Affinity)
	 * Repository A has Filament knowledge. Repository B (new) should access it via tags.
	 */
	it("should share knowledge across projects using tech-stack affinity tags", async () => {
		// 1. Store Filament best practice in Repo A
		await router("tools/call", {
			name: "memory-store",
			arguments: {
				type: "pattern",
				title: "Filament Custom Action",
				content: "Always use ->requiresConfirmation() for destructive actions in Filament.",
				importance: 5,
				scope: { repo: "project-a" },
				agent: "test-agent",
				model: "test-model",
				tags: ["filament", "laravel"]
			}
		});

		// 2. Search in Repo B (which is empty) with "filament" tag
		const searchRes = await router("tools/call", {
			name: "memory-search",
			arguments: {
				query: "how to make safe actions?",
				repo: "project-b",
				current_tags: ["filament"]
			}
		});

		// EXPECT: Should find the "Filament Custom Action" from Project A
		// New tabular format: results.rows[i] = [id, code, title, type, importance]
		const results = searchRes.structuredContent.results;
		expect(results.rows[0][2]).toBe("Filament Custom Action"); // index 2 = title
		// scope is not returned in pointer table — use memory://<id> to fetch full details
	});
});
