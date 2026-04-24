import { BaseEntity } from "../storage/base";
import { CodingStandardEntry, CodingStandardRow } from "../types/memory";

export class StandardEntity extends BaseEntity {
	insert(entry: CodingStandardEntry): void {
		this.run(
			`INSERT INTO coding_standards (
				id, title, content, parent_id, context, version, language, stack,
				is_global, repo, tags, metadata, created_at, updated_at, hit_count, last_used_at, agent, model
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				entry.id,
				entry.title,
				entry.content,
				entry.parent_id,
				entry.context,
				entry.version,
				entry.language ?? null,
				entry.stack.length > 0 ? JSON.stringify(entry.stack) : null,
				entry.is_global ? 1 : 0,
				entry.repo ?? null,
				entry.tags.length > 0 ? JSON.stringify(entry.tags) : null,
				Object.keys(entry.metadata).length > 0 ? JSON.stringify(entry.metadata) : null,
				entry.created_at,
				entry.updated_at,
				entry.hit_count,
				entry.last_used_at,
				entry.agent,
				entry.model
			]
		);
	}

	getById(id: string): CodingStandardEntry | null {
		const row = this.get<CodingStandardRow>("SELECT * FROM coding_standards WHERE id = ?", [id]);
		return row ? this.rowToEntry(row) : null;
	}

	search(options: {
		query?: string;
		context?: string;
		version?: string;
		language?: string;
		stack?: string;
		tag?: string;
		repo?: string;
		is_global?: boolean;
		limit?: number;
		offset?: number;
	}): CodingStandardEntry[] {
		const { query, context, version, language, stack, tag, repo, is_global, limit = 20, offset = 0 } = options;

		const where: string[] = [];
		const params: (string | number | null)[] = [];

		if (query) {
			where.push("(title LIKE ? OR content LIKE ? OR context LIKE ?)");
			params.push(`%${query}%`, `%${query}%`, `%${query}%`);
		}
		if (context) {
			where.push("context = ?");
			params.push(context);
		}
		if (version) {
			where.push("version = ?");
			params.push(version);
		}
		if (language) {
			where.push("language = ?");
			params.push(language);
		}
		if (stack) {
			where.push("stack LIKE ?");
			params.push(`%${stack}%`);
		}
		if (tag) {
			where.push("tags LIKE ?");
			params.push(`%${tag}%`);
		}
		if (repo !== undefined) {
			where.push("(repo = ? OR is_global = 1)");
			params.push(repo);
		}
		if (is_global !== undefined) {
			where.push("is_global = ?");
			params.push(is_global ? 1 : 0);
		}

		const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
		const sql = `SELECT * FROM coding_standards ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
		params.push(limit, offset);

		const rows = this.all<CodingStandardRow>(sql, params);
		return rows.map((r) => this.rowToEntry(r));
	}

	searchBySimilarity(
		query: string,
		options: {
			context?: string;
			version?: string;
			language?: string;
			stack?: string[];
			tags?: string[];
			repo?: string;
			is_global?: boolean;
			limit?: number;
			offset?: number;
		}
	): Array<CodingStandardEntry & { similarity: number }> {
		const candidates = this.search({
			context: options.context,
			version: options.version,
			language: options.language,
			stack: options.stack?.[0],
			tag: options.tags?.[0],
			repo: options.repo,
			is_global: options.is_global,
			limit: options.limit ?? 60,
			offset: options.offset ?? 0
		});

		const queryVector = this.computeVector(query);
		return candidates
			.map((standard) => {
				const haystack = [
					standard.title,
					standard.content,
					standard.context,
					standard.language ?? "",
					standard.version,
					...standard.stack,
					...standard.tags,
					JSON.stringify(standard.metadata)
				]
					.filter(Boolean)
					.join(" ");
				const similarity = this.cosineSimilarity(queryVector, this.computeVector(haystack));
				return { ...standard, similarity };
			})
			.sort((a, b) => b.similarity - a.similarity);
	}

	getByIds(ids: string[]): CodingStandardEntry[] {
		if (ids.length === 0) return [];
		const placeholders = ids.map(() => "?").join(",");
		const rows = this.all<CodingStandardRow>(
			`SELECT * FROM coding_standards WHERE id IN (${placeholders})`,
			ids
		);
		return rows.map((row) => this.rowToEntry(row));
	}

	update(id: string, updates: Partial<CodingStandardEntry>): void {
		const fields: string[] = [];
		const values: unknown[] = [];

		Object.keys(updates).forEach((key) => {
			const k = key as keyof CodingStandardEntry;
			const val = updates[k];
			if (val !== undefined) {
				if (k === "stack" || k === "tags") {
					fields.push(`${k} = ?`);
					values.push(Array.isArray(val) ? JSON.stringify(val) : val);
				} else if (k === "metadata") {
					fields.push(`${k} = ?`);
					values.push(typeof val === "object" ? JSON.stringify(val) : val);
				} else if (k === "is_global") {
					fields.push(`${k} = ?`);
					values.push(val ? 1 : 0);
				} else if (k !== "id" && k !== "created_at") {
					fields.push(`${k} = ?`);
					values.push(val);
				}
			}
		});

		if (fields.length === 0) return;

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());
		values.push(id);

		this.run(`UPDATE coding_standards SET ${fields.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
	}

	delete(id: string): void {
		this.run("DELETE FROM coding_standards WHERE id = ?", [id]);
	}

	incrementHitCounts(ids: string[]): void {
		if (ids.length === 0) return;
		const placeholders = ids.map(() => "?").join(",");
		const now = new Date().toISOString();
		this.run(
			`UPDATE coding_standards
			 SET hit_count = hit_count + 1,
			     last_used_at = ?
			 WHERE id IN (${placeholders})`,
			[now, ...ids]
		);
	}

	getVectorCandidates(repo?: string, limit = 100): { standard_id: string; vector: string }[] {
		let sql = `SELECT sv.standard_id, sv.vector
			FROM standard_vectors sv
			JOIN coding_standards cs ON cs.id = sv.standard_id`;
		const params: (string | number)[] = [];

		if (repo) {
			sql += " WHERE (cs.repo = ? OR cs.is_global = 1)";
			params.push(repo);
		}

		sql += " ORDER BY cs.updated_at DESC LIMIT ?";
		params.push(limit);
		return this.all<{ standard_id: string; vector: string }>(sql, params);
	}

	upsertVectorEmbedding(standardId: string, vector: number[]): void {
		this.run(
			`INSERT INTO standard_vectors (standard_id, vector, updated_at)
			VALUES (?, ?, ?)
			ON CONFLICT(standard_id) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at`,
			[standardId, JSON.stringify(vector), new Date().toISOString()]
		);
	}

	private rowToEntry(row: CodingStandardRow): CodingStandardEntry {
		return {
			id: row.id,
			title: row.title,
			content: row.content,
			parent_id: row.parent_id ?? null,
			context: row.context,
			version: row.version,
			language: row.language ?? null,
			stack: this.safeJSONParse<string[]>(row.stack, []),
			is_global: row.is_global === 1,
			repo: row.repo ?? null,
			tags: this.safeJSONParse<string[]>(row.tags, []),
			metadata: this.safeJSONParse<Record<string, unknown>>(row.metadata, {}),
			created_at: row.created_at,
			updated_at: row.updated_at,
			hit_count: row.hit_count ?? 0,
			last_used_at: row.last_used_at ?? null,
			agent: row.agent,
			model: row.model
		};
	}
}
