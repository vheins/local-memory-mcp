import { BaseEntity } from "../storage/base";
import { MemoryEntry, MemoryRow, MemoryType } from "../types/index";
import { CountResult, TypeCountResult } from "../types/common";

const VALID_COLUMNS = new Set([
	"code",
	"type",
	"title",
	"content",
	"importance",
	"agent",
	"role",
	"model",
	"completed_at",
	"expires_at",
	"supersedes",
	"status",
	"hit_count",
	"recall_count",
	"last_used_at"
]);

export class MemoryEntity extends BaseEntity {
	insert(entry: MemoryEntry): void {
		this.run(
			`INSERT INTO memories (
				id, code, repo, type, title, content, importance, folder, language,
				created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
				supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				entry.id,
				entry.code || null,
				entry.scope.repo,
				entry.type,
				entry.title || null,
				entry.content,
				entry.importance,
				entry.scope.folder || null,
				entry.scope.language || null,
				entry.created_at,
				entry.updated_at,
				entry.expires_at ?? null,
				entry.supersedes ?? null,
				entry.status || "active",
				entry.is_global ? 1 : 0,
				entry.tags ? JSON.stringify(entry.tags) : null,
				entry.metadata ? JSON.stringify(entry.metadata) : null,
				entry.agent || "unknown",
				entry.role || "unknown",
				entry.model || "unknown",
				entry.completed_at || null
			]
		);
	}

	update(id: string, updates: Partial<MemoryEntry>): void {
		const fields: string[] = [];
		const values: unknown[] = [];

		Object.keys(updates).forEach((key) => {
			const k = key as keyof MemoryEntry;
			const val = updates[k];
			if (val !== undefined) {
				if (k === "scope") {
					const scope = updates.scope;
					if (scope?.repo) {
						fields.push("repo = ?");
						values.push(scope.repo);
					}
					if (scope?.folder !== undefined) {
						fields.push("folder = ?");
						values.push(scope.folder);
					}
					if (scope?.language !== undefined) {
						fields.push("language = ?");
						values.push(scope.language);
					}
				} else if (k === "tags" || k === "metadata") {
					fields.push(`${k} = ?`);
					values.push(JSON.stringify(val));
				} else if (k === "is_global") {
					fields.push(`${k} = ?`);
					values.push(val ? 1 : 0);
				} else if (VALID_COLUMNS.has(k)) {
					fields.push(`${k} = ?`);
					values.push(val);
				}
			}
		});

		if (fields.length === 0) return;

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());
		values.push(id);

		this.run(`UPDATE memories SET ${fields.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
	}

	delete(id: string): void {
		this.run("DELETE FROM memories WHERE id = ?", [id]);
	}

	getById(id: string): MemoryEntry | null {
		const row = this.get<MemoryRow>("SELECT * FROM memories WHERE id = ?", [id]);
		return row ? this.rowToMemoryEntry(row) : null;
	}

	getByCode(code: string): MemoryEntry | null {
		const row = this.get<MemoryRow>("SELECT * FROM memories WHERE code = ?", [code]);
		return row ? this.rowToMemoryEntry(row) : null;
	}

	getByIdWithStats(id: string): (MemoryEntry & { recall_rate: number }) | null {
		const row = this.get<MemoryRow & { recall_rate: number }>(
			`SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate FROM memories WHERE id = ?`,
			[id]
		);
		if (!row) return null;
		return {
			...this.rowToMemoryEntry(row),
			recall_rate: row.recall_rate ?? 0
		};
	}

	getByIds(ids: string[], options: { type?: string; status?: string } = {}): MemoryEntry[] {
		if (ids.length === 0) return [];
		let sql = `SELECT * FROM memories WHERE id IN (${ids.map(() => "?").join(",")})`;
		const params: (string | number)[] = [...ids];

		if (options.type) {
			sql += " AND type = ?";
			params.push(options.type);
		}
		if (options.status) {
			sql += " AND status = ?";
			params.push(options.status);
		}

		const rows = this.all<MemoryRow>(sql, params);
		return rows.map((row) => this.rowToMemoryEntry(row));
	}

	getStats(repo?: string): { total: number; byType: Record<string, number> } {
		let sql = "SELECT type, COUNT(*) as count FROM memories";
		const params: unknown[] = [];
		if (repo) {
			sql += " WHERE repo = ?";
			params.push(repo);
		}
		sql += " GROUP BY type";

		const rows = this.all<TypeCountResult>(sql, params);
		const byType: Record<string, number> = {};
		let total = 0;
		rows.forEach((row) => {
			byType[row.type] = row.count;
			total += row.count;
		});

		return { total, byType };
	}

	searchByRepo(repo: string, query: string = "", type?: string, limit = 5): MemoryEntry[] {
		const now = new Date().toISOString();

		// Use LIKE search (FTS5 not enabled by default)
		let sql =
			"SELECT * FROM memories WHERE repo = ? AND (content LIKE ? OR title LIKE ? OR tags LIKE ?) AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)";
		const params: (string | number)[] = [repo, `%${query}%`, `%${query}%`, `%${query}%`, now];

		if (type) {
			sql += " AND type = ?";
			params.push(type);
		}

		sql += " ORDER BY importance DESC, created_at DESC LIMIT ?";
		params.push(limit);

		const rows = this.all<MemoryRow>(sql, params);
		return rows.map((row) => this.rowToMemoryEntry(row));
	}

	bulkInsertMemories(entries: MemoryEntry[]): number {
		return this.transaction(() => {
			let count = 0;
			for (const entry of entries) {
				this.run(
					`INSERT INTO memories (
						id, repo, type, title, content, importance, folder, language,
						created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
						supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						entry.id,
						entry.scope.repo,
						entry.type,
						entry.title || null,
						entry.content,
						entry.importance,
						entry.scope.folder || null,
						entry.scope.language || null,
						entry.created_at,
						entry.updated_at,
						entry.expires_at ?? null,
						entry.supersedes ?? null,
						entry.status || "active",
						entry.is_global ? 1 : 0,
						entry.tags ? JSON.stringify(entry.tags) : null,
						entry.metadata ? JSON.stringify(entry.metadata) : null,
						entry.agent || "unknown",
						entry.role || "unknown",
						entry.model || "unknown",
						entry.completed_at || null
					]
				);
				count++;
			}
			return count;
		});
	}

	bulkUpdateMemories(ids: string[], updates: Partial<MemoryEntry>): number {
		if (ids.length === 0) return 0;

		const fields: string[] = [];
		const values: unknown[] = [];

		(Object.keys(updates) as (keyof MemoryEntry)[]).forEach((key) => {
			const value = updates[key];
			if (value !== undefined) {
				if (key === "scope") {
					const scope = updates.scope;
					if (scope?.repo) {
						fields.push("repo = ?");
						values.push(scope.repo);
					}
					if (scope?.folder !== undefined) {
						fields.push("folder = ?");
						values.push(scope.folder);
					}
					if (scope?.language !== undefined) {
						fields.push("language = ?");
						values.push(scope.language);
					}
				} else if (key === "tags" || key === "metadata") {
					fields.push(`${key} = ?`);
					values.push(JSON.stringify(value));
				} else if (key === "is_global") {
					fields.push(`${key} = ?`);
					values.push(value ? 1 : 0);
				} else if (VALID_COLUMNS.has(key)) {
					fields.push(`${key} = ?`);
					values.push(value);
				}
			}
		});

		if (fields.length === 0) return 0;

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());

		return this.transaction(() => {
			let count = 0;
			const chunkSize = 500;
			for (let i = 0; i < ids.length; i += chunkSize) {
				const chunk = ids.slice(i, i + chunkSize);
				const result = this.run(
					`UPDATE memories SET ${fields.join(", ")} WHERE id IN (${chunk.map(() => "?").join(",")})`,
					[...values, ...chunk] as (string | number)[]
				);
				count += result.changes;
			}
			return count;
		});
	}


	getRecentMemories(
		repo: string,
		limit: number,
		offset: number = 0,
		includeArchived: boolean = false,
		excludeTypes: string[] = [],
		sortOrder: "ASC" | "DESC" = "DESC"
	): MemoryEntry[] {
		let query = "SELECT * FROM memories WHERE repo = ?";
		const params: (string | number)[] = [repo];

		if (!includeArchived) {
			query += " AND status = 'active'";
		}

		if (excludeTypes.length > 0) {
			query += ` AND type NOT IN (${excludeTypes.map(() => "?").join(",")})`;
			params.push(...excludeTypes);
		}

		query += ` ORDER BY importance DESC, created_at ${sortOrder} LIMIT ? OFFSET ?`;
		params.push(limit, offset);

		const rows = this.all<MemoryRow>(query, params);
		return rows.map((row) => this.rowToMemoryEntry(row));
	}

	getTotalCount(repo: string, includeArchived = false, excludeTypes: string[] = []): number {
		let sql = "SELECT COUNT(*) as count FROM memories WHERE repo = ?";
		const params: (string | number)[] = [repo];

		if (!includeArchived) sql += " AND status = 'active'";

		if (excludeTypes.length > 0) {
			sql += ` AND type NOT IN (${excludeTypes.map(() => "?").join(",")})`;
			params.push(...excludeTypes);
		}

		const row = this.get<CountResult>(sql, params);
		return row?.count ?? 0;
	}

	incrementHitCount(id: string): void {
		this.run("UPDATE memories SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?", [
			new Date().toISOString(),
			id
		]);
	}

	incrementHitCounts(ids: string[]): void {
		if (!ids || ids.length === 0) return;
		const now = new Date().toISOString();
		for (const id of ids) {
			this.run("UPDATE memories SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?", [now, id]);
		}
	}

	incrementRecallCount(id: string): void {
		this.run("UPDATE memories SET recall_count = recall_count + 1, last_used_at = ? WHERE id = ?", [
			new Date().toISOString(),
			id
		]);
	}



	getSummary(repo: string): { summary: string; updated_at: string } | undefined {
		const row = this.get<{ summary: string; updated_at: string }>(
			"SELECT summary, updated_at FROM memory_summary WHERE repo = ?",
			[repo]
		);
		return row;
	}

	getAllMemoriesWithStats(repo: string): (MemoryEntry & { recall_rate: number })[] {
		const rows = this.all<MemoryRow & { recall_rate: number }>(
			`SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate FROM memories WHERE repo = ? ORDER BY created_at DESC`,
			[repo]
		);
		return rows.map((row) => ({
			...this.rowToMemoryEntry(row),
			recall_rate: row.recall_rate || 0
		}));
	}

	upsertSummary(repo: string, summary: string): void {
		this.run(
			`INSERT INTO memory_summary (repo, summary, updated_at) VALUES (?, ?, ?)
			ON CONFLICT(repo) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`,
			[repo, summary, new Date().toISOString()]
		);
	}

	listMemoriesForDashboard(options: {
		repo?: string;
		type?: MemoryType;
		tag?: string;
		isGlobal?: boolean;
		minImportance?: number;
		maxImportance?: number;
		search?: string;
		offset?: number;
		limit?: number;
		sortBy?: string;
		sortOrder?: "ASC" | "DESC";
	}): {
		items: (MemoryEntry & { recall_rate: number })[];
		memories: (MemoryEntry & { recall_rate: number })[];
		total: number;
		limit: number;
		offset: number;
	} {
		const {
			repo,
			type,
			tag,
			isGlobal,
			minImportance,
			maxImportance,
			search,
			offset = 0,
			limit = 50,
			sortBy = "created_at",
			sortOrder = "DESC"
		} = options;
		const where = ["1=1"];
		const params: (string | number)[] = [];
		if (repo) {
			where.push("repo = ?");
			params.push(repo);
		}
		if (type) {
			where.push("type = ?");
			params.push(type);
		}
		if (tag) {
			where.push("tags LIKE ?");
			params.push(`%${tag}%`);
		}
		if (isGlobal !== undefined) {
			where.push("is_global = ?");
			params.push(isGlobal ? 1 : 0);
		}
		if (minImportance !== undefined) {
			where.push("importance >= ?");
			params.push(minImportance);
		}
		if (maxImportance !== undefined) {
			where.push("importance <= ?");
			params.push(maxImportance);
		}
		if (search) {
			where.push("(title LIKE ? OR content LIKE ?)");
			params.push(`%${search}%`, `%${search}%`);
		}

		const countSql = `SELECT COUNT(*) as count FROM memories WHERE ${where.join(" AND ")}`;
		const totalRow = this.get<CountResult>(countSql, params);
		const total = totalRow?.count ?? 0;

		const dataSql = `SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate FROM memories WHERE ${where.join(" AND ")} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
		const rows = this.all<MemoryRow & { recall_rate: number }>(dataSql, [...params, limit, offset]);
		const items = rows.map((row) => ({
			...this.rowToMemoryEntry(row),
			recall_rate: row.recall_rate || 0
		}));

		return { items, memories: items, total, limit, offset };
	}



}
