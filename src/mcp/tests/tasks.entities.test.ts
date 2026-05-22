import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore } from "../storage/sqlite";


describe("TaskEntity - updateTaskComment", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;


	beforeEach(async () => {
		db = await createTestStore();

	});

	it("should only update valid columns and ignore invalid ones", () => {
		// Insert a task first due to foreign key constraints if any (we'll just insert directly or use a task if needed, let's see)
		// Usually tasks.ts handles this or sqlite handles it. Let's create a task and a comment.

		const taskId = "task-123";
		db.tasks.insertTask({
			id: taskId,
			repo: "test-repo",
			task_code: "TASK-123",
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

		const commentId = "comment-123";
		db.tasks.insertTaskComment({
			id: commentId,
			task_id: taskId,
			repo: "test-repo",
			comment: "Initial comment",
			agent: "test-agent",
			role: "test-role",
			model: "test-model",
			previous_status: null,
			next_status: null,
			created_at: new Date().toISOString()
		});

		// Now attempt to update with invalid keys
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
		db.tasks.insertTask({
			id: taskId,
			repo: "test-repo",
			task_code: "TASK-EMPTY",
			phase: "execute",
			title: "Empty Test",
			description: "",
			status: "pending",
			priority: "medium",
			agent: "test",
			role: "test",
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

		const commentId = "comment-empty";
		db.tasks.insertTaskComment({
			id: commentId,
			task_id: taskId,
			repo: "test-repo",
			comment: "Original",
			agent: "test",
			role: "test",
			model: "test",
			previous_status: null,
			next_status: null,
			created_at: new Date().toISOString()
		});

		// Empty update
		db.tasks.updateTaskComment(commentId, {});

		const updated = db.tasks.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Original");
	});

	it("should not update if all keys are invalid", () => {
		const taskId = "task-inv";
		db.tasks.insertTask({
			id: taskId,
			repo: "test-repo",
			task_code: "TASK-INV",
			phase: "execute",
			title: "Inv Test",
			description: "",
			status: "pending",
			priority: "medium",
			agent: "test",
			role: "test",
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

		const commentId = "comment-inv";
		db.tasks.insertTaskComment({
			id: commentId,
			task_id: taskId,
			repo: "test-repo",
			comment: "Original",
			agent: "test",
			role: "test",
			model: "test",
			previous_status: null,
			next_status: null,
			created_at: new Date().toISOString()
		});

		db.tasks.updateTaskComment(commentId, {
			"invalid_key": "val1",
			"task_id": "new-task-id", // task_id should be ignored
			"created_at": new Date().toISOString() // created_at should be ignored
		} as any);

		const updated = db.tasks.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Original");
		expect(updated?.task_id).toBe(taskId);
	});

	it("should not update valid keys with undefined values", () => {
		const taskId = "task-undef";
		db.tasks.insertTask({
			id: taskId,
			repo: "test-repo",
			task_code: "TASK-UNDEF",
			phase: "execute",
			title: "Undef Test",
			description: "",
			status: "pending",
			priority: "medium",
			agent: "test",
			role: "test",
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

		const commentId = "comment-undef";
		db.tasks.insertTaskComment({
			id: commentId,
			task_id: taskId,
			repo: "test-repo",
			comment: "Original",
			agent: "test",
			role: "test",
			model: "test",
			previous_status: null,
			next_status: null,
			created_at: new Date().toISOString()
		});

		db.tasks.updateTaskComment(commentId, {
			comment: undefined,
			agent: "new-agent"
		});

		const updated = db.tasks.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Original");
		expect(updated?.agent).toBe("new-agent");
	});
});
