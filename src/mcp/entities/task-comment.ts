import { BaseEntity } from "../storage/base";
import { TaskComment } from "../types";

export class TaskCommentEntity extends BaseEntity {
	insertTaskComment(comment: TaskComment): void {
		this.run(
			`INSERT INTO task_comments (
				id, task_id, repo, comment, agent, role, model, previous_status, next_status, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				comment.id,
				comment.task_id,
				comment.repo,
				comment.comment,
				comment.agent || "unknown",
				comment.role || "unknown",
				comment.model || "unknown",
				comment.previous_status || null,
				comment.next_status || null,
				comment.created_at
			]
		);
	}

	updateTaskComment(id: string, updates: Partial<TaskComment>): void {
		const fields: string[] = [];
		const values: unknown[] = [];
		const anyUpdates = updates as Record<string, unknown>;
		const VALID_COLUMNS = new Set([
			"repo",
			"comment",
			"agent",
			"role",
			"model",
			"previous_status",
			"next_status"
		]);

		Object.keys(updates).forEach((key) => {
			if (VALID_COLUMNS.has(key) && anyUpdates[key] !== undefined) {
				fields.push(`${key} = ?`);
				values.push(anyUpdates[key]);
			}
		});

		if (fields.length === 0) return;

		values.push(id);

		this.run(`UPDATE task_comments SET ${fields.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
	}

	deleteTaskComment(id: string): void {
		this.run("DELETE FROM task_comments WHERE id = ?", [id]);
	}

	getTaskCommentById(id: string): TaskComment | null {
		return this.get<TaskComment>("SELECT * FROM task_comments WHERE id = ?", [id]) ?? null;
	}

	getTaskCommentsByTaskId(taskId: string): TaskComment[] {
		return this.all<TaskComment>(`SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC, id DESC`, [
			taskId
		]);
	}

	getAllTaskCommentsByRepo(repo: string): TaskComment[] {
		return this.all<TaskComment>(`SELECT * FROM task_comments WHERE repo = ? ORDER BY created_at DESC, id DESC`, [
			repo
		]);
	}
}
