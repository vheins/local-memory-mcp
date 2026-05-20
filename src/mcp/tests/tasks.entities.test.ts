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
		expect((updatedComment as any).non_existent_column).toBeUndefined();
	});
});
