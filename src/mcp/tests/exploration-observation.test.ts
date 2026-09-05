import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../router";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";

describe("exploration observation tools", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let router: ReturnType<typeof createRouter>;

	beforeEach(async () => {
		db = await createTestStore();
		router = createRouter(db, new StubVectorStore(db));
	});

	it("installs the v30 schema, indexes, foreign key, and idempotent migration", () => {
		expect(SCHEMA_VERSION).toBe(30);
		const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
			name: string;
		}>;
		expect(tables.map(({ name }) => name)).toEqual(
			expect.arrayContaining(["exploration_observations", "exploration_evidence"])
		);
		const indexes = db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
			name: string;
		}>;
		expect(indexes.map(({ name }) => name)).toEqual(
			expect.arrayContaining([
				"idx_exploration_obs_scope_subject",
				"idx_exploration_obs_scope_task",
				"idx_exploration_obs_scope_confidence",
				"idx_exploration_evidence_file",
				"idx_exploration_evidence_symbol"
			])
		);
		const foreignKeys = db.db.prepare("PRAGMA foreign_key_list(exploration_evidence)").all() as Array<{
			table: string;
			from: string;
			to: string;
			on_delete: string;
		}>;
		expect(foreignKeys).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					table: "exploration_observations",
					from: "observation_id",
					to: "id",
					on_delete: "CASCADE"
				})
			])
		);

		db.db.prepare("DELETE FROM _schema_version WHERE version = 30").run();
		expect(() => new MigrationManager(db.db).migrate()).not.toThrow();
		expect(db.db.prepare("SELECT COUNT(*) AS count FROM _schema_version WHERE version = 30").get()).toEqual({
			count: 1
		});
	});

	it("publishes 20 observations atomically and deduplicates retries", async () => {
		const observations = Array.from({ length: 20 }, (_, index) => ({
			subject: `symbol-${index}`,
			fact: `Symbol ${index} validates input before writing.`,
			confidence: 0.9,
			agent: "explorer",
			task_id: "task-1",
			evidence: [{ file_path: `src/file-${index}.ts`, symbol_id: `symbol-${index}`, start_line: 10, end_line: 14 }]
		}));

		const first = (await router("tools/call", {
			name: "observation-write",
			arguments: { owner: "test", repo: "repo", observations, json: true }
		})) as any;
		expect(first.isError).toBe(false);
		expect(first.structuredContent.created).toBe(20);
		expect(first.structuredContent.deduplicated).toBe(0);

		const retry = (await router("tools/call", {
			name: "observation-write",
			arguments: { owner: "test", repo: "repo", observations, json: true }
		})) as any;
		expect(retry.structuredContent.created).toBe(0);
		expect(retry.structuredContent.deduplicated).toBe(20);
		expect(db.db.prepare("SELECT COUNT(*) AS count FROM exploration_observations").get()).toEqual({ count: 20 });
		expect(db.db.prepare("SELECT COUNT(*) AS count FROM exploration_evidence").get()).toEqual({ count: 20 });
	});

	it("keeps idempotent retries byte-stable", async () => {
		const args = {
			owner: "test",
			repo: "repo",
			subject: "cache",
			fact: "Cache keys include repository scope.",
			confidence: 0.88,
			evidence: [{ file_path: "src/cache.ts", symbol_id: "cacheKey", start_line: 3, end_line: 6 }],
			json: true
		};
		const first = (await router("tools/call", { name: "observation-write", arguments: args })) as any;
		const id = first.structuredContent.results[0].id;
		const before = db.db.prepare("SELECT * FROM exploration_observations WHERE id = ?").get(id);
		const evidenceBefore = db.db.prepare("SELECT * FROM exploration_evidence WHERE observation_id = ?").all(id);

		const retry = (await router("tools/call", { name: "observation-write", arguments: args })) as any;
		expect(retry.structuredContent.deduplicated).toBe(1);
		expect(db.db.prepare("SELECT * FROM exploration_observations WHERE id = ?").get(id)).toEqual(before);
		expect(db.db.prepare("SELECT * FROM exploration_evidence WHERE observation_id = ?").all(id)).toEqual(
			evidenceBefore
		);
	});

	it("rejects an end line without a start line", async () => {
		const response = (await router("tools/call", {
			name: "observation-write",
			arguments: {
				owner: "test",
				repo: "repo",
				subject: "invalid-range",
				fact: "An end-only evidence range is ambiguous.",
				confidence: 0.8,
				evidence: [{ file_path: "src/a.ts", end_line: 10 }]
			}
		})) as any;
		expect(response.isError).toBe(true);
		expect(db.db.prepare("SELECT COUNT(*) AS count FROM exploration_observations").get()).toEqual({ count: 0 });
	});

	it("rolls back the entire bulk when one observation is malformed", async () => {
		const response = (await router("tools/call", {
			name: "observation-write",
			arguments: {
				owner: "test",
				repo: "repo",
				observations: [
					{
						subject: "valid",
						fact: "A valid high-signal fact.",
						confidence: 0.8,
						evidence: [{ file_path: "src/a.ts" }]
					},
					{ subject: "invalid", fact: "Missing evidence.", confidence: 0.8, evidence: [] }
				],
				json: true
			}
		})) as any;
		expect(response.isError).toBe(true);
		expect(db.db.prepare("SELECT COUNT(*) AS count FROM exploration_observations").get()).toEqual({ count: 0 });
	});

	it("isolates owner/repo and queries by task, subject, file, symbol, and confidence", async () => {
		for (const owner of ["alpha", "beta"]) {
			await router("tools/call", {
				name: "observation-write",
				arguments: {
					owner,
					repo: "repo",
					subject: "checkout",
					fact: `${owner} checkout validates inventory.`,
					confidence: owner === "alpha" ? 0.95 : 0.5,
					task_id: "task-7",
					agent: "explorer",
					evidence: [{ file_path: "src/checkout.ts", symbol_id: "checkout", start_line: 4, end_line: 9 }],
					json: true
				}
			});
		}

		const response = (await router("tools/call", {
			name: "observation-read",
			arguments: {
				owner: "alpha",
				repo: "repo",
				subject: "checkout",
				task_id: "task-7",
				file_path: "src/checkout.ts",
				symbol_id: "checkout",
				min_confidence: 0.9,
				json: true
			}
		})) as any;
		expect(response.structuredContent.count).toBe(1);
		expect(response.structuredContent.observations.rows[0]).toContain("alpha checkout validates inventory.");
	});

	it("updates an observation in scope while preserving its identity and replacing evidence", async () => {
		const created = (await router("tools/call", {
			name: "observation-write",
			arguments: {
				owner: "test",
				repo: "repo",
				subject: "parser",
				fact: "Parser accepts the legacy shape.",
				confidence: 0.7,
				evidence: [{ file_path: "src/legacy.ts", start_line: 2, end_line: 4 }],
				json: true
			}
		})) as any;
		const id = created.structuredContent.results[0].id;

		const updated = (await router("tools/call", {
			name: "observation-write",
			arguments: {
				owner: "test",
				repo: "repo",
				id,
				subject: "parser",
				fact: "Parser accepts only the canonical shape.",
				confidence: 0.98,
				evidence: [{ file_path: "src/parser.ts", symbol_id: "parse", start_line: 8, end_line: 12 }],
				json: true
			}
		})) as any;
		expect(updated.isError).toBe(false);
		expect(updated.structuredContent.mode).toBe("update");
		expect(updated.structuredContent.results[0].id).toBe(id);

		const detail = (await router("tools/call", {
			name: "observation-read",
			arguments: { owner: "test", repo: "repo", id, hydrate_evidence: true, json: true }
		})) as any;
		expect(detail.structuredContent.observation.fact).toBe("Parser accepts only the canonical shape.");
		expect(detail.structuredContent.observation.evidence).toHaveLength(1);
		expect(detail.structuredContent.observation.evidence[0].file_path).toBe("src/parser.ts");
		expect(db.db.prepare("SELECT COUNT(*) AS count FROM exploration_observations").get()).toEqual({ count: 1 });
		expect(db.db.prepare("SELECT COUNT(*) AS count FROM exploration_evidence").get()).toEqual({ count: 1 });
	});

	it("keeps compact reads evidence-free and hydrates evidence explicitly", async () => {
		const created = (await router("tools/call", {
			name: "observation-write",
			arguments: {
				owner: "test",
				repo: "repo",
				subject: "writer",
				fact: "Writer commits all evidence atomically.",
				confidence: 1,
				evidence: [{ file_path: "src/writer.ts", start_line: 1, end_line: 20 }],
				json: true
			}
		})) as any;
		const id = created.structuredContent.results[0].id;

		const compact = (await router("tools/call", {
			name: "observation-read",
			arguments: { owner: "test", repo: "repo", json: true }
		})) as any;
		expect(compact.structuredContent.observations.columns).not.toContain("evidence");

		const detail = (await router("tools/call", {
			name: "observation-read",
			arguments: { owner: "test", repo: "repo", id, hydrate_evidence: true, json: true }
		})) as any;
		expect(detail.structuredContent.mode).toBe("detail");
		expect(detail.structuredContent.observation.evidence).toHaveLength(1);
		expect(detail.structuredContent.observation.evidence[0].file_path).toBe("src/writer.ts");
	});
});
