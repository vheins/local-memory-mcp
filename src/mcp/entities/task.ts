import { BaseEntity } from "../storage/base";
import { Task, TaskChild, TaskComment } from "../types";

// Type guard for SQLite error objects that have a `code` property
function isSqliteError(err: unknown): err is { code: string; message: string } {
	return err instanceof Error && typeof (err as unknown as Record<string, unknown>).code === "string";
}

export class TaskEntity extends BaseEntity {
	private coordinationSelect(alias = "t") {
		return `
			(SELECT COUNT(*) FROM claims c WHERE c.task_id = ${alias}.id AND c.released_at IS NULL) as active_claim_count,
			(SELECT c.agent FROM claims c WHERE c.task_id = ${alias}.id AND c.released_at IS NULL ORDER BY c.claimed_at DESC LIMIT 1) as active_claim_agent,
			(SELECT c.role FROM claims c WHERE c.task_id = ${alias}.id AND c.released_at IS NULL ORDER BY c.claimed_at DESC LIMIT 1) as active_claim_role,
			(SELECT c.claimed_at FROM claims c WHERE c.task_id = ${alias}.id AND c.released_at IS NULL ORDER BY c.claimed_at DESC LIMIT 1) as active_claim_claimed_at,
			(SELECT COUNT(*) FROM handoffs h WHERE h.task_id = ${alias}.id AND h.status = 'pending') as pending_handoff_count,
			(SELECT h.id FROM handoffs h WHERE h.task_id = ${alias}.id AND h.status = 'pending' ORDER BY h.created_at DESC LIMIT 1) as pending_handoff_id,
			(SELECT h.summary FROM handoffs h WHERE h.task_id = ${alias}.id AND h.status = 'pending' ORDER BY h.created_at DESC LIMIT 1) as pending_handoff_summary,
			(SELECT h.to_agent FROM handoffs h WHERE h.task_id = ${alias}.id AND h.status = 'pending' ORDER BY h.created_at DESC LIMIT 1) as pending_handoff_to_agent,
			(SELECT h.created_at FROM handoffs h WHERE h.task_id = ${alias}.id AND h.status = 'pending' ORDER BY h.created_at DESC LIMIT 1) as pending_handoff_created_at
		`;
	}

	insertTask(task: Task): void {
		try {
			this.run(
				`INSERT INTO tasks (
					id, repo, owner, task_code, phase, title, description, status, priority,
					agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, suggested_skills, metadata, parent_id, depends_on, est_tokens, in_progress_at,
					commit_id, changed_files
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					task.id,
					task.repo,
					task.owner || "",
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
					task.suggested_skills ? JSON.stringify(task.suggested_skills) : null,
					task.metadata ? JSON.stringify(task.metadata) : null,
					task.parent_id || null,
					task.depends_on || null,
					task.est_tokens || 0,
					task.in_progress_at || null,
					task.commit_id || null,
					task.changed_files ? JSON.stringify(task.changed_files) : null
				]
			);
		} catch (err: unknown) {
			this.handleDuplicateTaskCode(err, task.task_code, task.repo);
		}
	}

	private handleDuplicateTaskCode(err: unknown, taskCode: string, repo: string): void {
		if (isSqliteError(err) && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
			throw new Error(
				`Duplicate task_code: '${taskCode}' already exists in repository '${repo}'. The task_code must be unique within the repository. Omit task_code to auto-generate a new unique code.`
			);
		}
		// For any other SQLITE_CONSTRAINT (FK, PK) or non-SQLite errors, re-throw
		throw err;
	}

	updateTask(id: string, updates: Partial<Task> & { comment?: string; model?: string }): void {
		const fields: string[] = [];
		const values: unknown[] = [];
		const anyUpdates = updates as Record<string, unknown>;
		const VALID_COLUMNS = new Set([
			"owner",
			"repo",
			"task_code",
			"phase",
			"title",
			"description",
			"status",
			"priority",
			"agent",
			"role",
			"doc_path",
			"finished_at",
			"canceled_at",
			"tags",
			"suggested_skills",
			"metadata",
			"parent_id",
			"depends_on",
			"est_tokens",
			"in_progress_at",
			"commit_id",
			"changed_files"
		]);

		Object.keys(updates).forEach((key) => {
			if (VALID_COLUMNS.has(key) && anyUpdates[key] !== undefined) {
				if (key === "tags" || key === "metadata" || key === "changed_files" || key === "suggested_skills") {
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
			`SELECT t.*, d.task_code as depends_on_code, p.task_code as parent_code,
				${this.coordinationSelect("t")}
			 FROM tasks t 
			 LEFT JOIN tasks d ON t.depends_on = d.id 
			 LEFT JOIN tasks p ON t.parent_id = p.id 
			 WHERE t.id = ?`,
			[id]
		);
		return row
			? {
					...this.rowToTask(row),
					comments: this.all<TaskComment>(
						"SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC, id DESC",
						[id]
					)
				}
			: null;
	}

	getTasksByIds(ids: string[]): Task[] {
		if (ids.length === 0) return [];
		const placeholders = ids.map(() => "?").join(",");
		const rows = this.all<Record<string, unknown>>(
			`SELECT t.*, d.task_code as depends_on_code,
				${this.coordinationSelect("t")},
				(SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comments_count
			FROM tasks t
			LEFT JOIN tasks d ON t.depends_on = d.id
			WHERE t.id IN (${placeholders})`,
			ids
		);

		const comments = this.all<TaskComment>(
			`SELECT * FROM task_comments WHERE task_id IN (${placeholders}) ORDER BY created_at DESC, id DESC`,
			ids
		);

		const commentsMap = new Map<string, TaskComment[]>();
		for (const c of comments) {
			if (!commentsMap.has(c.task_id)) {
				commentsMap.set(c.task_id, []);
			}
			commentsMap.get(c.task_id)!.push(c);
		}

		return rows.map((r) => {
			const task = this.rowToTask(r);
			task.comments = commentsMap.get(task.id) || [];
			return task;
		});
	}

	getTaskByCode(owner: string, repo: string, taskCode: string): Task | null {
		const baseQuery = `SELECT t.*, d.task_code as depends_on_code, p.task_code as parent_code,
			${this.coordinationSelect("t")}
		 FROM tasks t 
		 LEFT JOIN tasks d ON t.depends_on = d.id 
		 LEFT JOIN tasks p ON t.parent_id = p.id `;

		// First attempt: with owner filter if owner provided
		let row: Record<string, unknown> | undefined;
		if (owner) {
			row = this.get<Record<string, unknown>>(baseQuery + `WHERE t.owner = ? AND t.repo = ? AND t.task_code = ?`, [
				owner,
				repo,
				taskCode
			]);
		}

		// Fallback: without owner filter (handles tasks created via dashboard with owner="")
		if (!row) {
			row = this.get<Record<string, unknown>>(baseQuery + `WHERE t.repo = ? AND t.task_code = ?`, [repo, taskCode]);
		}

		return row
			? {
					...this.rowToTask(row),
					comments: this.all<TaskComment>(
						"SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC, id DESC",
						[row.id as string]
					)
				}
			: null;
	}

	getTasksByRepo(
		owner: string,
		repo: string,
		status?: string,
		limit?: number,
		offset?: number,
		search?: string
	): Task[] {
		let query = `
			SELECT t.*, d.task_code as depends_on_code, p.task_code as parent_code,
				${this.coordinationSelect("t")},
				(SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comments_count
			FROM tasks t 
			LEFT JOIN tasks d ON t.depends_on = d.id 
			LEFT JOIN tasks p ON t.parent_id = p.id 
			WHERE ${owner ? "t.owner = ? AND " : ""}t.repo = ?
		`;
		const params: (string | number)[] = owner ? [owner, repo] : [repo];

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

		// If owner filter returned no results, retry without owner filter
		// (handles tasks created with a different owner value)
		if (rows.length === 0 && owner) {
			const fallbackQuery = query.replace(/t\.owner\s*=\s*\?\s*AND\s*/i, "");
			const fallbackParams = params.slice(1); // remove owner param
			const fallbackRows = this.all<Record<string, unknown>>(fallbackQuery, fallbackParams);
			if (fallbackRows.length > 0) {
				return fallbackRows.map((r) => this.rowToTask(r));
			}
		}

		return rows.map((r) => this.rowToTask(r));
	}

	countTasks(owner: string, repo: string, status?: string, search?: string): number {
		const ownerClause = owner ? "owner = ? AND " : "";
		let query = `SELECT COUNT(*) as count FROM tasks WHERE ${ownerClause}repo = ?`;
		const params: (string | number)[] = owner ? [owner, repo] : [repo];

		if (status) {
			query += " AND status = ?";
			params.push(status);
		}

		if (search) {
			query += " AND (title LIKE ? OR description LIKE ? OR task_code LIKE ?)";
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern);
		}

		const row = this.get<{ count: number }>(query, params);
		return row?.count ?? 0;
	}
	listRecentTasks(limit = 50, offset = 0): Task[] {
		const query = `
		SELECT t.*, d.task_code as depends_on_code, p.task_code as parent_code,
			${this.coordinationSelect("t")},
			(SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comments_count
		FROM tasks t 
		LEFT JOIN tasks d ON t.depends_on = d.id 
		LEFT JOIN tasks p ON t.parent_id = p.id 
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
		owner: string,
		repo: string,
		statuses: string[],
		limit?: number,
		offset?: number,
		search?: string
	): Task[] {
		if (!statuses.length) return this.getTasksByRepo(owner, repo, undefined, limit, offset, search);

		const ownerClause = owner ? "t.owner = ? AND " : "";
		let query = `
			SELECT t.*, d.task_code as depends_on_code, p.task_code as parent_code,
				${this.coordinationSelect("t")},
				(SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comments_count
			FROM tasks t 
			LEFT JOIN tasks d ON t.depends_on = d.id 
			LEFT JOIN tasks p ON t.parent_id = p.id 
			WHERE ${ownerClause}t.repo = ? AND t.status IN (${statuses.map(() => "?").join(",")})
		`;
		const params: (string | number)[] = owner ? [owner, repo, ...statuses] : [repo, ...statuses];

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

		// If owner filter returned no results, retry without owner filter
		if (rows.length === 0 && owner) {
			const fallbackQuery = query.replace(/t\.owner\s*=\s*\?\s*AND\s*/i, "");
			const fallbackParams = params.slice(1); // remove owner param
			const fallbackRows = this.all<Record<string, unknown>>(fallbackQuery, fallbackParams);
			if (fallbackRows.length > 0) {
				return fallbackRows.map((r) => this.rowToTask(r));
			}
		}

		return rows.map((r) => this.rowToTask(r));
	}

	countTasksByMultipleStatuses(owner: string, repo: string, statuses: string[], search?: string): number {
		if (!statuses.length) return this.countTasks(owner, repo, undefined, search);

		const ownerClause = owner ? "owner = ? AND " : "";
		let query = `SELECT COUNT(*) as count FROM tasks WHERE ${ownerClause}repo = ? AND status IN (${statuses.map(() => "?").join(",")})`;
		const params: (string | number)[] = owner ? [owner, repo, ...statuses] : [repo, ...statuses];

		if (search) {
			query += " AND (title LIKE ? OR description LIKE ? OR task_code LIKE ?)";
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern);
		}

		const row = this.get<{ count: number }>(query, params);
		return row?.count ?? 0;
	}

	isTaskCodeDuplicate(owner: string, repo: string, task_code: string, excludeId?: string): boolean {
		let query = "SELECT COUNT(*) as count FROM tasks WHERE repo = ? AND task_code = ?";
		const params: (string | number)[] = [repo, task_code];

		if (owner) {
			query = "SELECT COUNT(*) as count FROM tasks WHERE owner = ? AND repo = ? AND task_code = ?";
			params.unshift(owner);
		}

		if (excludeId) {
			query += " AND id != ?";
			params.push(excludeId);
		}

		const row = this.get<{ count: number }>(query, params);
		return (row?.count ?? 0) > 0;
	}

	getChildrenByParentId(id: string): TaskChild[] {
		return this.all<TaskChild>(
			"SELECT task_code, title, status FROM tasks WHERE parent_id = ? ORDER BY created_at ASC",
			[id]
		);
	}

	getDependedByTaskId(id: string): TaskChild[] {
		return this.all<TaskChild>(
			"SELECT task_code, title, status FROM tasks WHERE depends_on = ? ORDER BY created_at ASC",
			[id]
		);
	}

	getExistingTaskCodes(owner: string, repo: string, codes: string[]): Set<string> {
		if (codes.length === 0) return new Set();
		const placeholders = codes.map(() => "?").join(",");
		const params: (string | number)[] = [repo, ...codes];
		const ownerClause = owner ? "owner = ? AND " : "";
		if (owner) {
			params.unshift(owner);
		}
		const rows = this.all<{ task_code: string }>(
			`SELECT task_code FROM tasks WHERE ${ownerClause}repo = ? AND task_code IN (${placeholders})`,
			params
		);
		return new Set(rows.map((r) => r.task_code));
	}

	/**
	 * Bulk inserts tasks into the database within a single transaction.
	 * Pre-deduplicates against existing task_codes before the transaction.
	 * Rows whose task_code already exists in the DB are silently skipped (skip-and-continue).
	 * The per-row INSERT has no try/catch since all rows are pre-validated.
	 *
	 * @param tasks - Array of tasks to insert
	 * @returns Number of tasks actually inserted (excluding skipped duplicates)
	 */
	bulkInsertTasks(tasks: Task[]): number {
		if (tasks.length === 0) return 0;

		const owner = tasks[0].owner || "";
		const repo = tasks[0].repo;

		// Pre-deduplicate against existing task codes before the transaction
		const codes = tasks.map((t) => t.task_code);
		const existingCodes = this.getExistingTaskCodes(owner, repo, codes);

		return this.transaction(() => {
			let count = 0;
			for (const task of tasks) {
				// Skip rows whose task_code already exists in the database
				if (existingCodes.has(task.task_code)) {
					continue;
				}
				this.run(
					`INSERT INTO tasks (
						id, repo, owner, task_code, phase, title, description, status, priority,
						agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, suggested_skills, metadata, parent_id, depends_on, est_tokens, in_progress_at,
						commit_id, changed_files
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						task.id,
						task.repo,
						task.owner || "",
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
						task.suggested_skills ? JSON.stringify(task.suggested_skills) : null,
						task.metadata ? JSON.stringify(task.metadata) : null,
						task.parent_id || null,
						task.depends_on || null,
						task.est_tokens || 0,
						task.in_progress_at || null,
						task.commit_id || null,
						task.changed_files ? JSON.stringify(task.changed_files) : null
					]
				);
				count++;
			}
			return count;
		});
	}
}
