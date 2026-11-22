/**
 * FIX-002 (TASK-003) — half-archived task detection and repair.
 *
 * Covers the two required directions of the reconciliation contract from
 * ADR-012 §Risks and Mitigations:
 *   positive — an archive failure leaves a DETECTABLE state (response
 *              `archiveStatus` + durable `metadata.archive_pending` marker),
 *              and the startup reconciliation repairs it exactly once;
 *   negative — a successful archive followed by reconciliation is a no-op and
 *              never produces a second `task_archive` memory.
 *
 * The archive spans two files (`tasks.db` + core `memory.db`) by design, so no
 * test here asserts atomicity — only detectability + idempotent repair.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleTaskWrite } from "../tools/task.write";
import { reconcileTaskArchives } from "../services/task-archive-reconcile";
import type { MemoryEntry, Task, VectorStore } from "../types";

const OWNER = "test";
const REPO = "task-archive-reconcile";

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
	const now = new Date().toISOString();
	return {
		id,
		owner: OWNER,
		repo: REPO,
		task_code: `TASK-${id.slice(-4)}`,
		phase: "test",
		title: `Task ${id.slice(-4)}`,
		description: `Description for ${id}`,
		status: "in_progress",
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
		in_progress_at: now,
		commit_id: null,
		changed_files: [],
		...overrides
	};
}

describe("FIX-002 half-archived task reconciliation", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		db.close();
	});

	function taskArchiveMemories(): MemoryEntry[] {
		return db.memories.getRecentMemories(OWNER, REPO, 100).filter((m) => m.type === "task_archive");
	}

	function pendingMarker(taskId: string): unknown {
		return (db.tasks.getTaskById(taskId)?.metadata as Record<string, unknown> | undefined)?.archive_pending;
	}

	it("surfaces an archive failure and reconciles it to exactly one archive memory", async () => {
		const task = makeTask("aaaaaaaa-0000-4000-a000-000000000001");
		db.tasks.insertTask(task);

		// Force the memory INSERT to throw — simulates the cross-file archive
		// failure this task exists to detect.
		const insertSpy = vi.spyOn(db.memories, "insert").mockImplementation(() => {
			throw new Error("injected archive failure");
		});

		const response = await handleTaskWrite(
			{ owner: OWNER, repo: REPO, id: task.id, status: "completed", comment: "done", json: true },
			db,
			vectors
		);

		// The task status IS committed (the completion is not rolled back), and
		// the failure is DETECTABLE: response payload + durable marker.
		expect(db.tasks.getTaskById(task.id)!.status).toBe("completed");
		expect(taskArchiveMemories()).toHaveLength(0);
		expect(pendingMarker(task.id)).toBeTruthy();
		const archiveStatus = (response.structuredContent as { archiveStatus?: { status: string; task_ids: string[] } })
			.archiveStatus;
		expect(archiveStatus?.status).toBe("pending");
		expect(archiveStatus?.task_ids).toContain(task.id);

		// Heal the injected failure, then reconcile.
		insertSpy.mockRestore();
		const first = await reconcileTaskArchives(db, vectors);
		expect(first.skipped).toBe(false);
		expect(first.repaired).toBe(1);
		expect(first.failed).toBe(0);

		// Exactly one archive memory, linked by metadata.task_id, marker cleared.
		const archives = taskArchiveMemories();
		expect(archives).toHaveLength(1);
		expect((archives[0].metadata as { task_id?: string }).task_id).toBe(task.id);
		expect(pendingMarker(task.id)).toBeUndefined();

		// Idempotent: a second run is a no-op and never duplicates the archive.
		const second = await reconcileTaskArchives(db, vectors);
		expect(second.scanned).toBe(0);
		expect(second.repaired).toBe(0);
		expect(taskArchiveMemories()).toHaveLength(1);
	});

	it("is a no-op when the archive succeeded (negative case)", async () => {
		const task = makeTask("bbbbbbbb-0000-4000-a000-000000000002");
		db.tasks.insertTask(task);

		await handleTaskWrite(
			{ owner: OWNER, repo: REPO, id: task.id, status: "completed", comment: "done", json: true },
			db,
			vectors
		);

		expect(db.tasks.getTaskById(task.id)!.status).toBe("completed");
		expect(taskArchiveMemories()).toHaveLength(1);
		expect(pendingMarker(task.id)).toBeUndefined();

		const result = await reconcileTaskArchives(db, vectors);
		expect(result.scanned).toBe(0);
		expect(result.repaired).toBe(0);
		expect(result.alreadyArchived).toBe(0);
		expect(taskArchiveMemories()).toHaveLength(1);
	});

	it("clears a stale marker without creating a second archive", async () => {
		const task = makeTask("cccccccc-0000-4000-a000-000000000003");
		db.tasks.insertTask(task);

		await handleTaskWrite(
			{ owner: OWNER, repo: REPO, id: task.id, status: "completed", comment: "done", json: true },
			db,
			vectors
		);
		expect(taskArchiveMemories()).toHaveLength(1);

		// Simulate a crash between the memory INSERT and the marker clear.
		db.tasks.updateTask(task.id, {
			metadata: { ...(db.tasks.getTaskById(task.id)!.metadata ?? {}), archive_pending: { at: "x", error: "y" } }
		});

		const result = await reconcileTaskArchives(db, vectors);
		expect(result.scanned).toBe(1);
		expect(result.alreadyArchived).toBe(1);
		expect(result.repaired).toBe(0);
		expect(taskArchiveMemories()).toHaveLength(1);
		expect(pendingMarker(task.id)).toBeUndefined();
	});
});
