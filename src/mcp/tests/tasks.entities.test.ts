import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore } from "../storage/sqlite";

describe("TaskEntity - updateTaskComment", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;

	beforeEach(async () => {
		db = await createTestStore();
	});

	function createTaskWithComment(taskId: string, commentId: string) {
		db.tasks.insertTask({
			id: taskId,
			repo: "test-repo",
			task_code: taskId.toUpperCase(),
			phase: "execute",
			title: "Test Task",
			description: "Test Description",
			status: "pending",
			priority: "medium",
			agent: "test-agent",
			role: "test-role",
			doc_path: null,
			finished_at: null,
			canceled_at: null,
			tags: null,
			metadata: null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			parent_id: null,
			depends_on: null,
			est_tokens: null,
			in_progress_at: null,
			commit_id: null,
			changed_files: null
		});

		db.tasks.insertTaskComment({
			id: commentId,
			task_id: taskId,
			repo: "test-repo",
			comment: "Original comment",
			agent: "test-agent",
			role: "test-role",
			model: "test-model",
			previous_status: null,
			next_status: null,
			created_at: new Date().toISOString()
		});
	}

	it("should only update valid columns and ignore invalid ones", () => {
		const taskId = "task-123";
		const commentId = "comment-123";
		createTaskWithComment(taskId, commentId);

		const updates = {
			comment: "Updated comment",
			"non_existent_column": "evil_value",
			"comment = 'hacked', agent": "evil_agent"
		};

		// The any cast is needed because typescript would prevent passing invalid keys,
		// but at runtime or via API endpoints this can happen
		db.tasks.updateTaskComment(commentId, updates as any);

		const updatedComment = db.tasks.getTaskCommentById(commentId);

		expect(updatedComment).not.toBeNull();
		expect(updatedComment?.comment).toBe("Updated comment");
		// Ensure the non-existent column wasn't added to the object and didn't crash sqlite
		expect((updatedComment as any).non_existent_column).toBeUndefined();
	});

	it("should handle empty updates ({}) gracefully", () => {
		const taskId = "task-empty";
		const commentId = "comment-empty";
		createTaskWithComment(taskId, commentId);

		// Empty update
		db.tasks.updateTaskComment(commentId, {});

		const updated = db.tasks.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Original comment");
	});

	it("should not update if all keys are invalid", () => {
		const taskId = "task-inv";
		const commentId = "comment-inv";
		createTaskWithComment(taskId, commentId);

		db.tasks.updateTaskComment(commentId, {
			"invalid_key": "val1",
			"task_id": "new-task-id", // task_id should be ignored
			"created_at": new Date().toISOString() // created_at should be ignored
		} as any);

		const updated = db.tasks.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Original comment");
		expect(updated?.task_id).toBe(taskId);
	});

	it("should not update valid keys with undefined values", () => {
		const taskId = "task-undef";
		const commentId = "comment-undef";
		createTaskWithComment(taskId, commentId);

		db.tasks.updateTaskComment(commentId, {
			comment: undefined,
			agent: "new-agent"
		});

		const updated = db.tasks.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Original comment");
		expect(updated?.agent).toBe("new-agent");
	});
});
