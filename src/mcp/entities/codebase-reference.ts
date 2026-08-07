import { BaseEntity } from "../storage/base";
import { CodebaseReference, CodebaseReferenceInsert, CodebaseReferenceRow } from "../types";
import { randomUUID } from "crypto";

/**
 * CodebaseReferenceEntity — persistence for call-site edge rows
 * (migration v21, issue #64 / TASK-236).
 *
 * Mirrors the CodebaseSymbolEntity persistence pattern: bulk upsert (insert →
 * replace-by-file is the caller's job), delete-by-file (the indexing writer
 * deletes a re-parsed file's refs then bulk-inserts the fresh set inside the
 * same batch transaction), and read-by-symbol for traceSymbol.
 *
 * The table is keyed by `caller_file` (the file HOLDING the call site), not
 * `file_path`, so all delete/transfer helpers operate on `caller_file`.
 */
export class CodebaseReferenceEntity extends BaseEntity {
	bulkUpsertReferences(repo: string, refs: CodebaseReferenceInsert[]): number {
		return this.transaction(() => {
			const now = new Date().toISOString();
			const stmt = this.db.prepare(`
				INSERT INTO codebase_references (
					id, repo, symbol_name, caller_file, caller_line, caller_name, kind, created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`);

			let count = 0;
			for (const r of refs) {
				stmt.run(
					randomUUID(),
					r.repo,
					r.symbol_name,
					r.caller_file,
					r.caller_line ?? null,
					r.caller_name ?? null,
					r.kind,
					now
				);
				count++;
			}
			return count;
		});
	}

	getReferencesByFile(repo: string, filePath: string): CodebaseReference[] {
		return this.all<CodebaseReferenceRow>(
			"SELECT * FROM codebase_references WHERE repo = ? AND caller_file = ? ORDER BY caller_line ASC, symbol_name ASC",
			[repo, filePath]
		).map((r) => this.rowToReference(r));
	}

	/** All call sites for a symbol within a repo (serves traceSymbol). */
	getReferencesBySymbol(repo: string, symbolName: string): CodebaseReference[] {
		return this.all<CodebaseReferenceRow>(
			"SELECT * FROM codebase_references WHERE repo = ? AND symbol_name = ? ORDER BY caller_file ASC, caller_line ASC",
			[repo, symbolName]
		).map((r) => this.rowToReference(r));
	}

	deleteReferencesByFile(repo: string, filePath: string): number {
		const result = this.run("DELETE FROM codebase_references WHERE repo = ? AND caller_file = ?", [repo, filePath]);
		return result.changes;
	}

	transferReferencesFilePath(repo: string, oldPath: string, newPath: string): number {
		const result = this.run(
			`UPDATE codebase_references SET caller_file = ?
			 WHERE repo = ? AND caller_file = ?`,
			[newPath, repo, oldPath]
		);
		return result.changes;
	}

	deleteReferencesByRepo(repo: string): number {
		const result = this.run("DELETE FROM codebase_references WHERE repo = ?", [repo]);
		return result.changes;
	}

	private rowToReference(row: CodebaseReferenceRow): CodebaseReference {
		return {
			id: row.id,
			repo: row.repo,
			symbol_name: row.symbol_name,
			caller_file: row.caller_file,
			caller_line: row.caller_line,
			caller_name: row.caller_name,
			kind: row.kind,
			created_at: row.created_at
		};
	}
}
