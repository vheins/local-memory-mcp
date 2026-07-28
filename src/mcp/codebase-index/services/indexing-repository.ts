/**
 * indexing-repository — core indexRepository function.
 * Discover → Compare → Parse → Store → Clean pipeline.
 * Planning/writing extracted to indexing-planner.ts and indexing-writer.ts.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { discoverFiles } from "./file-discovery.js";
import type { ParserPool } from "../parser/index.js";
import type { ParseResult } from "../parser/language-visitor.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { CodebaseFileInsert } from "../../types/codebase-file.js";
import type { CodebaseSymbolInsert } from "../../types/codebase-symbol.js";
import type { DiscoveredFile } from "../types/index.js";
import type { ErrorSummary } from "../types/errors.js";
import { logger } from "../../utils/logger.js";

// Import cache-level utilities
import {
	retryDbWrite,
	isPermissionError,
	isTimeoutError,
	computeChecksum,
	countLines,
	checkRepoStaleness,
	DEFAULT_BATCH_SIZE,
	type FilePlan,
	type StalenessResult
} from "./indexing-cache.js";

// Import extracted sub-modules
import { createIndexPlan } from "./indexing-planner.js";
import { writeIndexResults, type WriteContext, type IndexProgress, type IndexFileError } from "./indexing-writer.js";

// ── Module-level indexing guard (shared instance) ──────────────────────

import { indexingRepos as _indexingRepos } from "./indexing-cache.js";
const indexingRepos = _indexingRepos;

// ── Error types ────────────────────────────────────────────────────────

/** Thrown when attempting to index a repo that is already being indexed. */
export class IndexInProgressError extends Error {
	constructor(repo: string) {
		super(`Index already in progress for repo: ${repo}. Concurrent indexing is not supported.`);
		this.name = "IndexInProgressError";
	}
}

// ── Public interfaces ──────────────────────────────────────────────────

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

// Re-export for consumers
export type { IndexProgress, IndexFileError } from "./indexing-writer.js";

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

// Re-export StalenessResult from cache layer
export type { StalenessResult } from "./indexing-cache.js";

// ── Core indexRepository function ──────────────────────────────────────

export async function performIndexRepository(
	db: SQLiteStore,
	parserPool: ParserPool,
	repo: string,
	repoPath: string,
	indexingRepos: Set<string>,
	options: IndexOptions = {}
): Promise<IndexResult> {
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
	if (indexingRepos.has(repo)) {
		throw new IndexInProgressError(repo);
	}
	indexingRepos.add(repo);

	try {
		// ═══ 1. DISCOVER ═══
		emitProgress(options, {
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

		// ═══ 2. COMPARE (delegate to planner) ═══
		const existingFiles = db.codebaseFiles.getFilesByRepo(repo);
		const planResult = createIndexPlan(discoveredFiles, existingFiles, options);

		totalFiles = planResult.totalFiles;
		const { plans, fileMap, existingMap, checksumToOldPaths, renameMap, stalePaths } = planResult;

		emitProgress(options, {
			stage: "discovering",
			current: totalFiles,
			total: totalFiles,
			message: `Discovered ${totalFiles} files (${plans.length} to process, ${planResult.staleCount} stale).`
		});

		// ═══════════════════════════════════════════════════════
		// 3. PARSE — two-phase: concurrent read+parse, sequential mutation
		// ═══════════════════════════════════════════════════════
		const parseTasks = plans.filter((p): p is Extract<FilePlan, { action: "parse" }> => p.action === "parse");

		emitProgress(options, {
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
		const CONCURRENT_PARSE_BATCH = Math.max(4, os.cpus().length);

		for (let i = 0; i < parseTasks.length; i += CONCURRENT_PARSE_BATCH) {
			const batch = parseTasks.slice(i, i + CONCURRENT_PARSE_BATCH);

			// ── Phase 1: concurrent immutable reads ──
			const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
			const batchResults = await Promise.all(
				batch.map(async (plan) => {
					try {
						if (plan.sizeBytes > MAX_FILE_SIZE_BYTES) {
							return {
								plan,
								checksum: null as string | null,
								lineCount: 0,
								parseResult: null as ParseResult | null,
								error: `File exceeds max size (${plan.sizeBytes} bytes > ${MAX_FILE_SIZE_BYTES} bytes)`
							};
						}
						const content = fs.readFileSync(plan.absolutePath, "utf-8");
						const checksum = computeChecksum(content);
						const lineCount = countLines(content);
						const parseResult = await parserPool.parseFile(plan.filePath, content);
						return {
							plan,
							checksum,
							lineCount,
							parseResult,
							error: null as string | null
						};
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
					errors.push({
						filePath: plan.filePath,
						error
					});
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
					errors.push({
						filePath: plan.filePath,
						error: parseResult!.error
					});
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

			emitProgress(options, {
				stage: "parsing",
				current: processedSoFar,
				total: parseTasks.length,
				message: `Parsed ${processedSoFar}/${parseTasks.length} files...`
			});
		}

		// ═══════════════════════════════════════════════════════
		// 4. STORE + 5. CLEAN — delegate to writer
		// ═══════════════════════════════════════════════════════
		const writeCtx: WriteContext = {
			db,
			repo,
			fileInserts,
			symbolInserts,
			renameMap,
			stalePaths,
			batchSize,
			options
		};

		const writeResult = await writeIndexResults(writeCtx);
		dbWriteErrors += writeResult.dbWriteErrors;

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
		indexingRepos.delete(repo);
	}
}

// ── Implementation class ───────────────────────────────────────────────

/**
 * CodebaseIndexServiceImpl — delegates to standalone functions.
 *
 * Implements the CodebaseIndexService interface by routing calls to
 * the focused sub-modules.
 */
export class CodebaseIndexServiceImpl implements CodebaseIndexService {
	private db: SQLiteStore;
	private parserPool: ParserPool;

	constructor(db: SQLiteStore, parserPool: ParserPool) {
		this.db = db;
		this.parserPool = parserPool;
	}

	async indexRepository(repo: string, repoPath: string, options: IndexOptions = {}): Promise<IndexResult> {
		return performIndexRepository(this.db, this.parserPool, repo, repoPath, indexingRepos, options);
	}

	async checkStaleness(repo: string, repoPath: string): Promise<StalenessResult> {
		return checkRepoStaleness(this.db, repo, repoPath);
	}

	async getIndexStatus(repo: string, repoPath?: string): Promise<IndexStatus> {
		const totalFiles = this.db.codebaseFiles.getFileCountByRepo(repo);
		const existingFiles = this.db.codebaseFiles.getFilesByRepo(repo);

		const totalSymbols = this.db.codebaseSymbols.getSymbolCountByRepo(repo);

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
			isIndexing: indexingRepos.has(repo),
			lastIndexedAt,
			totalFiles,
			totalSymbols,
			progress: null
		};

		// Only compute staleness if repoPath is provided AND the repo has been indexed
		if (repoPath && totalFiles > 0) {
			const staleness = await checkRepoStaleness(this.db, repo, repoPath);
			base.stale = staleness.stale;
			base.staleRatio = staleness.staleRatio;
		}

		return base;
	}
}

// ── Helper ──────────────────────────────────────────────────────────────

function emitProgress(options: IndexOptions, progress: IndexProgress): void {
	if (options.onProgress) {
		try {
			options.onProgress(progress);
		} catch {
			// Progress callback must never kill the indexing pipeline
		}
	}
}
