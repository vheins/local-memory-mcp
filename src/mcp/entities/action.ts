import { BaseEntity } from "../storage/base";

export class ActionEntity extends BaseEntity {
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

		this.run(
			`INSERT INTO action_log (repo, action, query, response, memory_id, task_id, result_count, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				repo || "",
				action || "unknown",
				query || null,
				finalResponse ? (typeof finalResponse === "string" ? finalResponse : JSON.stringify(finalResponse)) : null,
				finalMemoryId || null,
				finalTaskId || null,
				finalResultCount ?? 0,
				new Date().toISOString()
			]
		);
	}

	getLastActionId(): number {
		const row = this.get<{ id: number }>("SELECT MAX(id) as id FROM action_log");
		return row?.id || 0;
	}

	getActionsAfter(id: number): (ActionLogRow & { memory_title?: string; memory_type?: string })[] {
		return this.all<ActionLogRow & { memory_title?: string; memory_type?: string }>(
			`SELECT a.*, m.title as memory_title, m.type as memory_type 
			FROM action_log a LEFT JOIN memories m ON a.memory_id = m.id 
			WHERE a.id > ? ORDER BY a.created_at ASC`,
			[id]
		);
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
		const params: (string | number)[] = [];

		if (repo) {
			query += " WHERE a.repo = ?";
			params.push(repo);
		}

		query += " ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?";
		params.push(limit, offset);

		return this.all<ActionLogRow & { memory_title?: string; memory_type?: string }>(query, params);
	}

	getActionStatsByDate(repo: string): { date: string; count: number }[] {
		return this.all<{ date: string; count: number }>(
			`SELECT date(created_at) as date, count(*) as count 
			FROM action_log 
			WHERE repo = ? AND created_at > date('now', '-30 days')
			GROUP BY date(created_at)
			ORDER BY date ASC`,
			[repo]
		);
	}

	getActionDistribution(repo: string): { action: string; count: number }[] {
		return this.all<{ action: string; count: number }>(
			`SELECT action, count(*) as count 
			FROM action_log 
			WHERE repo = ?
			GROUP BY action`,
			[repo]
		);
	}

	getActionById(id: number): (ActionLogRow & { memory_title?: string; memory_type?: string }) | undefined {
		return this.get<ActionLogRow & { memory_title?: string; memory_type?: string }>(
			`SELECT a.*, m.title as memory_title, m.type as memory_type 
			FROM action_log a LEFT JOIN memories m ON a.memory_id = m.id 
			WHERE a.id = ?`,
			[id]
		);
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
