/**
 * CodebaseIndexService — orchestrates the full indexing pipeline:
 *   discover → compare → parse → store → clean → report.
 *
 * Thread safety: maintains an in-memory Set of repos currently being
 * indexed; concurrent calls for the same repo throw IndexInProgressError.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { discoverFiles } from "./file-discovery.js";
import type { ParserPool } from "../parser/index.js";
import type { ParseResult } from "../parser/language-visitor.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { CodebaseFileInsert } from "../../types/codebase-file.js";
import type { CodebaseSymbolInsert } from "../../types/codebase-symbol.js";
import type { DiscoveredFile } from "../types/index.js";
import { logger } from "../../utils/logger.js";
import { RecoverableError, FatalError } from "../types/errors.js";
import type { ErrorSummary } from "../types/errors.js";

// ── Error types ───────────────────────────────────────────────────────

/** Thrown when attempting to index a repo that is already being indexed. */
export class IndexInProgressError extends Error {
	constructor(repo: string) {
		super(`Index already in progress for repo: ${repo}. Concurrent indexing is not supported.`);
		this.name = "IndexInProgressError";
	}
}

// ── Public interfaces ─────────────────────────────────────────────────

export interface CodebaseIndexService {
	indexRepository(repo: string, repoPath: string, options?: IndexOptions): Promise<IndexResult>;
	checkStaleness(repo: string, repoPath: string): Promise<StalenessResult>;
	getIndexStatus(repo: string, repoPath?: string): Promise<IndexStatus>;
}

export interface IndexOptions {
	/** If true, re-parse all files regardless of checksum match (default: false). */
	force?: boolean;
	/** Include-only glob patterns passed to FileDiscovery. */
	includeGlobs?: string[];
	/** Extra exclude glob patterns passed to FileDiscovery. */
	excludeGlobs?: string[];
	/** Number of files to process per transaction batch (default: 50). */
	batchSize?: number;
	/** Maximum number of files to index (passes through to FileDiscovery). */
	maxFiles?: number;
	/** Progress callback emitted at each stage. */
	onProgress?: (progress: IndexProgress) => void;
}

export interface IndexProgress {
	stage: "discovering" | "parsing" | "storing" | "cleaning";
	current: number;
	total: number;
	message: string;
}

export interface IndexResult {
	success: boolean;
	totalFiles: number;
	parsedFiles: number;
	skippedFiles: number;
	failedFiles: number;
	totalSymbols: number;
	durationMs: number;
	errors: IndexFileError[];
	/** Breakdown of skip reasons for the summary. */
	skippedByChecksum: number;
	skippedByExtension: number;
	skippedByGitignore: number;
	/** Number of files detected as renames (old path → new path, same content). */
	renamedFiles: number;
	/** Structured error classification summary. */
	errorSummary: ErrorSummary;
}

export interface IndexFileError {
	filePath: string;
	error: string;
}

export interface StalenessResult {
	stale: boolean;
	staleFiles: number;
	totalFiles: number;
	staleRatio: number;
	lastIndexedAt: string | null;
}

export interface IndexStatus {
	repo: string;
	isIndexed: boolean;
	isIndexing: boolean;
	lastIndexedAt: string | null;
	totalFiles: number;
	totalSymbols: number;
	progress: IndexProgress | null;
	/** Whether the index has become stale (>= 5% of files changed since last index). Only set when repoPath is provided. */
	stale?: boolean;
	/** Ratio of stale files to total indexed files (0-1). Only set when repoPath is provided. */
	staleRatio?: number;
}

// ── SHA-256 helpers ───────────────────────────────────────────────────

function computeChecksum(content: string): string {
	return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

/** Count lines in a string (LF-normalized, non-empty final line counts). */
function countLines(content: string): number {
	if (!content) return 0;
	return content.split("\n").length;
}

// ── Error classification helpers ───────────────────────────────────────

/**
 * Detect permission-denied errors from Node.js `ErrnoException` codes
 * or message patterns. Matches EACCES, EPERM, and their Windows equivalents.
 */
function isPermissionError(err: unknown): boolean {
	if (typeof err === "object" && err !== null && "code" in err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "EACCES" || code === "EPERM") return true;
	}
	const message = err instanceof Error ? err.message : String(err);
	return /permission denied|access denied|EACCES|EPERM/i.test(message);
}

/**
 * Detect parser timeout errors. Tree-sitter timeouts are raised via
 * Promise.race in ParserPool with a "Parse timeout after" message.
 */
function isTimeoutError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /timeout/i.test(message);
}

/**
 * Retry a database write operation once if it fails.
 * Catches the error, logs it, retries after a brief wait, and rethrows
 * if the retry also fails.
 */
async function retryDbWrite<T>(fn: () => Promise<T>, context: string): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.warn("[IndexingService] DB write failed — retrying once", { context, error: message });
		await new Promise((resolve) => setTimeout(resolve, 100));
		try {
			return await fn();
		} catch (retryErr) {
			const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
			logger.error("[IndexingService] DB write retry failed", { context, error: retryMessage });
			throw retryErr;
		}
	}
}

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_BATCH_SIZE = 100;

// ── Private type for file categorization ──────────────────────────────

type FilePlan =
	| { action: "skip"; filePath: string }
	| { action: "parse"; filePath: string; absolutePath: string; language: string; sizeBytes: number };

// ── Module-level auto-index tracking ─────────────────────────────────

/** Tracks repos currently being auto-indexed to prevent duplicate triggers. */
const autoIndexingRepos = new Set<string>();

// ── AutoIndexOptions ──────────────────────────────────────────────────

export interface AutoIndexOptions {
	/** Custom TTL in ms. Overrides CODEBASE_AUTO_INDEX_TTL env var. */
	ttlMs?: number;
}

export interface AutoIndexResult {
	status: "started" | "skipped" | "already_indexing";
	reason?: string;
}

// ── Factory ───────────────────────────────────────────────────────────

export function createCodebaseIndexService(db: SQLiteStore, parserPool: ParserPool): CodebaseIndexService {
	return new CodebaseIndexServiceImpl(db, parserPool);
}

// ── Standalone auto-index ─────────────────────────────────────────────

/**
 * Trigger indexing for a repository if the index has never been built or
 * has become stale beyond a configurable TTL.
 *
 * Env vars:
 *   CODEBASE_AUTO_INDEX — set to 'false' to disable auto-indexing
 *   CODEBASE_AUTO_INDEX_TTL — override default 24h TTL in milliseconds
 *
 * @returns 'started' when indexing was triggered, 'skipped' when index is fresh
 *   or auto-index is disabled, 'already_indexing' when indexing is in-flight.
 */
export async function autoIndexIfStale(
	repo: string,
	repoPath: string,
	db: SQLiteStore,
	parserPool: ParserPool,
	options?: AutoIndexOptions
): Promise<AutoIndexResult> {
	// ── Respect CODEBASE_AUTO_INDEX env var ──────────────────────────
	if (process.env.CODEBASE_AUTO_INDEX === "false") {
		return { status: "skipped", reason: "Auto-index disabled via CODEBASE_AUTO_INDEX env var" };
	}

	// ── Thread-safety: prevent duplicate triggers ────────────────────
	if (autoIndexingRepos.has(repo)) {
		return { status: "already_indexing", reason: `Auto-index already in progress for repo: ${repo}` };
	}

	// ── Compute TTL ──────────────────────────────────────────────────
	const defaultTtlMs = 24 * 60 * 60 * 1000; // 24 hours
	const envTtl = process.env.CODEBASE_AUTO_INDEX_TTL ? parseInt(process.env.CODEBASE_AUTO_INDEX_TTL, 10) : undefined;
	const ttlMs = options?.ttlMs ?? (envTtl && !isNaN(envTtl) ? envTtl : defaultTtlMs);

	// ── Check last_indexed_at from codebase_files ────────────────────
	const existingFiles = db.codebaseFiles.getFilesByRepo(repo);
	const hasIndex = existingFiles.length > 0;

	if (hasIndex) {
		// Find the most recent last_indexed_at across all files
		let maxIndexedAt: Date | null = null;
		for (const f of existingFiles) {
			const t = f.last_indexed_at ? new Date(f.last_indexed_at) : null;
			if (t && (!maxIndexedAt || t > maxIndexedAt)) {
				maxIndexedAt = t;
			}
		}

		if (maxIndexedAt) {
			const elapsed = Date.now() - maxIndexedAt.getTime();
			if (elapsed < ttlMs) {
				const remainingMs = ttlMs - elapsed;
				const remainingHrs = Math.round(remainingMs / 3600000);
				return {
					status: "skipped",
					reason: `Index is fresh (last indexed ${remainingHrs}h ago, TTL: ${Math.round(ttlMs / 3600000)}h)`
				};
			}
		}
	}

	// ── Trigger background indexing ──────────────────────────────────
	autoIndexingRepos.add(repo);

	// Fire and forget — don't await the full index (it may take minutes).
	// Errors are logged; the dashboard polls /api/codebase/index-status.
	const service = createCodebaseIndexService(db, parserPool);
	void service.indexRepository(repo, repoPath).finally(() => {
		autoIndexingRepos.delete(repo);
	});

	return {
		status: "started",
		reason: hasIndex ? "Index TTL expired — re-indexing" : "No existing index — building fresh"
	};
}

// ── Implementation ────────────────────────────────────────────────────

class CodebaseIndexServiceImpl implements CodebaseIndexService {
	private db: SQLiteStore;
	private parserPool: ParserPool;
	private indexingRepos = new Set<string>();

	constructor(db: SQLiteStore, parserPool: ParserPool) {
		this.db = db;
		this.parserPool = parserPool;
	}

	// ── Public API ─────────────────────────────────────────────────

	async indexRepository(repo: string, repoPath: string, options: IndexOptions = {}): Promise<IndexResult> {
		const startTime = performance.now();
		const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
		const errors: IndexFileError[] = [];
		let totalFiles: number;
		let parsedFiles = 0;
		let skippedFiles = 0;
		let failedFiles = 0;
		let totalSymbols = 0;

		// Skip-reason counters
		let skippedByChecksum = 0;

		// Error classification counters
		let timeoutErrors = 0;
		let permissionErrors = 0;
		let dbWriteErrors = 0;

		// Rename tracking
		let renamedFiles = 0;

		// ── Thread safety check ──────────────────────────────────
		if (this.indexingRepos.has(repo)) {
			throw new IndexInProgressError(repo);
		}
		this.indexingRepos.add(repo);

		try {
			// ═══════════════════════════════════════════════════════
			// 1. DISCOVER
			// ═══════════════════════════════════════════════════════
			this.emitProgress(options, {
				stage: "discovering",
				current: 0,
				total: 0,
				message: `Discovering files in ${repoPath}...`
			});

			const resolvedPath = path.resolve(repoPath);
			const discoverResult = await discoverFiles({
				projectPath: resolvedPath,
				includeGlobs: options.includeGlobs,
				excludeGlobs: options.excludeGlobs,
				maxFiles: options.maxFiles
			});

			const discoveredFiles = discoverResult.files;
			logger.info("[IndexingService] Discovery complete", {
				repo,
				filesFound: discoveredFiles.length,
				skippedByExt: discoverResult.skippedByExtension,
				skippedByGitignore: discoverResult.skippedByGitignore
			});

			// ═══════════════════════════════════════════════════════
			// 2. COMPARE — categorize each file: skip, parse, or rename
			// ═══════════════════════════════════════════════════════
			const fileMap = new Map<string, DiscoveredFile>();
			const existingFiles = this.db.codebaseFiles.getFilesByRepo(repo);
			const existingMap = new Map<string, { checksum: string | null }>();
			for (const f of existingFiles) {
				existingMap.set(f.file_path, { checksum: f.checksum });
			}

			// Build a map for rename detection: checksum → list of old file paths
			const checksumToOldPaths = new Map<string, string[]>();
			for (const f of existingFiles) {
				if (f.checksum) {
					const bucket = checksumToOldPaths.get(f.checksum) ?? [];
					bucket.push(f.file_path);
					checksumToOldPaths.set(f.checksum, bucket);
				}
			}

			const plans: FilePlan[] = [];
			const discoveredPaths = new Set<string>();
			const renameMap = new Map<string, string>(); // new path → old path

			for (const df of discoveredFiles) {
				discoveredPaths.add(df.path);
				fileMap.set(df.path, df);

				if (options.force) {
					plans.push({ action: "parse", ...df, filePath: df.path });
					continue;
				}

				const existing = existingMap.get(df.path);
				if (!existing) {
					// New file — could be genuinely new or a rename; detect later
					plans.push({ action: "parse", ...df, filePath: df.path });
				} else {
					// Exists in DB — compare checksum below at parse time
					plans.push({ action: "parse", ...df, filePath: df.path });
				}
			}

			totalFiles = discoveredFiles.length;

			// Compute set of stale file paths (deleted from disk)
			const stalePaths = new Set<string>();
			for (const existing of existingFiles) {
				if (!discoveredPaths.has(existing.file_path)) {
					stalePaths.add(existing.file_path);
				}
			}
			const staleCount = stalePaths.size;

			this.emitProgress(options, {
				stage: "discovering",
				current: totalFiles,
				total: totalFiles,
				message: `Discovered ${totalFiles} files (${plans.length} to process, ${staleCount} stale).`
			});

			// ═══════════════════════════════════════════════════════
			// 3. PARSE — two-phase: concurrent read+parse, sequential mutation
			// ═══════════════════════════════════════════════════════
			const parseTasks = plans.filter((p): p is Extract<FilePlan, { action: "parse" }> => p.action === "parse");

			this.emitProgress(options, {
				stage: "parsing",
				current: 0,
				total: parseTasks.length,
				message: `Parsing ${parseTasks.length} files concurrently...`
			});

			// Collect inserts for batching
			const fileInserts: CodebaseFileInsert[] = [];
			const symbolInserts: CodebaseSymbolInsert[] = [];
			let processedSoFar = 0;

			// Phase 1 batch size: files read+parsed concurrently.
			// Phase 2 (checksum skip, rename detection, state mutation) runs
			// sequentially per batch to avoid data races on stalePaths / renameMap.
			const CONCURRENT_PARSE_BATCH = 20;

			for (let i = 0; i < parseTasks.length; i += CONCURRENT_PARSE_BATCH) {
				const batch = parseTasks.slice(i, i + CONCURRENT_PARSE_BATCH);

				// ── Phase 1: concurrent immutable reads ──
				const batchResults = await Promise.all(
					batch.map(async (plan) => {
						try {
							const content = fs.readFileSync(plan.absolutePath, "utf-8");
							const checksum = computeChecksum(content);
							const lineCount = countLines(content);
							const parseResult = await this.parserPool.parseFile(plan.filePath, content);
							return { plan, checksum, lineCount, parseResult, error: null as string | null };
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							return {
								plan,
								checksum: null as string | null,
								lineCount: 0,
								parseResult: null as ParseResult | null,
								error: message
							};
						}
					})
				);

				// ── Phase 2: sequential mutation (shared state) ──
				for (const { plan, checksum, lineCount, parseResult, error } of batchResults) {
					if (error) {
						failedFiles++;
						processedSoFar++;
						errors.push({ filePath: plan.filePath, error });
						if (isPermissionError(new Error(error))) {
							permissionErrors++;
						} else if (isTimeoutError(new Error(error))) {
							timeoutErrors++;
						}
						continue;
					}

					const existing = existingMap.get(plan.filePath);
					const isNewFile = !existing;

					// ── Checksum skip: unchanged ─────────────────
					if (!options.force && existing && existing.checksum === checksum) {
						skippedFiles++;
						skippedByChecksum++;
						processedSoFar++;
						continue;
					}

					// ── Rename detection ──────────────────────────
					if (isNewFile && checksum && checksumToOldPaths.has(checksum)) {
						const candidateOldPaths = checksumToOldPaths.get(checksum)!;
						const matchingStalePaths = candidateOldPaths.filter((oldPath) => stalePaths.has(oldPath));
						if (matchingStalePaths.length > 0) {
							const oldPath = matchingStalePaths[0];
							renameMap.set(plan.filePath, oldPath);
							renamedFiles++;
							skippedFiles++;
							skippedByChecksum++;
							stalePaths.delete(oldPath);
							const idx = candidateOldPaths.indexOf(oldPath);
							if (idx >= 0) candidateOldPaths.splice(idx, 1);
							logger.info("[IndexingService] Detected file rename", {
								repo,
								oldPath,
								newPath: plan.filePath,
								checksum: checksum.substring(0, 12)
							});
							processedSoFar++;
							continue;
						}
					}

					// ── Process parse result ─────────────────────
					if (parseResult!.error) {
						failedFiles++;
						errors.push({ filePath: plan.filePath, error: parseResult!.error });
						if (/timeout/i.test(parseResult!.error)) {
							timeoutErrors++;
							logger.warn("[IndexingService] Parse timeout — skipped", {
								repo,
								filePath: plan.filePath,
								error: parseResult!.error
							});
						} else {
							logger.warn("[IndexingService] Parse error", {
								repo,
								filePath: plan.filePath,
								error: parseResult!.error
							});
						}
					} else {
						parsedFiles++;
					}

					for (const sym of parseResult!.symbols) {
						symbolInserts.push({
							repo,
							file_path: plan.filePath,
							name: sym.name,
							kind: sym.kind,
							exported: sym.exported,
							default_export: sym.defaultExport,
							start_line: sym.startLine,
							start_col: sym.startCol,
							end_line: sym.endLine,
							end_col: sym.endCol,
							signature: sym.signature,
							doc_comment: sym.docComment,
							parent_symbol_id: null
						});
						totalSymbols++;
					}

					fileInserts.push({
						repo,
						file_path: plan.filePath,
						language: plan.language,
						checksum: checksum!,
						lines: lineCount,
						size_bytes: plan.sizeBytes
					});

					processedSoFar++;
				}

				this.emitProgress(options, {
					stage: "parsing",
					current: processedSoFar,
					total: parseTasks.length,
					message: `Parsed ${processedSoFar}/${parseTasks.length} files...`
				});
			}

			// ═══════════════════════════════════════════════════════
			// 4. STORE — upsert files and symbols in batched transactions
			// ═══════════════════════════════════════════════════════
			this.emitProgress(options, {
				stage: "storing",
				current: 0,
				total: fileInserts.length + renameMap.size + symbolInserts.length,
				message: `Storing ${fileInserts.length} files and ${symbolInserts.length} symbols across batches of ${batchSize}...`
			});

			// ── 4a. Handle renames: transfer file records and symbols ─
			if (renameMap.size > 0) {
				await retryDbWrite(async () => {
					await this.db.withWrite(async () => {
						for (const [newPath, oldPath] of renameMap) {
							this.db.codebaseFiles.transferFile(repo, oldPath, newPath);
							this.db.codebaseSymbols.transferSymbolsFilePath(repo, oldPath, newPath);
						}
					});
				}, "rename-transfer");
			}

			// ── 4b. Upsert files in batches within a transaction ─
			{
				let storeOffset = 0;
				let storedCount = 0;

				while (storeOffset < fileInserts.length) {
					const batch = fileInserts.slice(storeOffset, storeOffset + batchSize);
					await retryDbWrite(async () => {
						await this.db.withWrite(async () => {
							for (const fi of batch) {
								this.db.codebaseFiles.upsertFile(fi);
							}
						});
					}, `file-insert-batch-${storeOffset}`);
					storedCount += batch.length;
					this.emitProgress(options, {
						stage: "storing",
						current: storedCount,
						total: fileInserts.length + renameMap.size + symbolInserts.length,
						message: `Stored ${storedCount}/${fileInserts.length} files...`
					});
					storeOffset += batchSize;
				}
			}

			// ── 4c. Delete old symbols for re-parsed files, then insert new symbols ─
			{
				// Collect file paths that were actually parsed (not skipped by checksum,
				// not renames — those are handled above)
				const reindexedPaths = new Set<string>();
				for (const fi of fileInserts) {
					if (!renameMap.has(fi.file_path)) {
						reindexedPaths.add(fi.file_path);
					}
				}

				await retryDbWrite(async () => {
					await this.db.withWrite(async () => {
						for (const fp of reindexedPaths) {
							this.db.codebaseSymbols.deleteSymbolsByFile(repo, fp);
						}
					});
				}, "symbol-delete");

				// Bulk insert symbols in batches
				if (symbolInserts.length > 0) {
					let symOffset = 0;
					while (symOffset < symbolInserts.length) {
						const symBatch = symbolInserts.slice(symOffset, symOffset + batchSize);
						await retryDbWrite(async () => {
							await this.db.withWrite(async () => {
								this.db.codebaseSymbols.bulkUpsertSymbols(symBatch);
							});
						}, `symbol-insert-batch-${symOffset}`);
						symOffset += batchSize;
					}
				}
			}

			this.emitProgress(options, {
				stage: "storing",
				current: fileInserts.length + renameMap.size + symbolInserts.length,
				total: fileInserts.length + renameMap.size + symbolInserts.length,
				message: `Stored ${symbolInserts.length} symbols across batches.`
			});

			// ═══════════════════════════════════════════════════════
			// 5. CLEAN — delete records for files no longer on disk
			//    (Renamed files already removed from stalePaths above)
			// ═══════════════════════════════════════════════════════
			if (stalePaths.size > 0) {
				this.emitProgress(options, {
					stage: "cleaning",
					current: 0,
					total: stalePaths.size,
					message: `Cleaning ${stalePaths.size} stale files...`
				});

				let cleanedCount = 0;
				for (const fp of stalePaths) {
					this.db.codebaseSymbols.deleteSymbolsByFile(repo, fp);
					this.db.codebaseFiles.deleteFile(repo, fp);
					cleanedCount++;
					this.emitProgress(options, {
						stage: "cleaning",
						current: cleanedCount,
						total: stalePaths.size,
						message: `Cleaned ${cleanedCount}/${stalePaths.size}: ${fp}`
					});
				}
			}

			// ── Build final report ───────────────────────────────
			const durationMs = Math.round(performance.now() - startTime);

			logger.info("[IndexingService] Index complete", {
				repo,
				totalFiles,
				parsedFiles,
				skippedFiles,
				failedFiles,
				totalSymbols,
				renamedFiles,
				skippedByChecksum,
				durationMs
			});

			return {
				success: failedFiles === 0 && errors.length === 0,
				totalFiles,
				parsedFiles,
				skippedFiles,
				failedFiles,
				totalSymbols,
				durationMs,
				errors,
				skippedByChecksum,
				skippedByExtension: discoverResult.skippedByExtension,
				skippedByGitignore: discoverResult.skippedByGitignore,
				renamedFiles,
				errorSummary: {
					total: errors.length,
					recoverable: errors.length,
					fatal: 0,
					timeoutErrors,
					permissionErrors,
					dbWriteErrors
				}
			};
		} finally {
			this.indexingRepos.delete(repo);
		}
	}

	async checkStaleness(repo: string, repoPath: string): Promise<StalenessResult> {
		const existingFiles = this.db.codebaseFiles.getFilesByRepo(repo);
		const totalFiles = existingFiles.length;

		// Nothing indexed yet — no basis for staleness comparison
		if (totalFiles === 0) {
			return { stale: false, staleFiles: 0, totalFiles: 0, staleRatio: 0, lastIndexedAt: null };
		}

		const resolvedPath = path.resolve(repoPath);
		let staleCount = 0;
		let maxLastIndexedAt: Date | null = null;

		for (const f of existingFiles) {
			// Track max last_indexed_at across all files
			const fileTime = f.last_indexed_at ? new Date(f.last_indexed_at) : null;
			if (fileTime && (!maxLastIndexedAt || fileTime > maxLastIndexedAt)) {
				maxLastIndexedAt = fileTime;
			}

			const fullPath = path.join(resolvedPath, f.file_path);
			try {
				const stat = fs.statSync(fullPath);
				const indexedTime = fileTime ? fileTime.getTime() : 0;
				// File mtime newer than when it was last indexed → stale
				if (stat.mtimeMs > indexedTime) {
					staleCount++;
				}
			} catch {
				// File no longer exists on disk → stale
				staleCount++;
			}
		}

		const staleRatio = Math.round((staleCount / totalFiles) * 1000) / 1000;
		const lastIndexedAt = maxLastIndexedAt?.toISOString() ?? null;

		return {
			// Mark repo stale only if >= 5% of indexed files have changed
			stale: staleRatio >= 0.05,
			staleFiles: staleCount,
			totalFiles,
			staleRatio,
			lastIndexedAt
		};
	}

	async getIndexStatus(repo: string, repoPath?: string): Promise<IndexStatus> {
		const totalFiles = this.db.codebaseFiles.getFileCountByRepo(repo);
		const existingFiles = this.db.codebaseFiles.getFilesByRepo(repo);

		let totalSymbols = 0;
		for (const f of existingFiles) {
			totalSymbols += this.db.codebaseSymbols.getSymbolsByFile(repo, f.file_path).length;
		}

		let lastIndexedAt: string | null = null;
		if (existingFiles.length > 0) {
			const sorted = [...existingFiles].sort(
				(a, b) => new Date(b.last_indexed_at ?? 0).getTime() - new Date(a.last_indexed_at ?? 0).getTime()
			);
			lastIndexedAt = sorted[0].last_indexed_at;
		}

		const base: IndexStatus = {
			repo,
			isIndexed: totalFiles > 0,
			isIndexing: this.indexingRepos.has(repo),
			lastIndexedAt,
			totalFiles,
			totalSymbols,
			progress: null
		};

		// Only compute staleness if repoPath is provided AND the repo has been indexed
		if (repoPath && totalFiles > 0) {
			const staleness = await this.checkStaleness(repo, repoPath);
			base.stale = staleness.stale;
			base.staleRatio = staleness.staleRatio;
		}

		return base;
	}

	// ── Helpers ───────────────────────────────────────────────────

	private emitProgress(options: IndexOptions, progress: IndexProgress): void {
		if (options.onProgress) {
			try {
				options.onProgress(progress);
			} catch {
				// Progress callback must never kill the indexing pipeline
			}
		}
	}
}
