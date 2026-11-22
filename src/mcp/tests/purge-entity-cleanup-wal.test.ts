/**
 * File-mode (real WAL) regression for the purge ordering — FIX-006.
 *
 * `purgeEntityAndCleanup` deletes `queue_jobs` (core file `memory.db`) and then
 * mutates the entity (`tasks.db` / `standards.db`), in two separate transactions.
 * That split only means something if the databases really are separate FILES in
 * `journal_mode=wal`: a transaction spanning attached databases is not atomic
 * under WAL, and an in-memory store (`journal_mode=memory`) would silently
 * re-create the all-or-nothing illusion these tests exist to disprove.
 *
 * So every test here opens a store on a real temp directory and asserts WAL for
 * each database BEFORE exercising the purge. `assertAllWal` is itself covered by
 * a `:memory:` case that must fail, so the guard cannot go vacuous unnoticed.
 *
 * FIX-011 adds the standard vector split to the same file-mode proof: the
 * `coding_standards` row (standards.db) and its `standard_vectors` row
 * (codebase.db) are deleted in separate phases, and a phase-3 crash must leave
 * only the unreachable vector.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { SQLiteStore, createTestStore } from "../storage/sqlite";
import { DOMAIN_SCHEMAS } from "../storage/domain-schema";
import { purgeEntityAndCleanup } from "../utils/purge-entity-cleanup";
import type { CodingStandardEntry, Task } from "../types";

const OWNER = "test";
const REPO = "purge-wal";

const tempDirs: string[] = [];

/** Create a temp directory tracked for cleanup (never touches the sandbox DB). */
function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmm-purge-wal-"));
	tempDirs.push(dir);
	return dir;
}

/** Every database on the connection: the hot store, derived, and the four domain files. */
const ALL_SCHEMAS = ["main", "derived", ...DOMAIN_SCHEMAS];

/** Current `journal_mode` of one database on the connection. */
function journalMode(store: SQLiteStore, schema: string): string {
	return store.db.pragma(`${schema}.journal_mode`, { simple: true }) as string;
}

/**
 * Assert every database on the connection really runs `journal_mode=wal`.
 *
 * Throws (rather than asserting) so the `:memory:` case below can prove the
 * check is real: an in-memory database reports `memory`, never `wal`.
 */
function assertAllWal(store: SQLiteStore): void {
	for (const schema of ALL_SCHEMAS) {
		const mode = journalMode(store, schema);
		if (mode !== "wal") {
			throw new Error(`${schema} runs journal_mode=${mode}; these tests require journal_mode=wal`);
		}
	}
}

/** Physical tables of a standalone database file, read from its own schema. */
function tablesOfFile(filePath: string): Set<string> {
	const db = new Database(filePath, { readonly: true, fileMustExist: true });
	try {
		const rows = db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table'").all() as Array<{
			name: string;
		}>;
		return new Set(rows.map((row) => row.name));
	} finally {
		db.close();
	}
}

/** Direct queue_jobs insert — the purge path only cares about (kind, id). */
function insertQueueJob(store: SQLiteStore, kind: string, entityId: string): void {
	const now = new Date().toISOString();
	store.db
		.prepare(
			`INSERT INTO queue_jobs (id, entity_kind, entity_id, entity_repo, payload, status, attempts, created_at, updated_at)
			 VALUES (?, ?, ?, ?, '{}', 'pending', 0, ?, ?)`
		)
		.run(randomUUID(), kind, entityId, REPO, now, now);
}

/** Count pending queue jobs for one entity. */
function countQueueJobs(store: SQLiteStore, kind: string, entityId: string): number {
	const row = store.db
		.prepare("SELECT COUNT(*) AS c FROM queue_jobs WHERE entity_kind = ? AND entity_id = ?")
		.get(kind, entityId) as { c: number };
	return row.c;
}

/**
 * Count `derived.standard_vectors` rows PHYSICALLY — no JOIN, so an orphan
 * vector (row deleted, vector left behind) is still visible here.
 */
function countStandardVectors(store: SQLiteStore, standardId: string): number {
	const row = store.db
		.prepare("SELECT COUNT(*) AS c FROM derived.standard_vectors WHERE standard_id = ?")
		.get(standardId) as { c: number };
	return row.c;
}

function makeTask(id: string): Task {
	const now = new Date().toISOString();
	return {
		id,
		owner: OWNER,
		repo: REPO,
		task_code: `TASK-${id}`,
		phase: "test",
		title: `Task ${id}`,
		description: `Description for ${id}`,
		status: "pending",
		priority: 3,
		agent: "test",
		role: "test",
		doc_path: null,
		suggested_skills: [],
		finished_at: null,
		canceled_at: null,
		tags: [],
		metadata: {},
		created_at: now,
		updated_at: now,
		parent_id: null,
		depends_on: null,
		est_tokens: 0,
		in_progress_at: null,
		commit_id: null,
		changed_files: []
	};
}

function makeStandard(id: string): CodingStandardEntry {
	const now = new Date().toISOString();
	return {
		id,
		title: `Standard ${id}`,
		content: `Content for ${id}`,
		parent_id: null,
		context: "general",
		version: "1.0.0",
		language: "typescript",
		stack: [],
		is_global: false,
		owner: OWNER,
		repo: REPO,
		tags: [],
		metadata: {},
		created_at: now,
		updated_at: now,
		hit_count: 0,
		last_used_at: null,
		agent: "test",
		model: "test"
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("purgeEntityAndCleanup on real WAL files (FIX-006)", () => {
	it("rejects an in-memory store, so the WAL premise can never pass vacuously", async () => {
		const mem = await createTestStore();
		try {
			// journal_mode=memory on every database: exactly the mode that hid the
			// cross-file atomicity gap these tests exist to cover.
			expect(() => assertAllWal(mem)).toThrow(/journal_mode=wal/);
		} finally {
			mem.close();
		}
	});

	it("purges the job first, survives a crash between the phases, and completes on retry", () => {
		const dir = makeTempDir();
		const store = new SQLiteStore(path.join(dir, "memory.db"));
		try {
			assertAllWal(store);

			const task = makeTask("aaaaaaaa-0000-4000-a000-000000000001");
			store.tasks.insertTask(task);
			insertQueueJob(store, "task", task.id);

			// Premise: the two writes really target different files.
			expect(tablesOfFile(path.join(dir, "memory.db")).has("queue_jobs")).toBe(true);
			expect(tablesOfFile(path.join(dir, "tasks.db")).has("tasks")).toBe(true);
			expect(tablesOfFile(path.join(dir, "tasks.db")).has("queue_jobs")).toBe(false);

			// Crash between phase 1 (queue_jobs purge) and phase 2 (entity
			// mutation): the entity write throws.
			const crash = vi.spyOn(store.tasks, "updateTask").mockImplementation(() => {
				throw new Error("injected crash between purge phases");
			});
			expect(() => purgeEntityAndCleanup(store, "task", [{ id: task.id, title: task.title, repo: REPO }])).toThrow(
				"injected crash between purge phases"
			);

			// Phase 1 committed on its own — proof the phases are not one
			// cross-file transaction.
			expect(countQueueJobs(store, "task", task.id)).toBe(0);
			// Phase 2 rolled back: the task is still there and still pending.
			expect(store.tasks.getTaskById(task.id)!.status).toBe("pending");
			// Safe state: no job points at a purged entity, and no entity was
			// purged while its job survived.
			expect(countQueueJobs(store, "task", task.id)).toBe(0);

			// Retry: phase 1 is a no-op, phase 2 completes.
			crash.mockRestore();
			expect(purgeEntityAndCleanup(store, "task", [{ id: task.id, title: task.title, repo: REPO }])).toBe(1);
			expect(store.tasks.getTaskById(task.id)!.status).toBe("canceled");
			expect(countQueueJobs(store, "task", task.id)).toBe(0);

			// Re-running a completed purge stays idempotent.
			expect(purgeEntityAndCleanup(store, "task", [{ id: task.id, title: task.title, repo: REPO }])).toBe(1);
			expect(countQueueJobs(store, "task", task.id)).toBe(0);
		} finally {
			store.close();
		}
	});

	it("keeps standards in standards.db and their queue jobs in memory.db across a phase-2 failure", () => {
		const dir = makeTempDir();
		const store = new SQLiteStore(path.join(dir, "memory.db"));
		try {
			assertAllWal(store);

			const a = makeStandard("bbbbbbbb-0000-4000-a000-000000000001");
			const b = makeStandard("bbbbbbbb-0000-4000-a000-000000000002");
			store.standards.insert(a);
			store.standards.insert(b);
			insertQueueJob(store, "standard", a.id);
			insertQueueJob(store, "standard", b.id);

			expect(tablesOfFile(path.join(dir, "standards.db")).has("coding_standards")).toBe(true);
			expect(tablesOfFile(path.join(dir, "memory.db")).has("queue_jobs")).toBe(true);

			// Second delete throws: phase 2 must roll back the first one while
			// phase 1 stays committed.
			const realDelete = store.standards.delete.bind(store.standards);
			let calls = 0;
			const crash = vi.spyOn(store.standards, "delete").mockImplementation((id: string) => {
				calls += 1;
				if (calls === 2) throw new Error("injected phase-2 failure");
				realDelete(id);
			});

			expect(() =>
				purgeEntityAndCleanup(store, "standard", [
					{ id: a.id, title: a.title, repo: REPO },
					{ id: b.id, title: b.title, repo: REPO }
				])
			).toThrow("injected phase-2 failure");

			// Both standards survive (phase 2 rolled back) ...
			expect(store.standards.getById(a.id)).not.toBeNull();
			expect(store.standards.getById(b.id)).not.toBeNull();
			// ... and both jobs are already gone (phase 1 committed first).
			expect(countQueueJobs(store, "standard", a.id)).toBe(0);
			expect(countQueueJobs(store, "standard", b.id)).toBe(0);

			// Retry finishes the purge.
			crash.mockRestore();
			expect(
				purgeEntityAndCleanup(store, "standard", [
					{ id: a.id, title: a.title, repo: REPO },
					{ id: b.id, title: b.title, repo: REPO }
				])
			).toBe(2);
			expect(store.standards.getById(a.id)).toBeNull();
			expect(store.standards.getById(b.id)).toBeNull();
		} finally {
			store.close();
		}
	});

	it("deletes the standard row in phase 2 and its vector in phase 3, so a phase-3 crash leaves only an orphan vector", () => {
		const dir = makeTempDir();
		const store = new SQLiteStore(path.join(dir, "memory.db"));
		try {
			assertAllWal(store);

			const standard = makeStandard("cccccccc-0000-4000-a000-000000000001");
			store.standards.insert(standard);
			store.standards.upsertVectorEmbedding(standard.id, [0.1, 0.2]);
			insertQueueJob(store, "standard", standard.id);

			// Premise: the row and its vector really live in different files.
			const standardsTables = tablesOfFile(path.join(dir, "standards.db"));
			const derivedTables = tablesOfFile(path.join(dir, "codebase.db"));
			expect(standardsTables.has("coding_standards")).toBe(true);
			expect(standardsTables.has("standard_vectors")).toBe(false);
			expect(derivedTables.has("standard_vectors")).toBe(true);
			expect(countStandardVectors(store, standard.id)).toBe(1);

			// Crash between phase 2 (row delete, standards.db) and phase 3
			// (vector delete, codebase.db). Not a :memory: store: WAL is real,
			// so the split is the only reason the row survives on its own.
			const crash = vi.spyOn(store.standards, "removeStandardVector").mockImplementation(() => {
				throw new Error("injected crash between purge phases");
			});
			expect(() =>
				purgeEntityAndCleanup(store, "standard", [{ id: standard.id, title: standard.title, repo: REPO }])
			).toThrow("injected crash between purge phases");

			// Phase 1 committed: no job points at the purged standard.
			expect(countQueueJobs(store, "standard", standard.id)).toBe(0);
			// Phase 2 committed on its own: the row is gone.
			expect(store.standards.getById(standard.id)).toBeNull();
			// Phase 3 rolled back: the vector is still there, physically.
			expect(countStandardVectors(store, standard.id)).toBe(1);
			// ... and unreachable, which is what makes the residue safe: every
			// vector read JOINs coding_standards, so semantic search cannot
			// surface it.
			expect(store.standards.getVectorCandidates(REPO)).toHaveLength(0);

			// Retry: phases 1 and 2 are no-ops, phase 3 finishes the cleanup.
			crash.mockRestore();
			expect(purgeEntityAndCleanup(store, "standard", [{ id: standard.id, title: standard.title, repo: REPO }])).toBe(
				1
			);
			expect(store.standards.getById(standard.id)).toBeNull();
			expect(countStandardVectors(store, standard.id)).toBe(0);

			// Re-running a completed purge stays idempotent.
			expect(purgeEntityAndCleanup(store, "standard", [{ id: standard.id, title: standard.title, repo: REPO }])).toBe(
				1
			);
			expect(store.standards.getById(standard.id)).toBeNull();
			expect(countStandardVectors(store, standard.id)).toBe(0);
			expect(countQueueJobs(store, "standard", standard.id)).toBe(0);
		} finally {
			store.close();
		}
	});
});
