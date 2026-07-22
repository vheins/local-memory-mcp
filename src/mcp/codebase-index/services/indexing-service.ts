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
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { CodebaseFileInsert } from "../../types/codebase-file.js";
import type { CodebaseSymbolInsert } from "../../types/codebase-symbol.js";
import type { DiscoveredFile } from "../types/index.js";
import { logger } from "../../utils/logger.js";

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
	getIndexStatus(repo: string): Promise<IndexStatus>;
}

export interface IndexOptions {
	/** If true, re-parse all files regardless of checksum match (default: false). */
	force?: boolean;
	/** Include-only glob patterns passed to FileDiscovery. */
	includeGlobs?: string[];
	/** Extra exclude glob patterns passed to FileDiscovery. */
	excludeGlobs?: string[];
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

// ── Private type for file categorization ──────────────────────────────

type FilePlan =
	| { action: "skip"; filePath: string }
	| { action: "parse"; filePath: string; absolutePath: string; language: string; sizeBytes: number };

// ── Factory ───────────────────────────────────────────────────────────

export function createCodebaseIndexService(db: SQLiteStore, parserPool: ParserPool): CodebaseIndexService {
	return new CodebaseIndexServiceImpl(db, parserPool);
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
		const errors: IndexFileError[] = [];
		let totalFiles: number;
		let parsedFiles = 0;
		let skippedFiles = 0;
		let failedFiles = 0;
		let totalSymbols = 0;

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
				excludeGlobs: options.excludeGlobs
			});

			const discoveredFiles = discoverResult.files;
			logger.info("[IndexingService] Discovery complete", {
				repo,
				filesFound: discoveredFiles.length
			});

			// ═══════════════════════════════════════════════════════
			// 2. COMPARE — categorize each file: skip or parse
			// ═══════════════════════════════════════════════════════
			const fileMap = new Map<string, DiscoveredFile>();
			const existingFiles = this.db.codebaseFiles.getFilesByRepo(repo);
			const existingMap = new Map<string, { checksum: string | null }>();
			for (const f of existingFiles) {
				existingMap.set(f.file_path, { checksum: f.checksum });
			}

			const plans: FilePlan[] = [];
			const discoveredPaths = new Set<string>();

			for (const df of discoveredFiles) {
				discoveredPaths.add(df.path);
				fileMap.set(df.path, df);

				if (options.force) {
					plans.push({ action: "parse", ...df, filePath: df.path });
					continue;
				}

				const existing = existingMap.get(df.path);
				if (!existing) {
					// New file — parse
					plans.push({ action: "parse", ...df, filePath: df.path });
				} else {
					// Exists — compare checksum below at parse time
					// Mark for parse too; we'll compare after reading
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
			// 3. PARSE — for each file needing processing
			// ═══════════════════════════════════════════════════════
			const parseTasks = plans.filter((p): p is Extract<FilePlan, { action: "parse" }> => p.action === "parse");
			let processedSoFar = 0;

			this.emitProgress(options, {
				stage: "parsing",
				current: 0,
				total: parseTasks.length,
				message: `Parsing ${parseTasks.length} files...`
			});

			// Collect inserts for batching
			const fileInserts: CodebaseFileInsert[] = [];
			const symbolInserts: CodebaseSymbolInsert[] = [];

			for (const plan of parseTasks) {
				try {
					// Read file content
					const content = fs.readFileSync(plan.absolutePath, "utf-8");
					const checksum = computeChecksum(content);
					const lineCount = countLines(content);

					// Compare checksum if not forced
					const existing = existingMap.get(plan.filePath);
					if (!options.force && existing && existing.checksum === checksum) {
						skippedFiles++;
						processedSoFar++;
						// Still need to bump last_indexed_at? No — preserve existing
						continue;
					}

					// Parse
					const parseResult = await this.parserPool.parseFile(plan.filePath, content);

					if (parseResult.error) {
						failedFiles++;
						errors.push({ filePath: plan.filePath, error: parseResult.error });
						// Still store the file metadata even if parse had errors
					} else {
						parsedFiles++;
					}

					// Map ParsedSymbol → CodebaseSymbolInsert
					for (const sym of parseResult.symbols) {
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
						checksum,
						lines: lineCount,
						size_bytes: plan.sizeBytes
					});

					processedSoFar++;
					this.emitProgress(options, {
						stage: "parsing",
						current: processedSoFar,
						total: parseTasks.length,
						message: `Parsed ${processedSoFar}/${parseTasks.length}: ${plan.filePath}`
					});
				} catch (err) {
					failedFiles++;
					processedSoFar++;
					const message = err instanceof Error ? err.message : String(err);
					errors.push({ filePath: plan.filePath, error: message });
					logger.warn("[IndexingService] File parse failed", {
						repo,
						filePath: plan.filePath,
						error: message
					});
				}
			}

			// ═══════════════════════════════════════════════════════
			// 4. STORE — upsert files and symbols in transactions
			// ═══════════════════════════════════════════════════════
			this.emitProgress(options, {
				stage: "storing",
				current: 0,
				total: symbolInserts.length,
				message: `Storing ${fileInserts.length} files and ${symbolInserts.length} symbols...`
			});

			// Upsert files (each call is self-contained)
			for (const fi of fileInserts) {
				this.db.codebaseFiles.upsertFile(fi);
			}

			// Bulk delete old symbols for files that were re-parsed, then bulk insert new
			await this.db.withWrite(async () => {
				// Collect all file paths that were parsed (not skipped)
				const reindexedPaths = new Set<string>();
				for (const fi of fileInserts) {
					reindexedPaths.add(fi.file_path);
				}

				// Delete old symbols for re-indexed files
				for (const fp of reindexedPaths) {
					this.db.codebaseSymbols.deleteSymbolsByFile(repo, fp);
				}

				// Bulk insert new symbols
				if (symbolInserts.length > 0) {
					this.db.codebaseSymbols.bulkUpsertSymbols(symbolInserts);
				}
			});

			this.emitProgress(options, {
				stage: "storing",
				current: symbolInserts.length,
				total: symbolInserts.length,
				message: `Stored ${symbolInserts.length} symbols.`
			});

			// ═══════════════════════════════════════════════════════
			// 5. CLEAN — delete records for files no longer on disk
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
				errors
			};
		} finally {
			this.indexingRepos.delete(repo);
		}
	}

	async checkStaleness(repo: string, repoPath: string): Promise<StalenessResult> {
		const resolvedPath = path.resolve(repoPath);
		const discovered = await discoverFiles({ projectPath: resolvedPath });
		const existingFiles = this.db.codebaseFiles.getFilesByRepo(repo);

		const existingMap = new Map<string, { checksum: string | null }>();
		for (const f of existingFiles) {
			existingMap.set(f.file_path, { checksum: f.checksum });
		}

		let staleCount = 0;

		for (const df of discovered.files) {
			const existing = existingMap.get(df.path);
			if (!existing) {
				staleCount++;
				continue;
			}

			try {
				const content = fs.readFileSync(df.absolutePath, "utf-8");
				const checksum = computeChecksum(content);
				if (checksum !== existing.checksum) {
					staleCount++;
				}
			} catch {
				// File can't be read — count as stale
				staleCount++;
			}
		}

		// Files in DB but not on disk also count as stale
		const discoveredPaths = new Set(discovered.files.map((f) => f.path));
		for (const existing of existingFiles) {
			if (!discoveredPaths.has(existing.file_path)) {
				staleCount++;
			}
		}

		const totalComparable = Math.max(discovered.files.length + existingFiles.length, 1);

		// Compute last indexed time
		const allFiles = existingFiles.length > 0 ? existingFiles : null;
		let lastIndexedAt: string | null = null;
		if (allFiles && allFiles.length > 0) {
			const sorted = [...allFiles].sort(
				(a, b) => new Date(b.last_indexed_at ?? 0).getTime() - new Date(a.last_indexed_at ?? 0).getTime()
			);
			lastIndexedAt = sorted[0].last_indexed_at;
		}

		return {
			stale: staleCount > 0,
			staleFiles: staleCount,
			totalFiles: totalComparable,
			staleRatio: Math.round((staleCount / totalComparable) * 1000) / 1000,
			lastIndexedAt
		};
	}

	async getIndexStatus(repo: string): Promise<IndexStatus> {
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

		return {
			repo,
			isIndexed: totalFiles > 0,
			isIndexing: this.indexingRepos.has(repo),
			lastIndexedAt,
			totalFiles,
			totalSymbols,
			progress: null
		};
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
