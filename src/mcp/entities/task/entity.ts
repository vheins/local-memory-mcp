import { BaseEntity } from "../../storage/base";
import { Task, TaskRow, TaskChild, TaskComment } from "../../types";
import { handleDuplicateTaskCode } from "./validation";
import {
	buildCoordinationSelect,
	taskRepoFilter,
	taskSearchFilter,
	taskSelectSkeleton,
	taskStatusFilter,
	taskStatusesFilter,
	taskStatusOrderBy
} from "./queries";
import { VECTOR_CANDIDATE_CAP } from "../../utils/constants";
import { buildUpdateClause } from "../../utils/sql-builder";

// Writable task columns / JSON-serialized keys for the shared update-clause
// builder (TASK-109). comment/model are accepted on the API surface but are
// intentionally not writable columns.
const TASK_UPDATE_COLUMNS = new Set([
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
const TASK_JSON_KEYS = new Set(["tags", "metadata", "changed_files", "suggested_skills"]);

export class TaskEntity extends BaseEntity {
	/**
	 * Single source of truth for the tasks INSERT statement (TASK-108) —
	 * shared by insertTask() and bulkInsertTasks() so a column change is
	 * made in exactly one place.
	 */
	private buildInsert(task: Task): { sql: string; params: unknown[] } {
		return {
			sql: `INSERT INTO tasks (
				id, repo, owner, task_code, phase, title, description, status, priority,
				agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, suggested_skills, metadata, parent_id, depends_on, est_tokens, in_progress_at,
				commit_id, changed_files
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			params: [
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
		};
	}

	insertTask(task: Task): void {
		try {
			const { sql, params } = this.buildInsert(task);
			this.run(sql, params);
		} catch (err: unknown) {
			handleDuplicateTaskCode(err, task.task_code, task.repo);
		}
	}

	updateTask(id: string, updates: Partial<Task> & { comment?: string; model?: string }): void {
		const { fields, values } = buildUpdateClause(updates as Record<string, unknown>, {
			jsonKeys: TASK_JSON_KEYS,
			validColumns: TASK_UPDATE_COLUMNS
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
		const row = this.get<TaskRow>(`${taskSelectSkeleton("t", false)} WHERE t.id = ?`, [id]);
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
		const rows = this.all<TaskRow>(
			`SELECT t.*, d.task_code as depends_on_code,
				${buildCoordinationSelect("t")},
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
		const baseQuery = taskSelectSkeleton("t", false);

		// Single query — owner filter only when provided. Owner-less rows are
		// normalized at write time (TASK-038), so no owner-fallback re-query.
		const ownerClause = owner ? "t.owner = ? AND " : "";
		const params: (string | null)[] = owner ? [owner, repo, taskCode] : [repo, taskCode];
		const row = this.get<TaskRow>(baseQuery + `WHERE ${ownerClause}t.repo = ? AND t.task_code = ?`, params);

		return row
			? {
					...this.rowToTask(row),
					comments: this.all<TaskComment>(
						"SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC, id DESC",
						[row.id]
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
		const repoFilter = taskRepoFilter("t", owner, repo);
		const params: (string | number)[] = repoFilter.params;
		let query = `${taskSelectSkeleton("t")} WHERE ${repoFilter.clause}`;

		const statusClause = taskStatusFilter("t", status);
		if (statusClause) {
			query += statusClause;
			params.push(status as string);
		}

		const searchClause = taskSearchFilter("t", search);
		if (searchClause) {
			query += searchClause;
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern);
		}

		query += ` ORDER BY ${taskStatusOrderBy()}`;

		if (limit !== undefined) {
			query += " LIMIT ?";
			params.push(limit);
			if (offset !== undefined) {
				query += " OFFSET ?";
				params.push(offset);
			}
		}

		const rows = this.all<TaskRow>(query, params);

		// NOTE: no owner-fallback re-query — owner-less rows are normalized at
		// write time (TASK-038); the owner-filtered query is authoritative.
		return rows.map((r) => this.rowToTask(r));
	}

	countTasks(owner: string, repo: string, status?: string, search?: string): number {
		const { clause: repoClause, params } = taskRepoFilter(undefined, owner, repo);
		let query = `SELECT COUNT(*) as count FROM tasks WHERE ${repoClause}`;

		const statusClause = taskStatusFilter(undefined, status);
		if (statusClause) {
			query += statusClause;
			params.push(status as string);
		}

		const searchClause = taskSearchFilter(undefined, search);
		if (searchClause) {
			query += searchClause;
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern);
		}

		const row = this.get<{ count: number }>(query, params);
		return row?.count ?? 0;
	}

	listRecentTasks(limit = 50, offset = 0): Task[] {
		const query = `${taskSelectSkeleton("t")} ORDER BY ${taskStatusOrderBy()}
		LIMIT ? OFFSET ?
		`;
		const rows = this.all<TaskRow>(query, [limit, offset]);
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

		const repoFilter = taskRepoFilter("t", owner, repo);
		const params: (string | number)[] = repoFilter.params;
		let query = `${taskSelectSkeleton("t")} WHERE ${repoFilter.clause}`;

		const statusesClause = taskStatusesFilter("t", statuses);
		if (statusesClause) {
			query += statusesClause;
			params.push(...statuses);
		}

		const searchClause = taskSearchFilter("t", search);
		if (searchClause) {
			query += searchClause;
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern);
		}

		query += ` ORDER BY ${taskStatusOrderBy()}`;

		if (limit !== undefined) {
			query += " LIMIT ?";
			params.push(limit);
			if (offset !== undefined) {
				query += " OFFSET ?";
				params.push(offset);
			}
		}

		const rows = this.all<TaskRow>(query, params);

		// NOTE: no owner-fallback re-query — owner-less rows are normalized at
		// write time (TASK-038); the owner-filtered query is authoritative.
		return rows.map((r) => this.rowToTask(r));
	}

	countTasksByMultipleStatuses(owner: string, repo: string, statuses: string[], search?: string): number {
		if (!statuses.length) return this.countTasks(owner, repo, undefined, search);

		const repoFilter = taskRepoFilter(undefined, owner, repo);
		const params: (string | number)[] = repoFilter.params;
		let query = `SELECT COUNT(*) as count FROM tasks WHERE ${repoFilter.clause}`;

		const statusesClause = taskStatusesFilter(undefined, statuses);
		if (statusesClause) {
			query += statusesClause;
			params.push(...statuses);
		}

		const searchClause = taskSearchFilter(undefined, search);
		if (searchClause) {
			query += searchClause;
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

	/**
	 * Bulk-load children (tasks whose parent_id is in `ids`) in a single query,
	 * grouped by parent task id. Replaces N getChildrenByParentId calls (TASK-022).
	 */
	getChildrenByParentIds(ids: string[]): Map<string, TaskChild[]> {
		if (ids.length === 0) return new Map();
		const placeholders = ids.map(() => "?").join(",");
		const rows = this.all<TaskChild & { parent_id: string }>(
			`SELECT task_code, title, status, parent_id FROM tasks WHERE parent_id IN (${placeholders}) ORDER BY created_at ASC`,
			ids
		);
		const grouped = new Map<string, TaskChild[]>();
		for (const row of rows) {
			if (!grouped.has(row.parent_id)) grouped.set(row.parent_id, []);
			grouped.get(row.parent_id)!.push({ task_code: row.task_code, title: row.title, status: row.status });
		}
		return grouped;
	}

	/**
	 * Bulk-load dependents (tasks whose depends_on is in `ids`) in a single query,
	 * grouped by dependency task id. Replaces N getDependedByTaskId calls (TASK-022).
	 */
	getDependedByTaskIds(ids: string[]): Map<string, TaskChild[]> {
		if (ids.length === 0) return new Map();
		const placeholders = ids.map(() => "?").join(",");
		const rows = this.all<TaskChild & { depends_on: string }>(
			`SELECT task_code, title, status, depends_on FROM tasks WHERE depends_on IN (${placeholders}) ORDER BY created_at ASC`,
			ids
		);
		const grouped = new Map<string, TaskChild[]>();
		for (const row of rows) {
			if (!grouped.has(row.depends_on)) grouped.set(row.depends_on, []);
			grouped.get(row.depends_on)!.push({ task_code: row.task_code, title: row.title, status: row.status });
		}
		return grouped;
	}

	/**
	 * Detach every child of the given task (`parent_id → NULL`).
	 *
	 * Called when a parent task is soft-deleted (canceled): the parent's KG
	 * entities are orphan-swept, so keeping children linked would let any
	 * future writer re-derive `depends_on` relations from a document whose
	 * entity rows no longer exist (TASK-065 / MEM-473). The embedding
	 * worker's `entityExists` guard (worker.ts) already skips canceled tasks,
	 * but stale enqueued snapshots still carry the parentId — detaching here
	 * makes the skip unconditional.
	 * Returns the number of children detached.
	 */
	clearChildrenParent(parentId: string): number {
		return this.run("UPDATE tasks SET parent_id = NULL, updated_at = ? WHERE parent_id = ?", [
			new Date().toISOString(),
			parentId
		]).changes;
	}

	/**
	 * Bulk-load tasks by task_code with the same row shape as getTaskByCode
	 * (parent_code join + batched comments), in a single tasks query plus one
	 * batched comments query. Results preserve the input code order.
	 *
	 * Deliberately NO owner-fallback re-query: owner-less rows are normalized at
	 * write time (TASK-038), so the owner-filtered query is authoritative.
	 */
	getTasksByCodes(owner: string, repo: string, taskCodes: string[]): Task[] {
		if (taskCodes.length === 0) return [];
		const placeholders = taskCodes.map(() => "?").join(",");
		const repoFilter = taskRepoFilter("t", owner, repo);

		const rows = this.all<TaskRow>(
			`${taskSelectSkeleton("t")} WHERE ${repoFilter.clause} AND t.task_code IN (${placeholders})`,
			[...repoFilter.params, ...taskCodes]
		);

		const tasks = rows.map((r) => this.rowToTask(r));
		if (tasks.length === 0) return [];
		const taskIds = tasks.map((t) => t.id);

		const comments = this.all<TaskComment>(
			`SELECT * FROM task_comments WHERE task_id IN (${taskIds.map(() => "?").join(",")}) ORDER BY created_at DESC, id DESC`,
			taskIds
		);
		const commentsMap = new Map<string, TaskComment[]>();
		for (const c of comments) {
			if (!commentsMap.has(c.task_id)) commentsMap.set(c.task_id, []);
			commentsMap.get(c.task_id)!.push(c);
		}
		for (const task of tasks) {
			task.comments = commentsMap.get(task.id) || [];
		}

		// Preserve input code order, first match per code (mirrors per-code getTaskByCode)
		const byCode = new Map<string, Task>();
		for (const task of tasks) {
			if (!byCode.has(task.task_code)) byCode.set(task.task_code, task);
		}
		const seen = new Set<string>();
		const result: Task[] = [];
		for (const code of taskCodes) {
			const task = byCode.get(code);
			if (task && !seen.has(code)) {
				seen.add(code);
				result.push(task);
			}
		}
		return result;
	}

	upsertTaskVectorEmbedding(taskId: string, vector: unknown): void {
		this.run(
			`INSERT INTO task_vectors (task_id, vector, updated_at)
			VALUES (?, ?, ?)
			ON CONFLICT(task_id) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at`,
			[taskId, JSON.stringify(vector), new Date().toISOString()]
		);
	}

	getTaskVectorCandidates(repo?: string, limit = VECTOR_CANDIDATE_CAP): { task_id: string; vector: string }[] {
		let sql = `SELECT tv.task_id, tv.vector
			FROM task_vectors tv
			JOIN tasks t ON t.id = tv.task_id`;
		const params: (string | number)[] = [];

		if (repo) {
			sql += " WHERE t.repo = ?";
			params.push(repo);
		}

		sql += " ORDER BY tv.updated_at DESC LIMIT ?";
		params.push(limit);
		return this.all<{ task_id: string; vector: string }>(sql, params);
	}

	removeTaskVector(taskId: string): void {
		this.run("DELETE FROM task_vectors WHERE task_id = ?", [taskId]);
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
				const { sql, params } = this.buildInsert(task);
				this.run(sql, params);
				count++;
			}
			return count;
		});
	}
}
