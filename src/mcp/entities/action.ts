import Database from "better-sqlite3";
import { BaseEntity } from "../storage/base";

export class ActionEntity extends BaseEntity {
	constructor(db: Database.Database) {
		super(db);
	}

	/**
	 * Log an action to the audit trail.
	 * Supports both object-based options (modern) and positional arguments (legacy/internal).
	 */
	logAction(
		action: string,
		repo: string,
		optionsOrQuery?:
			| string
			| { query?: string; response?: string | object; memoryId?: string; taskId?: string; resultCount?: number },
		response?: string,
		memoryId?: string,
		taskId?: string,
		resultCount: number = 0
	): void {
		let query = typeof optionsOrQuery === "string" ? optionsOrQuery : undefined;
		let finalResponse = response;
		let finalMemoryId = memoryId;
		let finalTaskId = taskId;
		let finalResultCount = resultCount;

		if (optionsOrQuery && typeof optionsOrQuery === "object") {
			query = optionsOrQuery.query || query;
			const res = optionsOrQuery.response;
			finalResponse = (typeof res === "object" ? JSON.stringify(res) : res) || finalResponse;
			finalMemoryId = optionsOrQuery.memoryId || finalMemoryId;
			finalTaskId = optionsOrQuery.taskId || finalTaskId;
			finalResultCount = optionsOrQuery.resultCount !== undefined ? optionsOrQuery.resultCount : finalResultCount;
		}

		const stmt = this.db.prepare(`
      INSERT INTO action_log (repo, action, query, response, memory_id, task_id, result_count, created_at)
      VALUES (:repo, :action, :query, :response, :memory_id, :task_id, :result_count, :created_at)
    `);

		stmt.run({
			repo: repo || "",
			action: action || "unknown",
			query: query || null,
			response: finalResponse
				? typeof finalResponse === "string"
					? finalResponse
					: JSON.stringify(finalResponse)
				: null,
			memory_id: finalMemoryId || null,
			task_id: finalTaskId || null,
			result_count: finalResultCount ?? 0,
			created_at: new Date().toISOString()
		});
	}

	getLastActionId(): number {
		const row = this.db.prepare("SELECT MAX(id) as id FROM action_log").get() as { id: number } | undefined;
		return row?.id || 0;
	}

	getActionsAfter(id: number): (ActionLogRow & { memory_title?: string; memory_type?: string })[] {
		return this.db
			.prepare(
				`
      SELECT a.*, m.title as memory_title, m.type as memory_type 
      FROM action_log a LEFT JOIN memories m ON a.memory_id = m.id 
      WHERE a.id > ? ORDER BY a.created_at ASC
    `
			)
			.all(id) as (ActionLogRow & { memory_title?: string; memory_type?: string })[];
	}

	getRecentActions(
		repo?: string,
		limit: number = 10,
		offset: number = 0
	): (ActionLogRow & { memory_title?: string; memory_type?: string })[] {
		let query = `
      SELECT a.*, m.title as memory_title, m.type as memory_type 
      FROM action_log a LEFT JOIN memories m ON a.memory_id = m.id
    `;
		const params: unknown[] = [];

		if (repo) {
			query += " WHERE a.repo = ?";
			params.push(repo);
		}

		query += " ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?";
		params.push(limit, offset);

		return this.db.prepare(query).all(...params) as (ActionLogRow & { memory_title?: string; memory_type?: string })[];
	}

	getActionStatsByDate(repo: string): { date: string; count: number }[] {
		return this.db
			.prepare(
				`
      SELECT date(created_at) as date, count(*) as count 
      FROM action_log 
      WHERE repo = ? AND created_at > date('now', '-30 days')
      GROUP BY date(created_at)
      ORDER BY date ASC
    `
			)
			.all(repo) as { date: string; count: number }[];
	}

	getActionDistribution(repo: string): { action: string; count: number }[] {
		return this.db
			.prepare(
				`
      SELECT action, count(*) as count 
      FROM action_log 
      WHERE repo = ?
      GROUP BY action
    `
			)
			.all(repo) as { action: string; count: number }[];
	}

	getActionById(id: number): (ActionLogRow & { memory_title?: string; memory_type?: string }) | undefined {
		return this.db
			.prepare(
				`
      SELECT a.*, m.title as memory_title, m.type as memory_type 
      FROM action_log a LEFT JOIN memories m ON a.memory_id = m.id 
      WHERE a.id = ?
    `
			)
			.get(id) as (ActionLogRow & { memory_title?: string; memory_type?: string }) | undefined;
	}
}

interface ActionLogRow {
	id: number;
	repo: string;
	action: string;
	query: string | null;
	response: string | null;
	memory_id: string | null;
	task_id: string | null;
	result_count: number;
	created_at: string;
}
