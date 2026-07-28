/**
 * indexing-writer — DB write operations for indexing results.
 *
 * Extracted from indexing-repository.ts STORE + CLEAN sections.
 * Handles batch upsert of files/symbols, rename transfers, and stale cleanup.
 */

import type { SQLiteStore } from "../../storage/sqlite.js";
import type { CodebaseFileInsert } from "../../types/codebase-file.js";
import type { CodebaseSymbolInsert } from "../../types/codebase-symbol.js";
import { logger } from "../../utils/logger.js";
import { retryDbWrite } from "./indexing-cache.js";

// ── Local type aliases (avoid circular dep with indexing-repository) ────

export interface IndexProgress {
	stage: "discovering" | "parsing" | "storing" | "cleaning";
	current: number;
	total: number;
	message: string;
}

export interface IndexFileError {
	filePath: string;
	error: string;
}

// ── Writer result ────────────────────────────────────────────────────────

export interface WriteResult {
	errors: IndexFileError[];
	totalSymbols: number;
	dbWriteErrors: number;
}

// ── Write context ────────────────────────────────────────────────────────

export interface WriteContext {
	db: SQLiteStore;
	repo: string;
	fileInserts: CodebaseFileInsert[];
	symbolInserts: CodebaseSymbolInsert[];
	renameMap: Map<string, string>;
	stalePaths: Set<string>;
	batchSize: number;
	options: { onProgress?: (progress: IndexProgress) => void };
}

// ── Helper ───────────────────────────────────────────────────────────────

function emitProgress(options: { onProgress?: (progress: IndexProgress) => void }, progress: IndexProgress): void {
	if (options.onProgress) {
		try {
			options.onProgress(progress);
		} catch {
			// Progress callback must never kill the indexing pipeline
		}
	}
}

// ── Write index results ──────────────────────────────────────────────────

/**
 * Persist indexing results to the database.
 *
 * Steps:
 * 1. Handle renames (transfer file + symbol records)
 * 2. Upsert file records in batches
 * 3. Delete old symbols, bulk insert new symbols
 * 4. Clean stale file records
 */
export async function writeIndexResults(ctx: WriteContext): Promise<WriteResult> {
	const { db, repo, fileInserts, symbolInserts, renameMap, stalePaths, batchSize, options } = ctx;
	let dbWriteErrors = 0;

	// ── 1. Handle renames — transfer file records and symbols ─
	if (renameMap.size > 0) {
		await retryDbWrite(async () => {
			await db.withWrite(async () => {
				for (const [newPath, oldPath] of renameMap) {
					db.codebaseFiles.transferFile(repo, oldPath, newPath);
					db.codebaseSymbols.transferSymbolsFilePath(repo, oldPath, newPath);
				}
			});
		}, "rename-transfer");
	}

	// ── 2. Upsert files in batches within transaction ─
	{
		let storeOffset = 0;
		let storedCount = 0;

		while (storeOffset < fileInserts.length) {
			const batch = fileInserts.slice(storeOffset, storeOffset + batchSize);
			try {
				await retryDbWrite(async () => {
					await db.withWrite(async () => {
						for (const fi of batch) {
							db.codebaseFiles.upsertFile(fi);
						}
					});
				}, `file-insert-batch-${storeOffset}`);
			} catch (err) {
				dbWriteErrors++;
				logger.error("[IndexingWriter] File batch insert failed", {
					batchOffset: storeOffset,
					error: String(err)
				});
			}
			storedCount += batch.length;
			emitProgress(options, {
				stage: "storing",
				current: storedCount,
				total: fileInserts.length + renameMap.size + symbolInserts.length,
				message: `Stored ${storedCount}/${fileInserts.length} files...`
			});
			storeOffset += batchSize;
		}
	}

	// ── 3. Delete old symbols for re-parsed files, then insert new symbols ─
	{
		// Collect file paths that were actually parsed
		const reindexedPaths = new Set<string>();
		for (const fi of fileInserts) {
			if (!renameMap.has(fi.file_path)) {
				reindexedPaths.add(fi.file_path);
			}
		}

		try {
			await retryDbWrite(async () => {
				await db.withWrite(async () => {
					for (const fp of reindexedPaths) {
						db.codebaseSymbols.deleteSymbolsByFile(repo, fp);
					}
				});
			}, "symbol-delete");
		} catch (err) {
			dbWriteErrors++;
			logger.error("[IndexingWriter] Symbol delete batch failed", {
				error: String(err)
			});
		}

		// Bulk insert symbols in batches
		if (symbolInserts.length > 0) {
			let symOffset = 0;
			while (symOffset < symbolInserts.length) {
				const symBatch = symbolInserts.slice(symOffset, symOffset + batchSize);
				try {
					await retryDbWrite(async () => {
						await db.withWrite(async () => {
							db.codebaseSymbols.bulkUpsertSymbols(symBatch);
						});
					}, `symbol-insert-batch-${symOffset}`);
				} catch (err) {
					dbWriteErrors++;
					logger.error("[IndexingWriter] Symbol insert batch failed", {
						batchOffset: symOffset,
						error: String(err)
					});
				}
				symOffset += batchSize;
			}
		}
	}

	emitProgress(options, {
		stage: "storing",
		current: fileInserts.length + renameMap.size + symbolInserts.length,
		total: fileInserts.length + renameMap.size + symbolInserts.length,
		message: `Stored ${symbolInserts.length} symbols across batches.`
	});

	// ── 4. CLEAN — delete records for files no longer on disk ─
	if (stalePaths.size > 0) {
		emitProgress(options, {
			stage: "cleaning",
			current: 0,
			total: stalePaths.size,
			message: `Cleaning ${stalePaths.size} stale files...`
		});

		try {
			await retryDbWrite(async () => {
				await db.withWrite(async () => {
					let cleanedCount = 0;
					for (const fp of stalePaths) {
						db.codebaseSymbols.deleteSymbolsByFile(repo, fp);
						db.codebaseFiles.deleteFile(repo, fp);
						cleanedCount++;
						emitProgress(options, {
							stage: "cleaning",
							current: cleanedCount,
							total: stalePaths.size,
							message: `Cleaned ${cleanedCount}/${stalePaths.size}: ${fp}`
						});
					}
				});
			}, "stale-cleanup");
		} catch (err) {
			dbWriteErrors++;
			logger.error("[IndexingWriter] Stale cleanup failed", {
				error: String(err)
			});
		}
	}

	return {
		errors: [],
		totalSymbols: symbolInserts.length,
		dbWriteErrors
	};
}
