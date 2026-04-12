import { BaseEntity } from "../storage/base.js";
import { Task, TaskComment, TaskStats } from "../types.js";

/**
 * Handles all task-related database operations.
 */
export class TaskEntity extends BaseEntity {
	insertTask(task: Task): void {
		const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, repo, task_code, phase, title, description, status, priority,
        agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
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
		);
	}

	updateTask(id: string, updates: Partial<Task> & { comment?: string; model?: string }): void {
		const fields: string[] = [];
		const values: unknown[] = [];
		const anyUpdates = updates as Record<string, unknown>;

		Object.keys(updates).forEach((key) => {
			if (key !== "comment" && key !== "model" && anyUpdates[key] !== undefined) {
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

		const stmt = this.db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`);
		stmt.run(...values);
	}

	deleteTask(id: string): void {
		this.db.prepare("DELETE FROM task_comments WHERE task_id = ?").run(id);
		this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
	}

	getTaskById(id: string): Task | null {
		const row = this.db
			.prepare(
				`
      SELECT t.*, d.task_code as depends_on_code 
      FROM tasks t 
      LEFT JOIN tasks d ON t.depends_on = d.id 
      WHERE t.id = ?
    `
			)
			.get(id) as (Task & { depends_on_code?: string }) | undefined;
		return row ? { ...this.rowToTask(row), comments: this.getTaskCommentsByTaskId(id) } : null;
	}

	getTaskByCode(repo: string, taskCode: string): Task | null {
		const row = this.db
			.prepare(
				`
      SELECT t.*, d.task_code as depends_on_code 
      FROM tasks t 
      LEFT JOIN tasks d ON t.depends_on = d.id 
      WHERE t.repo = ? AND t.task_code = ?
    `
			)
			.get(repo, taskCode) as (Task & { depends_on_code?: string }) | undefined;
		return row ? { ...this.rowToTask(row), comments: this.getTaskCommentsByTaskId(row.id) } : null;
	}

	getTasksByRepo(repo: string, status?: string, limit?: number, offset?: number, search?: string): Task[] {
		let query = `
      SELECT t.*, d.task_code as depends_on_code,
             (SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comments_count
      FROM tasks t 
      LEFT JOIN tasks d ON t.depends_on = d.id 
      WHERE t.repo = ?
    `;
		const params: unknown[] = [repo];

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

		const rows = this.db.prepare(query).all(...params) as (Task & {
			depends_on_code?: string;
			comments_count: number;
		})[];
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
		const rows = this.db.prepare(query).all(limit, offset) as (Task & {
			depends_on_code?: string;
			comments_count: number;
		})[];
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
		const params: unknown[] = [repo, ...statuses];

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

		const rows = this.db.prepare(query).all(...params) as (Task & {
			depends_on_code?: string;
			comments_count: number;
		})[];
		return rows.map((r) => this.rowToTask(r));
	}

	isTaskCodeDuplicate(repo: string, task_code: string, excludeId?: string): boolean {
		let query = "SELECT COUNT(*) as count FROM tasks WHERE repo = ? AND task_code = ?";
		const params = [repo, task_code];

		if (excludeId) {
			query += " AND id != ?";
			params.push(excludeId);
		}

		const row = this.db.prepare(query).get(...params) as { count: number };
		return row.count > 0;
	}

	bulkInsertTasks(tasks: Task[]): number {
		const insert = this.db.prepare(`
      INSERT INTO tasks (
        id, repo, task_code, phase, title, description, status, priority,
        agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		const insertMany = this.db.transaction((tasks: Task[]) => {
			let count = 0;
			for (const task of tasks) {
				insert.run(
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
				);
				count++;
			}
			return count;
		});

		return insertMany(tasks);
	}

	insertTaskComment(comment: TaskComment): void {
		this.db
			.prepare(
				`
      INSERT INTO task_comments (
        id, task_id, repo, comment, agent, role, model, previous_status, next_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
			)
			.run(
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

		const stmt = this.db.prepare(`UPDATE task_comments SET ${fields.join(", ")} WHERE id = ?`);
		stmt.run(...values);
	}

	deleteTaskComment(id: string): void {
		this.db.prepare("DELETE FROM task_comments WHERE id = ?").run(id);
	}

	getTaskCommentById(id: string): TaskComment | null {
		return this.db.prepare("SELECT * FROM task_comments WHERE id = ?").get(id) as TaskComment | null;
	}

	getTaskCommentsByTaskId(taskId: string): TaskComment[] {
		return this.db
			.prepare(
				`
      SELECT * FROM task_comments
      WHERE task_id = ?
      ORDER BY created_at DESC, id DESC
    `
			)
			.all(taskId) as TaskComment[];
	}

	getAllTaskCommentsByRepo(repo: string): TaskComment[] {
		return this.db
			.prepare(
				`
      SELECT * FROM task_comments
      WHERE repo = ?
      ORDER BY created_at DESC, id DESC
    `
			)
			.all(repo) as TaskComment[];
	}

	getTaskStats(repo: string): TaskStats {
		const rows = this.db
			.prepare("SELECT status, COUNT(*) as count FROM tasks WHERE repo = ? GROUP BY status")
			.all(repo) as { status: string; count: number }[];
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

	getTaskTimeStats(repo: string, period: "daily" | "weekly" | "monthly" | "overall"): { completed: number; tokens: number; avgDuration: number; added: number } {
		let dateFilter = "";
		if (period === "daily") dateFilter = "AND date(COALESCE(finished_at, updated_at)) = date('now')";
		else if (period === "weekly") dateFilter = "AND date(COALESCE(finished_at, updated_at)) >= date('now', '-7 days')";
		else if (period === "monthly")
			dateFilter = "AND date(COALESCE(finished_at, updated_at)) >= date('now', '-30 days')";

		const stats = this.db
			.prepare(
				`
      SELECT 
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
      ${dateFilter}
    `
			)
			.get(repo) as {
			completed_count: number;
			total_tokens: number;
			avg_duration_seconds: number;
		} | undefined;

		let addedDateFilter = "";
		if (period === "daily") addedDateFilter = "AND date(created_at) = date('now')";
		else if (period === "weekly") addedDateFilter = "AND date(created_at) >= date('now', '-7 days')";
		else if (period === "monthly") addedDateFilter = "AND date(created_at) >= date('now', '-30 days')";

		const added = this.db
			.prepare(
				`
      SELECT COUNT(*) as count FROM tasks 
      WHERE repo = ? 
      ${addedDateFilter}
    `
			)
			.get(repo) as { count: number } | undefined;

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

		return this.db.prepare(query).all(labelFormat, repo, labelFormat, repo) as {
			label: string;
			created: number;
			completed: number;
		}[];
	}
}
