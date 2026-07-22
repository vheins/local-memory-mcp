import { BaseEntity } from "../storage/base";
import { CodebaseFile, CodebaseFileInsert } from "../types/codebase-file";
import { randomUUID } from "crypto";

export class CodebaseFileEntity extends BaseEntity {
	upsertFile(file: CodebaseFileInsert): CodebaseFile {
		const now = new Date().toISOString();
		const id = randomUUID();

		const existing = this.get<CodebaseFile>(
			"SELECT id, created_at FROM codebase_files WHERE repo = ? AND file_path = ?",
			[file.repo, file.file_path]
		);

		if (existing) {
			this.run(
				`UPDATE codebase_files SET
					language = ?, checksum = ?, lines = ?, size_bytes = ?,
					last_indexed_at = ?, updated_at = ?
				WHERE repo = ? AND file_path = ?`,
				[
					file.language ?? null,
					file.checksum ?? null,
					file.lines ?? 0,
					file.size_bytes ?? 0,
					now,
					now,
					file.repo,
					file.file_path
				]
			);
			return this.getFile(file.repo, file.file_path)!;
		}

		this.run(
			`INSERT INTO codebase_files (id, repo, file_path, language, checksum, lines, size_bytes, last_indexed_at, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				file.repo,
				file.file_path,
				file.language ?? null,
				file.checksum ?? null,
				file.lines ?? 0,
				file.size_bytes ?? 0,
				now,
				now,
				now
			]
		);

		return {
			id,
			repo: file.repo,
			file_path: file.file_path,
			language: file.language ?? null,
			checksum: file.checksum ?? null,
			lines: file.lines ?? 0,
			size_bytes: file.size_bytes ?? 0,
			last_indexed_at: now,
			created_at: now,
			updated_at: now
		};
	}

	getFile(repo: string, filePath: string): CodebaseFile | undefined {
		return this.get<CodebaseFile>("SELECT * FROM codebase_files WHERE repo = ? AND file_path = ?", [repo, filePath]);
	}

	getFilesByRepo(repo: string): CodebaseFile[] {
		return this.all<CodebaseFile>("SELECT * FROM codebase_files WHERE repo = ? ORDER BY file_path ASC", [repo]);
	}

	getFileCountByRepo(repo: string): number {
		const row = this.get<{ count: number }>("SELECT COUNT(*) as count FROM codebase_files WHERE repo = ?", [repo]);
		return row?.count ?? 0;
	}

	getFilesByStatus(repo: string, status: string): CodebaseFile[] {
		if (status === "indexed") {
			return this.all<CodebaseFile>(
				"SELECT * FROM codebase_files WHERE repo = ? AND last_indexed_at IS NOT NULL ORDER BY file_path ASC",
				[repo]
			);
		}
		if (status === "pending") {
			return this.all<CodebaseFile>(
				"SELECT * FROM codebase_files WHERE repo = ? AND last_indexed_at IS NULL ORDER BY file_path ASC",
				[repo]
			);
		}
		return this.getFilesByRepo(repo);
	}

	deleteFile(repo: string, filePath: string): boolean {
		const result = this.run("DELETE FROM codebase_files WHERE repo = ? AND file_path = ?", [repo, filePath]);
		return result.changes > 0;
	}

	deleteFilesByRepo(repo: string): number {
		const result = this.run("DELETE FROM codebase_files WHERE repo = ?", [repo]);
		return result.changes;
	}
}
