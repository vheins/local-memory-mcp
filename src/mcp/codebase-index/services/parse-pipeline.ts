/**
 * parse-pipeline — the incremental 3-phase parse loop.
 *
 * Extracted from indexing-repository.ts PARSE section (single-concern
 * boundary — keeps the orchestrator under the 500-LOC standard, GQ2ACG).
 *
 * Phase 1: concurrent immutable reads + checksums (NO parse)
 * Phase 2: sequential decision — checksum skip (touch-only), rename detection
 * Phase 3: parse ONLY changed/new candidates, bounded by the parser semaphore
 *
 * Per-batch DB flush and progress emission happen inside this module so memory
 * stays bounded (Fix #3) and the orchestrator stays a thin coordinator.
 */

import fs from "node:fs";
import type { ParserPool } from "../parser";
import { resolveConcurrency } from "../parser/worker-pool";
import type { ParseResult } from "../parser/language-visitor";
import type { SQLiteStore } from "../../storage/sqlite";
import type { CodebaseFileInsert, CodebaseSymbolInsert, CodebaseReferenceInsert } from "../../types";
import { logger } from "../../utils/logger";
import {
	isPermissionError,
	isTimeoutError,
	computeChecksum,
	countLines,
	DEFAULT_BATCH_SIZE,
	type FilePlan
} from "./indexing-cache";
import { writeParseBatch, type IndexFileError, type IndexProgress } from "./indexing-writer";
import { resolveFileParents } from "../parser/parent-resolver";

// ── Pipeline options (narrowed — avoids a circular dep with the orchestrator) ─

export interface ParsePipelineOptions {
	/** If true, re-parse all files regardless of checksum match (default: false). */
	force?: boolean;
	/** Number of files to process per transaction batch (default: 50). */
	batchSize?: number;
	/** Progress callback emitted at each stage. */
	onProgress?: (progress: IndexProgress) => void;
}

// ── Pipeline result ────────────────────────────────────────────────────────

export interface ParsePipelineResult {
	parsedFiles: number;
	skippedFiles: number;
	failedFiles: number;
	skippedByChecksum: number;
	renamedFiles: number;
	totalSymbols: number;
	timeoutErrors: number;
	permissionErrors: number;
	dbWriteErrors: number;
	errors: IndexFileError[];
}

// ── Local types ────────────────────────────────────────────────────────────

/** A parse-candidate plan (plans that passed the mtime pre-filter). */
type ParseTask = Extract<FilePlan, { action: "parse" }>;

/** A file that passed Phase 1 (read + checksum) and Phase 2 (decision). */
interface ParseCandidate {
	plan: ParseTask;
	checksum: string;
	lineCount: number;
	content: string;
}

/** Shape of the planner's existingMap entries. */
export interface ExistingFileEntry {
	checksum: string | null;
	lastIndexedAtMs: number | null;
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * Run the 3-phase parse loop over the given parse tasks.
 *
 * Mutates `renameMap` (new path → old path) and `stalePaths` (paths no longer
 * on disk) as renames are detected; the orchestrator applies renames and stale
 * cleanup AFTER the pipeline returns so transferred records are never
 * overwritten by a later parse batch.
 *
 * @returns Aggregate counters + per-file errors for the orchestrator's report.
 */
export async function runParsePipeline(
	db: SQLiteStore,
	parserPool: ParserPool,
	repo: string,
	parseTasks: ParseTask[],
	existingMap: Map<string, ExistingFileEntry>,
	checksumToOldPaths: Map<string, string[]>,
	renameMap: Map<string, string>,
	stalePaths: Set<string>,
	options: ParsePipelineOptions = {}
): Promise<ParsePipelineResult> {
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	const errors: IndexFileError[] = [];

	// Skip-reason counters
	let skippedFiles = 0;
	let skippedByChecksum = 0;

	// Parsed / renamed counters
	let parsedFiles = 0;
	let failedFiles = 0;
	let totalSymbols = 0;
	let renamedFiles = 0;

	// Error classification counters
	let timeoutErrors = 0;
	let permissionErrors = 0;
	let dbWriteErrors = 0;

	emitProgress(options, {
		stage: "parsing",
		current: 0,
		total: parseTasks.length,
		message: `Parsing ${parseTasks.length} files concurrently...`
	});

	// Parse batch = parser semaphore concurrency (Fix #3b): at most this
	// many up-to-10MB file buffers can be in flight at once, so queued
	// buffers can't pile up and blow the heap.
	const CONCURRENT_PARSE_BATCH = Math.max(1, resolveConcurrency());
	const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

	// Per-batch insert arrays — flushed to the DB after every batch so
	// memory stays bounded (Fix #3a); the whole repo is never accumulated.
	let fileInserts: CodebaseFileInsert[] = [];
	let symbolInserts: CodebaseSymbolInsert[] = [];
	let referenceInserts: CodebaseReferenceInsert[] = [];
	let processedSoFar = 0;

	for (let i = 0; i < parseTasks.length; i += CONCURRENT_PARSE_BATCH) {
		const batch = parseTasks.slice(i, i + CONCURRENT_PARSE_BATCH);

		// ── Phase 1: concurrent immutable reads + checksums (NO parse) ──
		// The checksum skip must happen BEFORE parseFile so unchanged files
		// are never handed to tree-sitter (root cause of reindex slowness).
		const batchResults = await Promise.all(
			batch.map(async (plan) => {
				try {
					if (plan.sizeBytes > MAX_FILE_SIZE_BYTES) {
						return {
							plan,
							checksum: null as string | null,
							lineCount: 0,
							content: null as string | null,
							error: `File exceeds max size (${plan.sizeBytes} bytes > ${MAX_FILE_SIZE_BYTES} bytes)`
						};
					}
					const content = await fs.promises.readFile(plan.absolutePath, "utf-8");
					const checksum = computeChecksum(content);
					const lineCount = countLines(content);
					return {
						plan,
						checksum,
						lineCount,
						content,
						error: null as string | null
					};
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return {
						plan,
						checksum: null as string | null,
						lineCount: 0,
						content: null as string | null,
						error: message
					};
				}
			})
		);

		// ── Phase 2: sequential decision (shared state) ──
		// Skip unchanged by checksum (touch-only), detect renames, and
		// collect only the files that genuinely need parsing.
		const parseCandidates: ParseCandidate[] = [];

		for (const { plan, checksum, lineCount, content, error } of batchResults) {
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

			if (checksum === null || content === null) {
				failedFiles++;
				errors.push({
					filePath: plan.filePath,
					error: "File read produced no result"
				});
				processedSoFar++;
				continue;
			}

			const existing = existingMap.get(plan.filePath);
			const isNewFile = !existing;

			// ── Checksum skip: unchanged (touch-only) — NO parse ──
			if (!options.force && existing && existing.checksum === checksum) {
				skippedFiles++;
				skippedByChecksum++;
				processedSoFar++;
				continue;
			}

			// ── Rename detection ──────────────────────────
			if (isNewFile && checksum) {
				const candidateOldPaths = checksumToOldPaths.get(checksum);
				if (candidateOldPaths) {
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
			}

			parseCandidates.push({ plan, checksum, lineCount, content });
		}

		// ── Phase 3: parse ONLY candidates, bounded by semaphore concurrency ──
		if (parseCandidates.length > 0) {
			const parseResults = await Promise.all(
				parseCandidates.map(async ({ plan, checksum, lineCount, content }) => {
					try {
						const parseResult = await parserPool.parseFile(plan.filePath, content);
						return { plan, checksum, lineCount, parseResult, error: null as string | null };
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						return { plan, checksum, lineCount, parseResult: null as ParseResult | null, error: message };
					}
				})
			);

			for (const { plan, checksum, lineCount, parseResult, error } of parseResults) {
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

				// Defensive guard: ParserPool.parseFile always resolves a
				// ParseResult (errors are captured in .error), so this is
				// unreachable in practice — but keeps invariants explicit.
				if (parseResult === null) {
					failedFiles++;
					processedSoFar++;
					errors.push({
						filePath: plan.filePath,
						error: "Parse produced no result"
					});
					continue;
				}

				if (parseResult.error) {
					failedFiles++;
					errors.push({
						filePath: plan.filePath,
						error: parseResult.error
					});
					if (/timeout/i.test(parseResult.error)) {
						timeoutErrors++;
						logger.warn("[IndexingService] Parse timeout — skipped", {
							repo,
							filePath: plan.filePath,
							error: parseResult.error
						});
					} else {
						logger.warn("[IndexingService] Parse error", {
							repo,
							filePath: plan.filePath,
							error: parseResult.error
						});
					}
				} else {
					parsedFiles++;
				}

				// Symbols (TASK-300 parent linking): the visitor already emitted
				// each symbol's `parentName` (enclosing class/interface/enum/...),
				// so resolveFileParents assigns per-symbol ids and resolves
				// parent_symbol_id (same-file, name-based per ADR-002, span
				// containment disambiguates same-name collisions) BEFORE insert —
				// the entity honors the pre-assigned id. The whole parent map is
				// recomputed per parse and replaced atomically per file by the
				// indexing writer (delete-by-file + bulk-insert in one txn).
				for (const sym of resolveFileParents(parseResult.symbols)) {
					symbolInserts.push({
						id: sym.id,
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
						parent_symbol_id: sym.resolvedParentSymbolId
					});
					totalSymbols++;
				}

				// Reference edges (TASK-236 / issue #64 + Phase 1.1 / TASK-299).
				// caller_file is the parsed file; the caller line/name/kind come
				// from the visitor. target_file/target_symbol_id (v23) locate the
				// referenced symbol when the visitor could resolve it at parse
				// time (name-based resolution per ADR-002 — else null).
				for (const ref of parseResult.references ?? []) {
					referenceInserts.push({
						repo,
						symbol_name: ref.symbolName,
						caller_file: ref.callerFile || plan.filePath,
						caller_line: ref.callerLine,
						caller_name: ref.callerName,
						kind: ref.kind,
						target_file: ref.targetFile ?? null,
						target_symbol_id: ref.targetSymbolId ?? null
					});
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
			}

			// ── Flush this batch's inserts (bounded memory — Fix #3a) ──
			if (fileInserts.length > 0) {
				dbWriteErrors += await writeParseBatch(
					{ db, repo, batchSize, options },
					fileInserts,
					symbolInserts,
					renameMap,
					referenceInserts
				);
				fileInserts = [];
				symbolInserts = [];
				referenceInserts = [];
			}
		}

		emitProgress(options, {
			stage: "parsing",
			current: processedSoFar,
			total: parseTasks.length,
			message: `Parsed ${processedSoFar}/${parseTasks.length} files...`
		});
	}

	return {
		parsedFiles,
		skippedFiles,
		failedFiles,
		skippedByChecksum,
		renamedFiles,
		totalSymbols,
		timeoutErrors,
		permissionErrors,
		dbWriteErrors,
		errors
	};
}

// ── Helper ────────────────────────────────────────────────────────────────

/** Emit a progress event — the callback must never kill the pipeline. */
export function emitProgress(options: ParsePipelineOptions, progress: IndexProgress): void {
	if (options.onProgress) {
		try {
			options.onProgress(progress);
		} catch {
			// Progress callback must never kill the indexing pipeline
		}
	}
}
