import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore } from "../storage/sqlite";
import type { SQLiteStore } from "../storage/sqlite";


function createTaskWithComment(
	db: SQLiteStore,
	overrides: { taskId?: string; commentId?: string; repo?: string } = {}
): { taskId: string; commentId: string } {
	const taskId = overrides.taskId || "task-default";
	const commentId = overrides.commentId || "comment-default";
	const repo = overrides.repo || "test-repo";
	const now = new Date().toISOString();

	db.tasks.insertTask({
		id: taskId,
		repo,
		task_code: "TASK-" + taskId,
		phase: "execute",
		title: "Test Task",
		description: "Test Description",
		status: "pending",
		priority: 3,
		agent: "test",
		role: "test",
		doc_path: null,
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
	});

	db.taskComments.insertTaskComment({
		id: commentId,
		task_id: taskId,
		repo,
		comment: "Initial comment",
		agent: "test",
		role: "test",
		model: "test",
		previous_status: null,
		next_status: null,
		created_at: now
	});

	return { taskId, commentId };
}

describe("TaskEntity - updateTaskComment", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;

	beforeEach(async () => {
		db = await createTestStore();
	});

	it("should only update valid columns and ignore invalid ones", () => {
		const { commentId } = createTaskWithComment(db, { commentId: "comment-123", taskId: "task-123" });

		// Now attempt to update with invalid keys
		const updates = {
			comment: "Updated comment",
			"non_existent_column": "evil_value",
			"comment = 'hacked', agent": "evil_agent"
		};

		db.taskComments.updateTaskComment(commentId, updates as any);

		const updatedComment = db.taskComments.getTaskCommentById(commentId);

		expect(updatedComment).not.toBeNull();
		expect(updatedComment?.comment).toBe("Updated comment");
		// Ensure the non-existent column wasn't added to the object and didn't crash sqlite
		expect((updatedComment as any).non_existent_column).toBeUndefined();
	});

	it("should handle empty updates ({}) gracefully", () => {
		const { commentId } = createTaskWithComment(db, { commentId: "comment-empty", taskId: "task-empty" });

		db.taskComments.updateTaskComment(commentId, {});

		const updated = db.taskComments.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Initial comment");
	});

	it("should not update if all keys are invalid", () => {
		const { commentId, taskId } = createTaskWithComment(db, { commentId: "comment-inv", taskId: "task-inv" });

		db.taskComments.updateTaskComment(commentId, {
			"invalid_key": "val1",
			"task_id": "new-task-id",
			"created_at": new Date().toISOString()
		} as any);

		const updated = db.taskComments.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Initial comment");
		expect(updated?.task_id).toBe(taskId);
	});

	it("should not update valid keys with undefined values", () => {
		const { commentId } = createTaskWithComment(db, { commentId: "comment-undef", taskId: "task-undef" });

		db.taskComments.updateTaskComment(commentId, {
			comment: undefined,
			agent: "new-agent"
		});

		const updated = db.taskComments.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Initial comment");
		expect(updated?.agent).toBe("new-agent");
	});
});
