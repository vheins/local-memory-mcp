import { BaseEntity } from "../../storage/base";
import {
	MemoryEntry,
	MemoryRow,
	MemoryScope,
	MemoryType,
	CountResult,
	TypeCountResult,
	MEMORY_STATUS_ACTIVE
} from "../../types";
import { VALID_COLUMNS, mergeStructuredData } from "./validation";
import { BULK_UPDATE_CHUNK_SIZE, TABLE_MEMORIES } from "../../utils/constants";
import { buildFtsMatchQuery } from "../../utils/fts";
import { buildUpdateClause } from "../../utils/sql-builder";

// JSON-serialized / int-coerced columns for the shared update-clause builder
// (TASK-109). Tags and metadata are stored as JSON text; is_global as 0/1.
const MEMORY_JSON_KEYS = new Set(["tags", "metadata"]);
const MEMORY_INT_KEYS = new Set(["is_global"]);

export class MemoryEntity extends BaseEntity {
	/**
	 * Single source of truth for the memories INSERT statement (TASK-108) —
	 * shared by insert() and bulkInsertMemories() so a column change is made
	 * in exactly one place. Includes the TASK-121 branch column.
	 *
	 * `last_used_at` is deliberately hardcoded to NULL on INSERT (MEM-586 /
	 * TASK-129 — INTENTIONAL, not a bug): creation does NOT count as "used".
	 * A memory is timestamped only by the explicit usage paths —
	 * acknowledge("used")/recall via incrementRecallCount(), incrementHitCount(s)(),
	 * or a direct update() — and reads/searches deliberately never touch it
	 * (memory.read.ts: "No hit_count increments on read"), keeping reads
	 * side-effect-free and write-lock-free. Consumers must treat NULL as
	 * "never explicitly used": soul-maintenance decay (`last_used_at IS NULL
	 * OR last_used_at < cutoff`) and archive expiry
	 * (COALESCE(last_used_at, created_at)) already handle NULL correctly.
	 */
	private buildInsert(entry: MemoryEntry): { sql: string; params: unknown[] } {
		const mergedMeta = mergeStructuredData(entry.metadata, entry.structuredData);
		return {
			sql: `INSERT INTO ${TABLE_MEMORIES} (
				id, code, repo, owner, type, title, content, importance, folder, language, branch,
				created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
				supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			params: [
				entry.id,
				entry.code || null,
				entry.scope.repo,
				entry.scope.owner,
				entry.type,
				entry.title || null,
				entry.content,
				entry.importance,
				entry.scope.folder || null,
				entry.scope.language || null,
				entry.scope.branch || null,
				entry.created_at,
				entry.updated_at,
				entry.expires_at ?? null,
				entry.supersedes ?? null,
				entry.status || MEMORY_STATUS_ACTIVE,
				entry.is_global ? 1 : 0,
				entry.tags ? JSON.stringify(entry.tags) : null,
				mergedMeta ? JSON.stringify(mergedMeta) : null,
				entry.agent || "unknown",
				entry.role || "unknown",
				entry.model || "unknown",
				entry.completed_at || null
			]
		};
	}

	insert(entry: MemoryEntry): void {
		const { sql, params } = this.buildInsert(entry);
		this.run(sql, params);
	}

	update(id: string, updates: Partial<MemoryEntry>): void {
		const { fields, values } = buildUpdateClause(this.buildUpdateMap(updates, true, id), {
			jsonKeys: MEMORY_JSON_KEYS,
			intKeys: MEMORY_INT_KEYS
		});

		if (fields.length === 0) return;

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());
		values.push(id);

		this.run(`UPDATE ${TABLE_MEMORIES} SET ${fields.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
	}

	/**
	 * Normalize a Partial<MemoryEntry> into a flat column→value map for the
	 * shared update-clause builder (TASK-109), preserving the exact
	 * pre-refactor whitelist and serialization semantics:
	 *
	 * - `scope` expands into its scalar columns (owner/repo/folder/language/branch)
	 *   with the same per-key guards (owner/folder/language/branch when
	 *   `!== undefined`, repo when truthy).
	 * - `structuredData` is merged into the existing metadata JSON blob — in
	 *   the single-id update path (`mergeStructuredData=true, id` set) and, per
	 *   row within {@link bulkUpdateMemories}, where each row's stored metadata
	 *   is read and merged the same way so bulk matches single-update
	 *   semantics. Passed `false` with no id when the caller handled merging
	 *   (or omits structuredData entirely).
	 * - Every other key is kept only when it is tags/metadata/is_global or a
	 *   whitelisted VALID_COLUMNS member; unknown keys are ignored.
	 */
	private buildUpdateMap(
		updates: Partial<MemoryEntry>,
		mergeStructuredData: boolean,
		id?: string
	): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(updates)) {
			if (value === undefined) continue;
			if (key === "scope") {
				const scope = value as MemoryScope;
				if (scope.owner !== undefined) result.owner = scope.owner;
				if (scope.repo) result.repo = scope.repo;
				if (scope.folder !== undefined) result.folder = scope.folder;
				if (scope.language !== undefined) result.language = scope.language;
				if (scope.branch !== undefined) result.branch = scope.branch;
			} else if (key === "structuredData") {
				if (!mergeStructuredData || id === undefined) continue;
				const existingRow = this.get<{ metadata: string }>(`SELECT metadata FROM ${TABLE_MEMORIES} WHERE id = ?`, [id]);
				const existingMeta = existingRow ? this.safeJSONParse<Record<string, unknown>>(existingRow.metadata, {}) : {};
				result.metadata = { ...existingMeta, structuredData: value };
			} else if (key === "tags" || key === "metadata" || key === "is_global" || VALID_COLUMNS.has(key)) {
				result[key] = value;
			}
		}
		return result;
	}

	delete(id: string): void {
		this.run(`DELETE FROM ${TABLE_MEMORIES} WHERE id = ?`, [id]);
	}

	getById(id: string): MemoryEntry | null {
		const row = this.get<MemoryRow>(`SELECT * FROM ${TABLE_MEMORIES} WHERE id = ?`, [id]);
		return row ? this.rowToMemoryEntry(row) : null;
	}

	getByCode(code: string, owner?: string, repo?: string): MemoryEntry | null {
		let sql = `SELECT * FROM ${TABLE_MEMORIES} WHERE code = ?`;
		const params: (string | null)[] = [code];
		if (owner && repo) {
			sql += " AND ((owner = ? AND repo = ?) OR is_global = 1)";
			params.push(owner, repo);
		}
		const row = this.get<MemoryRow>(sql, params);
		return row ? this.rowToMemoryEntry(row) : null;
	}

	getByIdWithStats(id: string): (MemoryEntry & { recall_rate: number }) | null {
		const row = this.get<MemoryRow & { recall_rate: number }>(
			`SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate FROM ${TABLE_MEMORIES} WHERE id = ?`,
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
		// Chunk at BULK_UPDATE_CHUNK_SIZE (500) to bound the IN()-list width —
		// very large id sets produce long SQL strings that miss better-sqlite3's
		// prepare cache and can stall the parser. Results are fused per-chunk;
		// callers consume by-id (Set/Map lookup), so concatenation is safe.
		const results: MemoryEntry[] = [];
		for (let i = 0; i < ids.length; i += BULK_UPDATE_CHUNK_SIZE) {
			const chunk = ids.slice(i, i + BULK_UPDATE_CHUNK_SIZE);
			let sql = `SELECT * FROM ${TABLE_MEMORIES} WHERE id IN (${chunk.map(() => "?").join(",")})`;
			const params: (string | number)[] = [...chunk];
			if (options.type) {
				sql += " AND type = ?";
				params.push(options.type);
			}
			if (options.status) {
				sql += " AND status = ?";
				params.push(options.status);
			}
			const rows = this.all<MemoryRow>(sql, params);
			results.push(...rows.map((row) => this.rowToMemoryEntry(row)));
		}
		return results;
	}

	/**
	 * Bulk-load memories by code with the same owner/repo/global scoping as
	 * getByCode, but in a single query. Results preserve the input code order
	 * (first match per code, mirroring per-code getByCode lookups).
	 */
	getMemoriesByCodes(codes: string[], owner?: string, repo?: string): MemoryEntry[] {
		if (codes.length === 0) return [];
		const byCode = new Map<string, MemoryEntry>();
		// Chunk at BULK_UPDATE_CHUNK_SIZE (500) — same rationale as getByIds.
		for (let i = 0; i < codes.length; i += BULK_UPDATE_CHUNK_SIZE) {
			const chunk = codes.slice(i, i + BULK_UPDATE_CHUNK_SIZE);
			const placeholders = chunk.map(() => "?").join(",");
			let sql = `SELECT * FROM ${TABLE_MEMORIES} WHERE code IN (${placeholders})`;
			const params: (string | null)[] = [...chunk];
			if (owner && repo) {
				sql += " AND ((owner = ? AND repo = ?) OR is_global = 1)";
				params.push(owner, repo);
			}
			const rows = this.all<MemoryRow>(sql, params);
			for (const row of rows) {
				const entry = this.rowToMemoryEntry(row);
				if (entry.code && !byCode.has(entry.code)) byCode.set(entry.code, entry);
			}
		}

		const seen = new Set<string>();
		const result: MemoryEntry[] = [];
		for (const code of codes) {
			const entry = byCode.get(code);
			if (entry && !seen.has(code)) {
				seen.add(code);
				result.push(entry);
			}
		}
		return result;
	}

	getStats(owner?: string, repo?: string): { total: number; byType: Record<string, number> } {
		let sql = `SELECT type, COUNT(*) as count FROM ${TABLE_MEMORIES}`;
		const params: unknown[] = [];
		if (owner) {
			sql += " WHERE owner = ?";
			params.push(owner);
			if (repo) {
				sql += " AND repo = ?";
				params.push(repo);
			}
		} else if (repo) {
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

	/**
	 * FTS5-first keyword search over title/content/tags (MEM-367 / TASK-014).
	 * Filters mirror the LIKE path in {@link searchByRepo} exactly (owner/repo,
	 * status='active', not expired, optional type); ordering is bm25 relevance
	 * first with the historical importance/created_at tie-break preserved.
	 * Returns [] on any FTS error or unbuildable query — callers must fall
	 * back to the LIKE path.
	 */
	searchByFts(query: string, owner: string, repo: string, type?: string, limit = 5): MemoryEntry[] {
		try {
			const safeQuery = buildFtsMatchQuery(query);
			if (!safeQuery) return [];

			const conditions = ["memories_fts MATCH ?"];
			const params: (string | number)[] = [safeQuery];
			if (owner) {
				conditions.push("m.owner = ? AND m.repo = ?");
				params.push(owner, repo);
			} else {
				conditions.push("m.repo = ?");
				params.push(repo);
			}
			conditions.push(`m.status = '${MEMORY_STATUS_ACTIVE}'`, "(m.expires_at IS NULL OR m.expires_at > ?)");
			params.push(new Date().toISOString());
			if (type) {
				conditions.push("m.type = ?");
				params.push(type);
			}
			params.push(limit);

			const rows = this.all<MemoryRow>(
				`SELECT m.*
				 FROM memories_fts fts
				 JOIN ${TABLE_MEMORIES} m ON m.rowid = fts.rowid
				 WHERE ${conditions.join(" AND ")}
				 ORDER BY bm25(memories_fts), m.importance DESC, m.created_at DESC
				 LIMIT ?`,
				params
			);
			return rows.map((row) => this.rowToMemoryEntry(row));
		} catch {
			return [];
		}
	}

	/**
	 * bm25-scored FTS search (MEM-367 §6.1): matching memories with their raw
	 * `bm25(memories_fts)` scores, ordered most-relevant first. Scope mirrors
	 * `memoryVectors.searchBySimilarity` — `(owner AND repo) OR is_global`,
	 * active unless includeArchived, not expired. Used by memory.read.ts to
	 * feed a min-max-normalized bm25 into the 0.30 keyword hybrid weight.
	 */
	searchByFtsScored(
		query: string,
		owner: string,
		repo: string,
		options: { type?: string; limit?: number; includeArchived?: boolean } = {}
	): Array<{ memory: MemoryEntry; bm25: number }> {
		const { type, limit = 100, includeArchived = false } = options;
		try {
			const safeQuery = buildFtsMatchQuery(query);
			if (!safeQuery) return [];

			const conditions = ["memories_fts MATCH ?"];
			const params: (string | number)[] = [safeQuery];
			if (owner) {
				conditions.push("((m.owner = ? AND m.repo = ?) OR m.is_global = 1)");
				params.push(owner, repo);
			} else if (repo) {
				conditions.push("m.repo = ?");
				params.push(repo);
			}
			if (!includeArchived) conditions.push(`m.status = '${MEMORY_STATUS_ACTIVE}'`);
			conditions.push("(m.expires_at IS NULL OR m.expires_at > ?)");
			params.push(new Date().toISOString());
			if (type) {
				conditions.push("m.type = ?");
				params.push(type);
			}
			params.push(limit);

			const rows = this.all<MemoryRow & { bm25_score: number }>(
				`SELECT m.*, bm25(memories_fts) AS bm25_score
				 FROM memories_fts fts
				 JOIN ${TABLE_MEMORIES} m ON m.rowid = fts.rowid
				 WHERE ${conditions.join(" AND ")}
				 ORDER BY bm25_score
				 LIMIT ?`,
				params
			);
			return rows.map((row) => ({ memory: this.rowToMemoryEntry(row), bm25: row.bm25_score ?? 0 }));
		} catch {
			return [];
		}
	}

	/**
	 * Dashboard FTS fast path (MEM-367 §5.3): search clause replaced by the
	 * FTS5 join while every other filter stays as an `m.*` predicate. The tag
	 * filter uses the indexed memory_tags child table (OPT-PERF-07) instead of
	 * an unindexable `m.tags LIKE` scan. Returns null when FTS produced no
	 * matches or errored so the caller falls back to the LIKE path (permanent
	 * fallback pattern).
	 */
	private tryDashboardFtsSearch(options: {
		ftsMatch: string;
		owner?: string;
		repo?: string;
		type?: MemoryType;
		tag?: string;
		isGlobal?: boolean;
		minImportance?: number;
		maxImportance?: number;
		sortBy: string;
		sortOrder: "ASC" | "DESC";
		limit: number;
		offset: number;
	}): {
		items: (MemoryEntry & { recall_rate: number })[];
		total: number;
		limit: number;
		offset: number;
	} | null {
		try {
			const {
				ftsMatch,
				owner,
				repo,
				type,
				tag,
				isGlobal,
				minImportance,
				maxImportance,
				sortBy,
				sortOrder,
				limit,
				offset
			} = options;
			const conditions = ["memories_fts MATCH ?"];
			const params: (string | number)[] = [ftsMatch];

			if (owner) {
				conditions.push("m.owner = ?");
				params.push(owner);
			}
			if (repo) {
				conditions.push("m.repo = ?");
				params.push(repo);
			}
			if (type) {
				conditions.push("m.type = ?");
				params.push(type);
			}
			if (tag) {
				// Indexed tag filter via the normalized memory_tags table
				// (OPT-PERF-07) instead of an unindexable LIKE on tags JSON.
				conditions.push("EXISTS (SELECT 1 FROM memory_tags t WHERE t.memory_id = m.id AND t.tag = ?)");
				params.push(tag);
			}
			if (isGlobal !== undefined) {
				conditions.push("m.is_global = ?");
				params.push(isGlobal ? 1 : 0);
			}
			if (minImportance !== undefined) {
				conditions.push("m.importance >= ?");
				params.push(minImportance);
			}
			if (maxImportance !== undefined) {
				conditions.push("m.importance <= ?");
				params.push(maxImportance);
			}

			const whereClause = conditions.join(" AND ");
			const totalRow = this.get<CountResult>(
				`SELECT COUNT(*) as count FROM memories_fts fts JOIN ${TABLE_MEMORIES} m ON m.rowid = fts.rowid WHERE ${whereClause}`,
				params
			);
			const total = totalRow?.count ?? 0;
			if (total === 0) return null; // no FTS match → LIKE fallback (mid-word recall)

			const rows = this.all<MemoryRow & { recall_rate: number }>(
				`SELECT m.*, CASE WHEN m.hit_count > 0 THEN CAST(m.recall_count AS REAL) / m.hit_count ELSE 0 END AS recall_rate
				 FROM memories_fts fts JOIN ${TABLE_MEMORIES} m ON m.rowid = fts.rowid
				 WHERE ${whereClause}
				 ORDER BY m.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`,
				[...params, limit, offset]
			);
			return {
				items: rows.map((row) => ({
					...this.rowToMemoryEntry(row),
					recall_rate: row.recall_rate || 0
				})),
				total,
				limit,
				offset
			};
		} catch {
			return null;
		}
	}

	searchByRepo(owner: string, repo: string, query: string = "", type?: string, limit = 5): MemoryEntry[] {
		const now = new Date().toISOString();

		// FTS5-first keyword search (MEM-367 / TASK-014); the LIKE path stays
		// as a permanent fallback for empty/unbuildable queries, FTS errors,
		// and queries with no FTS match (mirrors codebase-symbol.ts).
		if (query && query.trim()) {
			const ftsHits = this.searchByFts(query, owner, repo, type, limit);
			if (ftsHits.length > 0) return ftsHits;
		}

		const ownerClause = owner ? "owner = ? AND " : "";
		let sql = `SELECT * FROM ${TABLE_MEMORIES} WHERE ${ownerClause}repo = ? AND (content LIKE ? OR title LIKE ? OR tags LIKE ?) AND status = '${MEMORY_STATUS_ACTIVE}' AND (expires_at IS NULL OR expires_at > ?)`;
		const params: (string | number)[] = owner
			? [owner, repo, `%${query}%`, `%${query}%`, `%${query}%`, now]
			: [repo, `%${query}%`, `%${query}%`, `%${query}%`, now];

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
				const { sql, params } = this.buildInsert(entry);
				this.run(sql, params);
				count++;
			}
			return count;
		});
	}

	bulkUpdateMemories(ids: string[], updates: Partial<MemoryEntry>): number {
		if (ids.length === 0) return 0;

		// structuredData is row-specific: the merge target is each row's own
		// stored metadata blob, so it cannot ride the shared batched SET clause
		// below. When present we fall through to the per-row path (mirrors
		// update()); otherwise keep the single-clause batched UPDATE exactly as
		// before (TASK-122 alignment, TASK-129 semantics untouched).
		if (updates.structuredData !== undefined) {
			const now = new Date().toISOString();
			return this.transaction(() => {
				let count = 0;
				for (const id of ids) {
					// Same merge as update(): read the row's stored metadata
					// and set the `structuredData` key inside it, preserving
					// every other metadata entry.
					const { fields, values } = buildUpdateClause(this.buildUpdateMap(updates, true, id), {
						jsonKeys: MEMORY_JSON_KEYS,
						intKeys: MEMORY_INT_KEYS
					});
					if (fields.length === 0) continue;
					fields.push("updated_at = ?");
					values.push(now);
					values.push(id);
					const result = this.run(
						`UPDATE ${TABLE_MEMORIES} SET ${fields.join(", ")} WHERE id = ?`,
						values as (string | number)[]
					);
					count += result.changes;
				}
				return count;
			});
		}

		const { fields, values } = buildUpdateClause(this.buildUpdateMap(updates, false), {
			jsonKeys: MEMORY_JSON_KEYS,
			intKeys: MEMORY_INT_KEYS
		});

		if (fields.length === 0) return 0;

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());

		return this.transaction(() => {
			let count = 0;
			for (let i = 0; i < ids.length; i += BULK_UPDATE_CHUNK_SIZE) {
				const chunk = ids.slice(i, i + BULK_UPDATE_CHUNK_SIZE);
				const result = this.run(
					`UPDATE ${TABLE_MEMORIES} SET ${fields.join(", ")} WHERE id IN (${chunk.map(() => "?").join(",")})`,
					[...values, ...chunk] as (string | number)[]
				);
				count += result.changes;
			}
			return count;
		});
	}

	getRecentMemories(
		owner: string,
		repo: string,
		limit: number,
		offset: number = 0,
		includeArchived: boolean = false,
		excludeTypes: string[] = [],
		sortOrder: "ASC" | "DESC" = "DESC"
	): MemoryEntry[] {
		const ownerClause = owner ? "owner = ? AND " : "";
		let query = `SELECT * FROM ${TABLE_MEMORIES} WHERE ${ownerClause}repo = ?`;
		const params: (string | number)[] = owner ? [owner, repo] : [repo];

		if (!includeArchived) {
			query += ` AND status = '${MEMORY_STATUS_ACTIVE}'`;
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

	getTotalCount(owner: string, repo: string, includeArchived = false, excludeTypes: string[] = []): number {
		const ownerClause = owner ? "owner = ? AND " : "";
		let sql = `SELECT COUNT(*) as count FROM ${TABLE_MEMORIES} WHERE ${ownerClause}repo = ?`;
		const params: (string | number)[] = owner ? [owner, repo] : [repo];

		if (!includeArchived) sql += ` AND status = '${MEMORY_STATUS_ACTIVE}'`;

		if (excludeTypes.length > 0) {
			sql += ` AND type NOT IN (${excludeTypes.map(() => "?").join(",")})`;
			params.push(...excludeTypes);
		}

		const row = this.get<CountResult>(sql, params);
		return row?.count ?? 0;
	}

	incrementHitCount(id: string): void {
		this.run(`UPDATE ${TABLE_MEMORIES} SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?`, [
			new Date().toISOString(),
			id
		]);
	}

	incrementHitCounts(ids: string[]): void {
		if (!ids || ids.length === 0) return;
		const now = new Date().toISOString();
		// Chunk at BULK_UPDATE_CHUNK_SIZE (500) — same rationale as getByIds.
		for (let i = 0; i < ids.length; i += BULK_UPDATE_CHUNK_SIZE) {
			const chunk = ids.slice(i, i + BULK_UPDATE_CHUNK_SIZE);
			const placeholders = chunk.map(() => "?").join(",");
			this.run(
				`UPDATE ${TABLE_MEMORIES} SET hit_count = hit_count + 1, last_used_at = ? WHERE id IN (${placeholders})`,
				[now, ...chunk]
			);
		}
	}

	incrementRecallCount(id: string): void {
		this.run(`UPDATE ${TABLE_MEMORIES} SET recall_count = recall_count + 1, last_used_at = ? WHERE id = ?`, [
			new Date().toISOString(),
			id
		]);
	}

	getAllMemoriesWithStats(
		owner: string,
		repo: string,
		limit?: number,
		offset?: number
	): (MemoryEntry & { recall_rate: number })[] {
		const ownerClause = owner ? "owner = ? AND " : "";
		let sql = `SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate FROM ${TABLE_MEMORIES} WHERE ${ownerClause}repo = ? ORDER BY created_at DESC`;
		const params: unknown[] = owner ? [owner, repo] : [repo];
		if (limit !== undefined) {
			sql += " LIMIT ?";
			params.push(limit);
			if (offset !== undefined) {
				sql += " OFFSET ?";
				params.push(offset);
			}
		}
		const rows = this.all<MemoryRow & { recall_rate: number }>(sql, params);
		return rows.map((row) => ({
			...this.rowToMemoryEntry(row),
			recall_rate: row.recall_rate || 0
		}));
	}

	listMemoriesForDashboard(options: {
		owner?: string;
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
		total: number;
		limit: number;
		offset: number;
	} {
		const {
			owner,
			repo,
			type,
			tag,
			isGlobal,
			minImportance,
			maxImportance,
			search,
			offset = 0,
			limit = 50,
			sortOrder = "DESC"
		} = options;
		let sortBy = options.sortBy ?? "created_at";

		const ALLOWED_SORT_COLUMNS = new Set([
			"created_at",
			"updated_at",
			"importance",
			"hit_count",
			"title",
			"recall_rate"
		]);
		if (!ALLOWED_SORT_COLUMNS.has(sortBy)) {
			sortBy = "created_at";
		}

		// FTS fast path when a non-empty search term is present (MEM-367
		// §5.3): the search clause becomes the FTS5 join while all other
		// filters stay as m.* predicates. Used only when it returned
		// matches; empty/error falls through to the LIKE path below.
		if (search) {
			const ftsMatch = buildFtsMatchQuery(search);
			if (ftsMatch) {
				const ftsResult = this.tryDashboardFtsSearch({
					ftsMatch,
					owner,
					repo,
					type,
					tag,
					isGlobal,
					minImportance,
					maxImportance,
					sortBy,
					sortOrder,
					limit,
					offset
				});
				if (ftsResult !== null) return ftsResult;
			}
		}

		const where = ["1=1"];
		const params: (string | number)[] = [];
		if (owner) {
			where.push("owner = ?");
			params.push(owner);
		}
		if (repo) {
			where.push("repo = ?");
			params.push(repo);
		}
		if (type) {
			where.push("type = ?");
			params.push(type);
		}
		if (tag) {
			// Indexed child-table equality (OPT-PERF-07) — replaces the
			// `tags LIKE '%tag%'` scan on the tags JSON text column.
			where.push("EXISTS (SELECT 1 FROM memory_tags t WHERE t.memory_id = memories.id AND t.tag = ?)");
			params.push(tag);
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

		const countSql = `SELECT COUNT(*) as count FROM ${TABLE_MEMORIES} WHERE ${where.join(" AND ")}`;
		const totalRow = this.get<CountResult>(countSql, params);
		const total = totalRow?.count ?? 0;

		const dataSql = `SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate FROM ${TABLE_MEMORIES} WHERE ${where.join(" AND ")} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
		const rows = this.all<MemoryRow & { recall_rate: number }>(dataSql, [...params, limit, offset]);
		const items = rows.map((row) => ({
			...this.rowToMemoryEntry(row),
			recall_rate: row.recall_rate || 0
		}));

		return { items, total, limit, offset };
	}
}
