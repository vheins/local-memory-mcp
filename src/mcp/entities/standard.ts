import { BaseEntity } from "../storage/base";
import { CodingStandardEntry, CodingStandardRow } from "../types/memory";

export class StandardEntity extends BaseEntity {
	insert(entry: CodingStandardEntry): void {
		this.run(
			`INSERT INTO coding_standards (
				id, title, content, context, version, language, stack,
				is_global, repo, tags, metadata, created_at, updated_at, agent, model
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				entry.id,
				entry.title,
				entry.content,
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
		language?: string;
		stack?: string;
		repo?: string;
		is_global?: boolean;
		limit?: number;
		offset?: number;
	}): CodingStandardEntry[] {
		const { query, context, language, stack, repo, is_global, limit = 20, offset = 0 } = options;

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
		if (language) {
			where.push("language = ?");
			params.push(language);
		}
		if (stack) {
			where.push("stack LIKE ?");
			params.push(`%${stack}%`);
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

	private rowToEntry(row: CodingStandardRow): CodingStandardEntry {
		return {
			id: row.id,
			title: row.title,
			content: row.content,
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
			agent: row.agent,
			model: row.model
		};
	}
}
