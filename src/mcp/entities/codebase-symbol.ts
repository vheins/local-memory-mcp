import { BaseEntity } from "../storage/base";
import { CodebaseSymbol, CodebaseSymbolInsert, SymbolSearchQuery, SymbolSearchResult } from "../types/codebase-symbol";
import { randomUUID } from "crypto";

export class CodebaseSymbolEntity extends BaseEntity {
	bulkUpsertSymbols(symbols: CodebaseSymbolInsert[]): number {
		return this.transaction(() => {
			const now = new Date().toISOString();
			const stmt = this.db.prepare(`
				INSERT INTO codebase_symbols (
					id, repo, file_path, name, kind, exported, default_export,
					start_line, start_col, end_line, end_col, signature, doc_comment,
					parent_symbol_id, created_at, updated_at
				) VALUES (
					?, ?, ?, ?, ?, ?, ?,
					?, ?, ?, ?, ?, ?,
					?, ?, ?
				)
			`);

			let count = 0;
			for (const sym of symbols) {
				const id = randomUUID();
				stmt.run(
					id,
					sym.repo,
					sym.file_path,
					sym.name,
					sym.kind,
					sym.exported ? 1 : 0,
					sym.default_export ? 1 : 0,
					sym.start_line ?? null,
					sym.start_col ?? null,
					sym.end_line ?? null,
					sym.end_col ?? null,
					sym.signature ?? null,
					sym.doc_comment ?? null,
					sym.parent_symbol_id ?? null,
					now,
					now
				);
				count++;
			}
			return count;
		});
	}

	getSymbolsByFile(repo: string, filePath: string): CodebaseSymbol[] {
		return this.all<CodebaseSymbol>(
			"SELECT * FROM codebase_symbols WHERE repo = ? AND file_path = ? ORDER BY start_line ASC",
			[repo, filePath]
		).map((r) => this.rowToSymbol(r));
	}

	getSymbolByName(repo: string, name: string): CodebaseSymbol[] {
		return this.all<CodebaseSymbol>(
			"SELECT * FROM codebase_symbols WHERE repo = ? AND name = ? ORDER BY file_path ASC, start_line ASC",
			[repo, name]
		).map((r) => this.rowToSymbol(r));
	}

	searchSymbols(query: SymbolSearchQuery): SymbolSearchResult {
		const limit = Math.min(query.limit ?? 50, 200);
		const offset = query.offset ?? 0;

		// Try FTS5 first; only use if it returned actual results
		const ftsResult = this.tryFtsSearch(query, limit, offset);
		if (ftsResult && ftsResult.symbols.length > 0) return ftsResult;

		// Fallback to LIKE search
		return this.likeSearch(query, limit, offset);
	}

	deleteSymbolsByFile(repo: string, filePath: string): number {
		const result = this.run("DELETE FROM codebase_symbols WHERE repo = ? AND file_path = ?", [repo, filePath]);
		return result.changes;
	}

	getSymbolsByRepo(repo: string): CodebaseSymbol[] {
		return this.all<CodebaseSymbol>(
			"SELECT * FROM codebase_symbols WHERE repo = ? ORDER BY file_path ASC, start_line ASC",
			[repo]
		).map((r) => this.rowToSymbol(r));
	}

	deleteSymbolsByRepo(repo: string): number {
		const result = this.run("DELETE FROM codebase_symbols WHERE repo = ?", [repo]);
		return result.changes;
	}

	private tryFtsSearch(query: SymbolSearchQuery, limit: number, offset: number): SymbolSearchResult | null {
		try {
			const safeTerm = query.query.replace(/[^\w\s."']/g, "").trim();
			if (!safeTerm) return null;

			const parts: string[] = [];
			const conditions: string[] = ["codebase_symbols_fts MATCH ?"];
			const params: unknown[] = [safeTerm];

			if (query.repo) {
				conditions.push("cs.repo = ?");
				params.push(query.repo);
			}
			if (query.kind) {
				conditions.push("cs.kind = ?");
				params.push(query.kind);
			}
			if (query.filePath) {
				conditions.push("cs.file_path = ?");
				params.push(query.filePath);
			}
			if (query.exportedOnly) {
				conditions.push("cs.exported = 1");
			}

			parts.push(`
				SELECT cs.*, rank
				FROM codebase_symbols_fts fts
				JOIN codebase_symbols cs ON cs.rowid = fts.rowid
				WHERE ${conditions.join(" AND ")}
				ORDER BY rank
				LIMIT ? OFFSET ?
			`);
			params.push(limit, offset);

			const countParts: string[] = [];
			const countPartsConditions = [...conditions];
			countParts.push(`
				SELECT COUNT(*) as total
				FROM codebase_symbols_fts fts
				JOIN codebase_symbols cs ON cs.rowid = fts.rowid
				WHERE ${countPartsConditions.join(" AND ")}
			`);

			const symbols = this.all<CodebaseSymbol>(parts[0], params).map((r) => this.rowToSymbol(r));

			const countRow = this.get<{ total: number }>(
				countParts[0],
				params.slice(0, -2) // Remove limit/offset
			);

			const total = countRow?.total ?? symbols.length;
			return {
				symbols,
				total,
				hasMore: offset + limit < total
			};
		} catch {
			return null;
		}
	}

	private likeSearch(query: SymbolSearchQuery, limit: number, offset: number): SymbolSearchResult {
		const likeTerm = `%${query.query}%`;
		const conditions: string[] = ["(cs.name LIKE ? OR cs.doc_comment LIKE ?)"];
		const params: unknown[] = [likeTerm, likeTerm];

		if (query.repo) {
			conditions.push("cs.repo = ?");
			params.push(query.repo);
		}
		if (query.kind) {
			conditions.push("cs.kind = ?");
			params.push(query.kind);
		}
		if (query.filePath) {
			conditions.push("cs.file_path = ?");
			params.push(query.filePath);
		}
		if (query.exportedOnly) {
			conditions.push("cs.exported = 1");
		}

		const whereClause = conditions.join(" AND ");

		const symbols = this.all<CodebaseSymbol>(
			`SELECT cs.* FROM codebase_symbols cs WHERE ${whereClause} ORDER BY cs.name ASC LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		).map((r) => this.rowToSymbol(r));

		const countRow = this.get<{ total: number }>(
			`SELECT COUNT(*) as total FROM codebase_symbols cs WHERE ${whereClause}`,
			params
		);

		const total = countRow?.total ?? symbols.length;
		return {
			symbols,
			total,
			hasMore: offset + limit < total
		};
	}

	private rowToSymbol(row: unknown): CodebaseSymbol {
		const r = row as Record<string, unknown>;
		return {
			id: r.id as string,
			repo: r.repo as string,
			file_path: r.file_path as string,
			name: r.name as string,
			kind: r.kind as string,
			exported: (r.exported as number) === 1,
			default_export: (r.default_export as number) === 1,
			start_line: (r.start_line as number) ?? null,
			start_col: (r.start_col as number) ?? null,
			end_line: (r.end_line as number) ?? null,
			end_col: (r.end_col as number) ?? null,
			signature: (r.signature as string) ?? null,
			doc_comment: (r.doc_comment as string) ?? null,
			parent_symbol_id: (r.parent_symbol_id as string) ?? null,
			created_at: r.created_at as string,
			updated_at: r.updated_at as string
		};
	}
}
