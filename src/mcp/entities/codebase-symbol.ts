import { BaseEntity } from "../storage/base";
import {
	CodebaseSymbol,
	CodebaseSymbolRow,
	CodebaseSymbolInsert,
	CodebaseSymbolVector,
	SymbolCountGroupRow,
	SymbolSearchQuery,
	SymbolSearchResult
} from "../types";
import { randomUUID } from "crypto";
import { sanitizeFtsTerm } from "../utils/fts";
import { VECTOR_CANDIDATE_CAP } from "../utils/constants";

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
		return this.all<CodebaseSymbolRow>(
			"SELECT * FROM codebase_symbols WHERE repo = ? AND file_path = ? ORDER BY start_line ASC",
			[repo, filePath]
		).map((r) => this.rowToSymbol(r));
	}

	getSymbolByName(repo: string, name: string): CodebaseSymbol[] {
		return this.all<CodebaseSymbolRow>(
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

	transferSymbolsFilePath(repo: string, oldPath: string, newPath: string): number {
		const now = new Date().toISOString();
		const result = this.run(
			`UPDATE codebase_symbols SET file_path = ?, updated_at = ?
			 WHERE repo = ? AND file_path = ?`,
			[newPath, now, repo, oldPath]
		);
		return result.changes;
	}

	getSymbolsByRepo(repo: string, limit?: number): CodebaseSymbol[] {
		let sql = "SELECT * FROM codebase_symbols WHERE repo = ? ORDER BY file_path ASC, start_line ASC";
		const params: (string | number)[] = [repo];
		if (limit !== undefined) {
			sql += " LIMIT ?";
			params.push(limit);
		}
		return this.all<CodebaseSymbolRow>(sql, params).map((r) => this.rowToSymbol(r));
	}

	getSymbolCountByRepo(repo: string): number {
		const row = this.get<{ count: number }>("SELECT COUNT(*) as count FROM codebase_symbols WHERE repo = ?", [repo]);
		return row?.count ?? 0;
	}

	/**
	 * Symbol-kind counts per file for a repo, aggregated in SQL via
	 * `GROUP BY file_path, kind` (OPT-PERF-08). Used by ARCHITECTURE reads so
	 * per-file/per-directory symbol counts are derived from O(distinct
	 * file×kind pairs) rows instead of hydrating every symbol row.
	 */
	getSymbolCountsByRepoGrouped(repo: string): SymbolCountGroupRow[] {
		return this.all<SymbolCountGroupRow>(
			`SELECT file_path, kind, COUNT(*) as count
			 FROM codebase_symbols
			 WHERE repo = ?
			 GROUP BY file_path, kind
			 ORDER BY file_path ASC, kind ASC`,
			[repo]
		);
	}

	/**
	 * Top-level exports for a repo (exported symbols with no parent), bounded
	 * by `limit` (OPT-PERF-08). Used by ARCHITECTURE reads instead of
	 * filtering the full symbol set in memory; the row count never exceeds
	 * `limit`, so the payload is constant regardless of repo symbol count.
	 */
	getTopLevelExportsByRepo(repo: string, limit: number): CodebaseSymbol[] {
		return this.all<CodebaseSymbolRow>(
			`SELECT * FROM codebase_symbols
			 WHERE repo = ? AND exported = 1 AND parent_symbol_id IS NULL
			 ORDER BY file_path ASC, start_line ASC
			 LIMIT ?`,
			[repo, limit]
		).map((r) => this.rowToSymbol(r));
	}

	getAllSymbols(limit?: number): CodebaseSymbol[] {
		let sql = "SELECT * FROM codebase_symbols ORDER BY repo ASC, file_path ASC, start_line ASC";
		const params: (string | number)[] = [];
		if (limit !== undefined) {
			sql += " LIMIT ?";
			params.push(limit);
		}
		return this.all<CodebaseSymbolRow>(sql, params).map((r) => this.rowToSymbol(r));
	}

	deleteSymbolsByRepo(repo: string): number {
		const result = this.run("DELETE FROM codebase_symbols WHERE repo = ?", [repo]);
		return result.changes;
	}

	upsertSymbolVector(symbolId: string, vector: number[]): void {
		this.run(
			`INSERT OR REPLACE INTO codebase_symbol_vectors (symbol_id, vector, updated_at)
			 VALUES (?, ?, datetime('now'))`,
			[symbolId, JSON.stringify(vector)]
		);
	}

	getSymbolVectorsByRepo(repo: string, limit: number = VECTOR_CANDIDATE_CAP): CodebaseSymbolVector[] {
		return this.all<CodebaseSymbolVector>(
			`SELECT csv.* FROM codebase_symbol_vectors csv
			 JOIN codebase_symbols cs ON cs.id = csv.symbol_id
			 WHERE cs.repo = ?
			 ORDER BY csv.updated_at DESC
			 LIMIT ?`,
			[repo, limit]
		);
	}

	deleteSymbolVectorsByFile(repo: string, filePath: string): number {
		const result = this.run(
			`DELETE FROM codebase_symbol_vectors WHERE symbol_id IN (
				SELECT id FROM codebase_symbols WHERE repo = ? AND file_path = ?
			)`,
			[repo, filePath]
		);
		return result.changes;
	}

	private tryFtsSearch(query: SymbolSearchQuery, limit: number, offset: number): SymbolSearchResult | null {
		try {
			// The full query is sanitized here (FTS5 metacharacters stripped, no
			// wildcards). The v18 FTS5 index covers name, doc_comment AND
			// signature, so a MATCH on the whole table row is enough — no
			// per-column MATCH needed. Signature tokens are therefore sanitized
			// through the same sanitizeFtsTerm() path as name/doc_comment.
			const safeTerm = sanitizeFtsTerm(query.query);
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

			const symbols = this.all<CodebaseSymbolRow>(parts[0], params).map((r) => this.rowToSymbol(r));

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
		// signature is included for parity with the FTS5 tier (v18): a symbol
		// findable by its signature token via FTS stays findable via the LIKE
		// fallback (e.g. when sanitizeFtsTerm produces an empty MATCH term).
		const conditions: string[] = [
			"(cs.name LIKE ? OR cs.doc_comment LIKE ? OR cs.file_path LIKE ? OR cs.signature LIKE ?)"
		];
		const params: unknown[] = [likeTerm, likeTerm, likeTerm, likeTerm];

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

		const symbols = this.all<CodebaseSymbolRow>(
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
}
