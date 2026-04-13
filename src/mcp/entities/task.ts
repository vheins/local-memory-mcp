import { BaseEntity } from "../storage/base";
import { Task, TaskComment, TaskStats } from "../types";

export class TaskEntity extends BaseEntity {
	insertTask(task: Task): void {
		this.run(
			`INSERT INTO tasks (
				id, repo, task_code, phase, title, description, status, priority,
				agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				task.id,
				task.repo,
				task.task_code,
				task.phase || null,
				task.title,
				task.description || null,
				task.status || "backlog",
				task.priority || 3,
				task.agent || "unknown",
				task.role || "unknown",
				task.doc_path || null,
				task.created_at,
				task.updated_at,
				task.finished_at || null,
				task.canceled_at || null,
				task.tags ? JSON.stringify(task.tags) : null,
				task.metadata ? JSON.stringify(task.metadata) : null,
				task.parent_id || null,
				task.depends_on || null,
				task.est_tokens || 0,
				task.in_progress_at || null
			]
		);
	}

	updateTask(id: string, updates: Partial<Task> & { comment?: string; model?: string }): void {
		const fields: string[] = [];
		const values: unknown[] = [];
		const anyUpdates = updates as Record<string, unknown>;
		const VALID_COLUMNS = new Set([
			"repo", "task_code", "phase", "title", "description", "status", "priority",
			"agent", "role", "doc_path", "finished_at", "canceled_at", "tags", "metadata",
			"parent_id", "depends_on", "est_tokens", "in_progress_at"
		]);

		Object.keys(updates).forEach((key) => {
			if (VALID_COLUMNS.has(key) && anyUpdates[key] !== undefined) {
				if (key === "tags" || key === "metadata") {
					fields.push(`${key} = ?`);
					values.push(JSON.stringify(anyUpdates[key]));
				} else {
					fields.push(`${key} = ?`);
					values.push(anyUpdates[key]);
				}
			}
		});

		if (fields.length === 0) return;

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());
		values.push(id);

		this.run(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
	}

	deleteTask(id: string): void {
		this.run("DELETE FROM task_comments WHERE task_id = ?", [id]);
		this.run("DELETE FROM tasks WHERE id = ?", [id]);
	}

	getTaskById(id: string): Task | null {
		const row = this.get<Record<string, unknown>>(
			`SELECT t.*, d.task_code as depends_on_code FROM tasks t LEFT JOIN tasks d ON t.depends_on = d.id WHERE t.id = ?`,
			[id]
		);
		return row ? { ...this.rowToTask(row), comments: this.getTaskCommentsByTaskId(id) } : null;
	}

	getTaskByCode(repo: string, taskCode: string): Task | null {
		const row = this.get<Record<string, unknown>>(
			`SELECT t.*, d.task_code as depends_on_code FROM tasks t LEFT JOIN tasks d ON t.depends_on = d.id WHERE t.repo = ? AND t.task_code = ?`,
			[repo, taskCode]
		);
		return row ? { ...this.rowToTask(row), comments: this.getTaskCommentsByTaskId(row.id as string) } : null;
	}

	getTasksByRepo(repo: string, status?: string, limit?: number, offset?: number, search?: string): Task[] {
		let query = `
			SELECT t.*, d.task_code as depends_on_code,
				(SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comments_count
			FROM tasks t 
			LEFT JOIN tasks d ON t.depends_on = d.id 
			WHERE t.repo = ?
		`;
		const params: (string | number)[] = [repo];

		if (status) {
			query += " AND t.status = ?";
			params.push(status);
		}

		if (search) {
			query += " AND (t.title LIKE ? OR t.description LIKE ? OR t.task_code LIKE ?)";
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern);
		}

		query += ` ORDER BY 
			CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END ASC,
			CASE WHEN t.status = 'completed' THEN t.updated_at ELSE NULL END DESC,
			CASE WHEN t.status = 'in_progress' THEN 0
				WHEN t.status = 'pending' THEN 1
				WHEN t.status = 'backlog' THEN 2
				WHEN t.status = 'blocked' THEN 3
				WHEN t.status = 'canceled' THEN 4
				ELSE 5 END ASC,
			t.priority DESC, 
			t.created_at ASC`;

		if (limit !== undefined) {
			query += " LIMIT ?";
			params.push(limit);
			if (offset !== undefined) {
				query += " OFFSET ?";
				params.push(offset);
			}
		}

		const rows = this.all<Record<string, unknown>>(query, params);
		return rows.map((r) => this.rowToTask(r));
	}

	listRecentTasks(limit = 50, offset = 0): Task[] {
		const query = `
			SELECT t.*, d.task_code as depends_on_code,
				(SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comments_count
			FROM tasks t 
			LEFT JOIN tasks d ON t.depends_on = d.id 
			ORDER BY 
				CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END ASC,
				CASE WHEN t.status = 'completed' THEN t.updated_at ELSE NULL END DESC,
				CASE WHEN t.status = 'in_progress' THEN 0
					WHEN t.status = 'pending' THEN 1
					WHEN t.status = 'backlog' THEN 2
					WHEN t.status = 'blocked' THEN 3
					WHEN t.status = 'canceled' THEN 4
					ELSE 5 END ASC,
				t.priority DESC, 
				t.created_at ASC
			LIMIT ? OFFSET ?
		`;
		const rows = this.all<Record<string, unknown>>(query, [limit, offset]);
		return rows.map((r) => this.rowToTask(r));
	}

	getTasksByMultipleStatuses(
		repo: string,
		statuses: string[],
		limit?: number,
		offset?: number,
		search?: string
	): Task[] {
		if (!statuses.length) return this.getTasksByRepo(repo, undefined, limit, offset, search);

		let query = `
			SELECT t.*, d.task_code as depends_on_code,
				(SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comments_count
			FROM tasks t 
			LEFT JOIN tasks d ON t.depends_on = d.id 
			WHERE t.repo = ? AND t.status IN (${statuses.map(() => "?").join(",")})
		`;
		const params: (string | number)[] = [repo, ...statuses];

		if (search) {
			query += " AND (t.title LIKE ? OR t.description LIKE ? OR t.task_code LIKE ?)";
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern);
		}

		query += ` ORDER BY 
			CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END ASC,
			CASE WHEN t.status = 'completed' THEN t.updated_at ELSE NULL END DESC,
			CASE WHEN t.status = 'in_progress' THEN 0
				WHEN t.status = 'pending' THEN 1
				WHEN t.status = 'backlog' THEN 2
				WHEN t.status = 'blocked' THEN 3
				WHEN t.status = 'canceled' THEN 4
				ELSE 5 END ASC,
			t.priority DESC, 
			t.created_at ASC`;

		if (limit !== undefined) {
			query += " LIMIT ?";
			params.push(limit);
			if (offset !== undefined) {
				query += " OFFSET ?";
				params.push(offset);
			}
		}

		const rows = this.all<Record<string, unknown>>(query, params);
		return rows.map((r) => this.rowToTask(r));
	}

	isTaskCodeDuplicate(repo: string, task_code: string, excludeId?: string): boolean {
		let query = "SELECT COUNT(*) as count FROM tasks WHERE repo = ? AND task_code = ?";
		const params: (string | number)[] = [repo, task_code];

		if (excludeId) {
			query += " AND id != ?";
			params.push(excludeId);
		}

		const row = this.get<{ count: number }>(query, params);
		return (row?.count ?? 0) > 0;
	}

	bulkInsertTasks(tasks: Task[]): number {
		return this.transaction(() => {
			let count = 0;
			for (const task of tasks) {
				this.run(
					`INSERT INTO tasks (
						id, repo, task_code, phase, title, description, status, priority,
						agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						task.id,
						task.repo,
						task.task_code,
						task.phase || null,
						task.title,
						task.description || null,
						task.status || "backlog",
						task.priority || 3,
						task.agent || "unknown",
						task.role || "unknown",
						task.doc_path || null,
						task.created_at,
						task.updated_at,
						task.finished_at || null,
						task.canceled_at || null,
						task.tags ? JSON.stringify(task.tags) : null,
						task.metadata ? JSON.stringify(task.metadata) : null,
						task.parent_id || null,
						task.depends_on || null,
						task.est_tokens || 0,
						task.in_progress_at || null
					]
				);
				count++;
			}
			return count;
		});
	}

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

		Object.keys(updates).forEach((key) => {
			if (anyUpdates[key] !== undefined) {
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

	getTaskStats(repo: string): TaskStats {
		const rows = this.all<{ status: string; count: number }>(
			"SELECT status, COUNT(*) as count FROM tasks WHERE repo = ? GROUP BY status",
			[repo]
		);
		const stats: TaskStats = { total: 0, backlog: 0, todo: 0, inProgress: 0, completed: 0, blocked: 0, canceled: 0 };
		rows.forEach((r) => {
			const count = r.count;
			stats.total += count;
			if (r.status === "backlog") stats.backlog = count;
			else if (r.status === "pending") stats.todo = count;
			else if (r.status === "in_progress") stats.inProgress = count;
			else if (r.status === "completed") stats.completed = count;
			else if (r.status === "blocked") stats.blocked = count;
			else if (r.status === "canceled") stats.canceled = count;
		});
		return stats;
	}

	getTaskTimeStats(
		repo: string,
		period: "daily" | "weekly" | "monthly" | "overall"
	): { completed: number; tokens: number; avgDuration: number; added: number } {
		let dateFilter = "";
		if (period === "daily") dateFilter = "AND date(COALESCE(finished_at, updated_at)) = date('now')";
		else if (period === "weekly") dateFilter = "AND date(COALESCE(finished_at, updated_at)) >= date('now', '-7 days')";
		else if (period === "monthly")
			dateFilter = "AND date(COALESCE(finished_at, updated_at)) >= date('now', '-30 days')";

		const stats = this.get<{ completed_count: number; total_tokens: number; avg_duration_seconds: number }>(
			`SELECT 
				COUNT(*) as completed_count,
				SUM(est_tokens) as total_tokens,
				AVG(
					CASE 
						WHEN in_progress_at IS NOT NULL AND finished_at IS NOT NULL 
						THEN (julianday(finished_at) - julianday(in_progress_at)) * 86400.0 
						ELSE NULL 
					END
				) as avg_duration_seconds
			FROM tasks 
			WHERE repo = ? 
			AND status = 'completed' 
			${dateFilter}`,
			[repo]
		);

		let addedDateFilter = "";
		if (period === "daily") addedDateFilter = "AND date(created_at) = date('now')";
		else if (period === "weekly") addedDateFilter = "AND date(created_at) >= date('now', '-7 days')";
		else if (period === "monthly") addedDateFilter = "AND date(created_at) >= date('now', '-30 days')";

		const added = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM tasks WHERE repo = ? ${addedDateFilter}`, [
			repo
		]);

		return {
			completed: stats?.completed_count || 0,
			tokens: stats?.total_tokens || 0,
			avgDuration: stats?.avg_duration_seconds || 0,
			added: added?.count || 0
		};
	}

	getTaskComparisonSeries(
		repo: string,
		period: "daily" | "weekly" | "monthly" | "overall"
	): { label: string; created: number; completed: number }[] {
		let labelFormat: string;
		let dateFilter: string;

		if (period === "daily") {
			labelFormat = "%H:00";
			dateFilter = "date(COALESCE(finished_at, created_at)) = date('now')";
		} else if (period === "weekly") {
			labelFormat = "%Y-%m-%d";
			dateFilter = "date(COALESCE(finished_at, created_at)) >= date('now', '-6 days')";
		} else if (period === "monthly") {
			labelFormat = "W%W";
			dateFilter = "date(COALESCE(finished_at, created_at)) >= date('now', '-30 days')";
		} else {
			labelFormat = "%Y-%m";
			dateFilter = "1=1";
		}

		const query = `
			SELECT label, SUM(created) as created, SUM(completed) as completed
			FROM (
				SELECT strftime(?, created_at) as label, 1 as created, 0 as completed 
				FROM tasks 
				WHERE repo = ? AND ${dateFilter.replace("COALESCE(finished_at, created_at)", "created_at")}
				UNION ALL
				SELECT strftime(?, COALESCE(finished_at, updated_at)) as label, 0 as created, 1 as completed 
				FROM tasks 
				WHERE repo = ? AND status = 'completed' AND ${dateFilter.replace("COALESCE(finished_at, created_at)", "COALESCE(finished_at, updated_at)")}
			)
			GROUP BY label
			ORDER BY label ASC
			LIMIT 100
		`;

		return this.all<{ label: string; created: number; completed: number }>(query, [
			labelFormat,
			repo,
			labelFormat,
			repo
		]);
	}
}
