import { randomUUID } from "crypto";
import { BaseEntity } from "../storage/base";
import { Handoff, HandoffRow, Claim, ClaimRow } from "../types";

export class HandoffEntity extends BaseEntity {
	private rowToHandoff(row: HandoffRow): Handoff {
		return {
			id: row.id,
			repo: row.repo,
			from_agent: row.from_agent,
			to_agent: row.to_agent ?? null,
			task_id: row.task_id ?? null,
			task_code: "task_code" in row ? ((row as HandoffRow & { task_code?: string | null }).task_code ?? null) : null,
			summary: row.summary,
			context: this.safeJSONParse<Record<string, unknown>>(row.context, {}),
			status: row.status as Handoff["status"],
			created_at: row.created_at,
			updated_at: row.updated_at,
			expires_at: row.expires_at ?? null
		};
	}

	private rowToClaim(row: ClaimRow): Claim {
		return {
			id: row.id,
			repo: row.repo,
			task_id: row.task_id,
			task_code: "task_code" in row ? ((row as ClaimRow & { task_code?: string | null }).task_code ?? null) : null,
			agent: row.agent,
			role: row.role,
			claimed_at: row.claimed_at,
			released_at: row.released_at ?? null,
			metadata: this.safeJSONParse<Record<string, unknown>>(row.metadata, {})
		};
	}

	createHandoff(params: {
		repo: string;
		from_agent: string;
		to_agent?: string | null;
		task_id?: string | null;
		summary: string;
		context?: Record<string, unknown>;
		expires_at?: string | null;
	}): Handoff {
		const now = new Date().toISOString();
		const id = randomUUID();
		this.run(
			`INSERT INTO handoffs (id, repo, from_agent, to_agent, task_id, summary, context, status, created_at, updated_at, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				params.repo,
				params.from_agent,
				params.to_agent ?? null,
				params.task_id ?? null,
				params.summary,
				JSON.stringify(params.context ?? {}),
				"pending",
				now,
				now,
				params.expires_at ?? null
			]
		);
		return this.getHandoffById(id)!;
	}

	listHandoffs(params: {
		repo: string;
		status?: Handoff["status"];
		to_agent?: string;
		from_agent?: string;
		limit?: number;
		offset?: number;
	}): Handoff[] {
		const conditions: string[] = ["repo = ?"];
		const values: unknown[] = [params.repo];

		if (params.status) {
			conditions.push("status = ?");
			values.push(params.status);
		}
		if (params.to_agent) {
			conditions.push("to_agent = ?");
			values.push(params.to_agent);
		}
		if (params.from_agent) {
			conditions.push("from_agent = ?");
			values.push(params.from_agent);
		}

		const limit = params.limit ?? 50;
		const offset = params.offset ?? 0;
		values.push(limit, offset);

		const rows = this.all<HandoffRow & { task_code?: string | null }>(
			`SELECT h.*, t.task_code
			 FROM handoffs h
			 LEFT JOIN tasks t ON h.task_id = t.id
			 WHERE ${conditions
					.map((condition) =>
						condition
							.replace(/\brepo\b/g, "h.repo")
							.replace(/\bstatus\b/g, "h.status")
							.replace(/\bto_agent\b/g, "h.to_agent")
							.replace(/\bfrom_agent\b/g, "h.from_agent")
					)
					.join(" AND ")}
			 ORDER BY h.created_at DESC LIMIT ? OFFSET ?`,
			values
		);
		return rows.map((r) => this.rowToHandoff(r));
	}

	getHandoffById(id: string): Handoff | null {
		const row = this.get<HandoffRow & { task_code?: string | null }>(
			`SELECT h.*, t.task_code
			 FROM handoffs h
			 LEFT JOIN tasks t ON h.task_id = t.id
			 WHERE h.id = ?`,
			[id]
		);
		return row ? this.rowToHandoff(row) : null;
	}

	updateHandoffStatus(id: string, status: Handoff["status"]): boolean {
		const result = this.run("UPDATE handoffs SET status = ?, updated_at = ? WHERE id = ?", [
			status,
			new Date().toISOString(),
			id
		]);
		return result.changes > 0;
	}

	updatePendingHandoffsForTask(task_id: string, status: Handoff["status"]): number {
		const result = this.run("UPDATE handoffs SET status = ?, updated_at = ? WHERE task_id = ? AND status = 'pending'", [
			status,
			new Date().toISOString(),
			task_id
		]);
		return result.changes;
	}

	claimTask(params: {
		repo: string;
		task_id: string;
		agent: string;
		role?: string;
		metadata?: Record<string, unknown>;
	}): Claim {
		const now = new Date().toISOString();
		const id = randomUUID();

		// Release any existing active claim for this task
		this.run("UPDATE claims SET released_at = ? WHERE task_id = ? AND released_at IS NULL", [now, params.task_id]);

		this.run(
			`INSERT INTO claims (id, repo, task_id, agent, role, claimed_at, released_at, metadata)
			VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
			[
				id,
				params.repo,
				params.task_id,
				params.agent,
				params.role ?? "unknown",
				now,
				JSON.stringify(params.metadata ?? {})
			]
		);
		return this.rowToClaim(
			this.get<ClaimRow & { task_code?: string | null }>(
				`SELECT c.*, t.task_code
				 FROM claims c
				 LEFT JOIN tasks t ON c.task_id = t.id
				 WHERE c.id = ?`,
				[id]
			)!
		);
	}

	getClaim(task_id: string): Claim | null {
		const row = this.get<ClaimRow & { task_code?: string | null }>(
			`SELECT c.*, t.task_code
			 FROM claims c
			 LEFT JOIN tasks t ON c.task_id = t.id
			 WHERE c.task_id = ? AND c.released_at IS NULL
			 ORDER BY c.claimed_at DESC LIMIT 1`,
			[task_id]
		);
		return row ? this.rowToClaim(row) : null;
	}

	releaseClaim(task_id: string, agent?: string): boolean {
		const now = new Date().toISOString();
		let sql = "UPDATE claims SET released_at = ? WHERE task_id = ? AND released_at IS NULL";
		const params: unknown[] = [now, task_id];

		if (agent) {
			sql += " AND agent = ?";
			params.push(agent);
		}

		const result = this.run(sql, params);
		return result.changes > 0;
	}

	releaseClaimsForTask(task_id: string): number {
		const result = this.run("UPDATE claims SET released_at = ? WHERE task_id = ? AND released_at IS NULL", [
			new Date().toISOString(),
			task_id
		]);
		return result.changes;
	}

	listClaims(params: {
		repo: string;
		agent?: string;
		active_only?: boolean;
		limit?: number;
		offset?: number;
	}): Claim[] {
		const conditions: string[] = ["repo = ?"];
		const values: unknown[] = [params.repo];

		if (params.agent) {
			conditions.push("agent = ?");
			values.push(params.agent);
		}
		if (params.active_only) {
			conditions.push("released_at IS NULL");
		}

		const limit = params.limit ?? 50;
		const offset = params.offset ?? 0;
		values.push(limit, offset);

		const rows = this.all<ClaimRow & { task_code?: string | null }>(
			`SELECT c.*, t.task_code
			 FROM claims c
			 LEFT JOIN tasks t ON c.task_id = t.id
			 WHERE ${conditions
					.map((condition) =>
						condition
							.replace(/\brepo\b/g, "c.repo")
							.replace(/\bagent\b/g, "c.agent")
							.replace(/released_at/g, "c.released_at")
					)
					.join(" AND ")}
			 ORDER BY c.claimed_at DESC LIMIT ? OFFSET ?`,
			values
		);
		return rows.map((r) => this.rowToClaim(r));
	}
}
