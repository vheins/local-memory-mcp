/**
 * indexing-writer — DB write operations for indexing results.
 *
 * Extracted from indexing-repository.ts STORE + CLEAN sections.
 * Handles batch upsert of files/symbols, rename transfers, and stale cleanup.
 */

import type { SQLiteStore } from "../../storage/sqlite";
import type { CodebaseFileInsert, CodebaseSymbolInsert } from "../../types";
import { logger } from "../../utils/logger";
import { retryDbWrite } from "./indexing-cache";

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

/**
 * Base writer context shared by the incremental write steps.
 *
 * The repository now flushes fileInserts/symbolInserts per parse batch
 * (bounded memory — Fix #3) instead of accumulating the whole repo, so the
 * aggregate `writeIndexResults` was split into composable steps:
 *
 *   1. `applyRenames`   — transfer file + symbol records for detected renames
 *   2. `writeParseBatch` — upsert files + replace symbols for ONE parse batch
 *   3. `cleanStaleFiles` — delete records for files no longer on disk
 */
export interface WriteBaseContext {
	db: SQLiteStore;
	repo: string;
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

// ── Incremental write steps ─────────────────────────────────────────────

/**
 * Step 1 — transfer renamed file + symbol records (old path → new path).
 *
 * Preserves the existing contract: rename transfer failures propagate to the
 * caller (the only uncovered throw path in the writer).
 *
 * @returns Number of DB write errors (always 0 — failures throw).
 */
export async function applyRenames(base: WriteBaseContext, renameMap: Map<string, string>): Promise<number> {
	const { db, repo } = base;

	if (renameMap.size === 0) return 0;

	await retryDbWrite(async () => {
		await db.withWrite(async () => {
			for (const [newPath, oldPath] of renameMap) {
				db.codebaseFiles.transferFile(repo, oldPath, newPath);
				db.codebaseSymbols.transferSymbolsFilePath(repo, oldPath, newPath);
			}
		});
	}, "rename-transfer");

	return 0;
}

/**
 * Steps 2 + 3 — persist ONE parse batch: upsert file records and replace the
 * symbols of the re-parsed files (delete old, bulk insert new).
 *
 * Called once per parse batch so the repository never accumulates inserts for
 * the whole repo in memory.
 *
 * @returns Number of DB write errors encountered (0 on success).
 */
export async function writeParseBatch(
	base: WriteBaseContext,
	fileInserts: CodebaseFileInsert[],
	symbolInserts: CodebaseSymbolInsert[],
	renameMap: Map<string, string>
): Promise<number> {
	const { db, repo, batchSize, options } = base;
	let dbWriteErrors = 0;

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
		// Collect file paths that were actually parsed in this batch.
		// Renamed paths never reach here (they are skipped at decision time),
		// but the exclusion is kept defensively — their symbols were
		// transferred, not replaced.
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

	return dbWriteErrors;
}

/**
 * Step 4 — clean records for files no longer on disk.
 *
 * @returns Number of DB write errors encountered (0 on success).
 */
export async function cleanStaleFiles(base: WriteBaseContext, stalePaths: Set<string>): Promise<number> {
	const { db, repo, options } = base;
	let dbWriteErrors = 0;

	if (stalePaths.size === 0) return 0;

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

	return dbWriteErrors;
}

// ── Aggregate writer (backward-compatible composition) ──────────────────

/**
 * Persist indexing results to the database.
 *
 * Composition of the incremental steps (kept for backward compatibility):
 *   1. Handle renames (transfer file + symbol records)
 *   2. Upsert file records in batches
 *   3. Delete old symbols, bulk insert new symbols
 *   4. Clean stale file records
 */
export async function writeIndexResults(ctx: WriteContext): Promise<WriteResult> {
	const { db, repo, fileInserts, symbolInserts, renameMap, stalePaths, batchSize, options } = ctx;
	const base: WriteBaseContext = { db, repo, batchSize, options };

	let dbWriteErrors = 0;
	dbWriteErrors += await applyRenames(base, renameMap);
	dbWriteErrors += await writeParseBatch(base, fileInserts, symbolInserts, renameMap);
	dbWriteErrors += await cleanStaleFiles(base, stalePaths);

	return {
		errors: [],
		totalSymbols: symbolInserts.length,
		dbWriteErrors
	};
}
