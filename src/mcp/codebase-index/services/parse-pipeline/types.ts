/**
 * parse-pipeline types — data contracts shared across the parse-loop modules.
 *
 * Split of the former parse-pipeline.ts monolith (TASK-553). Kept as type-only
 * exports so every stage module imports the same shapes with zero runtime cost.
 */

import type { ParserPool } from "../../parser";
import type { ParseResult } from "../../parser/language-visitor";
import type { ResolvedSymbol } from "../../parser/parent-resolver";
import type { ReexportResolver } from "../../parser/reexport-resolution";
import type { SemanticSymbolEnrichment } from "../../semantic/adapter";
import type { SemanticAdapterRegistry } from "../../semantic/registry";
import type { SQLiteStore } from "../../../storage/sqlite";
import type { CodebaseFileInsert, CodebaseSymbolInsert, CodebaseReferenceInsert } from "../../../types";
import type { IndexFileError, IndexProgress } from "../indexing-writer";
import type { ParseTask } from "./constants";

export type { IndexFileError, IndexProgress } from "../indexing-writer";

/** A file that passed Phase 1 (read + checksum) and Phase 2 (decision). */
export interface ParseCandidate {
	plan: ParseTask;
	checksum: string;
	lineCount: number;
	content: string;
}

/** One element of a Phase 1 concurrent read result (kept flat for the decision loop). */
export interface ReadBatchResult {
	plan: ParseTask;
	checksum: string | null;
	lineCount: number;
	content: string | null;
	error: string | null;
}

/** A single Phase 3 parse outcome (parsed payload or error) for one candidate. */
export interface ParsedOutcome {
	plan: ParseTask;
	checksum: string;
	lineCount: number;
	content: string;
	parseResult: ParseResult | null;
	error: string | null;
}

/** A resolved outcome: parent-linked symbols + optional semantic columns. */
export interface ResolvedSymbols {
	symbols: SymbolWithSemantic[];
	semanticMap: Map<string, SemanticSymbolEnrichment> | null;
	semanticEnriched: number;
}

/** Shape of the planner's existingMap entries. */
export interface ExistingFileEntry {
	checksum: string | null;
	lastIndexedAtMs: number | null;
}

// ── Pipeline options (narrowed — avoids a circular dep with the orchestrator) ─

export interface ParsePipelineOptions {
	/** If true, re-parse all files regardless of checksum match (default: false). */
	force?: boolean;
	/** Number of files to process per transaction batch (default: 50). */
	batchSize?: number;
	/** Progress callback emitted at each stage. */
	onProgress?: (progress: IndexProgress) => void;
	/**
	 * If true, resolve 'reexport' edges to their canonical targets (issue #87 —
	 * barrel-chain chasing) during the pipeline, populating
	 * target_file/target_symbol_id and expanding `export *` into one edge per
	 * re-exported symbol. The resolver reads the repo's ALREADY-INDEXED symbol
	 * surface (codebase_references + codebase_symbols + codebase_files); a
	 * first-time index (empty DB) leaves targets null — matching the #83 import
	 * resolution stance. Re-indexes resolve correctly.
	 */
	resolveReexports?: boolean;
	/**
	 * Optional semantic adapter registry (issue #90). When omitted, the default
	 * built-in registry (TypeScript + PHPStan PoC) is used. Injectable for tests
	 * and for operators who want custom language adapters.
	 */
	semanticRegistry?: SemanticAdapterRegistry;
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
	/** Count of symbols that received a semantic signature from the optional TS enrichment pass (issue #89). */
	semanticEnriched: number;
	errors: IndexFileError[];
}

// ── Cross-module invocation context ────────────────────────────────────────

/** Everything a stage needs from the caller — threaded instead of re-parametrized. */
export interface PipelineContext {
	db: SQLiteStore;
	parserPool: ParserPool;
	repo: string;
	existingMap: Map<string, ExistingFileEntry>;
	checksumToOldPaths: Map<string, string[]>;
	renameMap: Map<string, string>;
	stalePaths: Set<string>;
	options: ParsePipelineOptions;
	/**
	 * The re-export resolver built ONCE from the repo's already-indexed surface
	 * (issue #87). Null when reexports are disabled or the DB is empty; the
	 * reference mapper then persists unresolved edges (null targets, visible).
	 */
	reexportResolver: ReexportResolver | null;
}

/**
 * Mutable per-run aggregate counters + errors, threaded through every batch
 * stage. One instance per `runParsePipeline` call so per-batch error ORDER is
 * preserved exactly as the monolithic loop appended it (decision errors first,
 * then parse errors, interleaved across batches).
 */
export interface PipelineRun {
	processedSoFar: number;
	parsedFiles: number;
	skippedFiles: number;
	failedFiles: number;
	skippedByChecksum: number;
	renamedFiles: number;
	totalSymbols: number;
	timeoutErrors: number;
	permissionErrors: number;
	dbWriteErrors: number;
	semanticEnriched: number;
	errors: IndexFileError[];
}

/** Accumulated DB row batches for one concurrent parse batch (bounded — Fix #3a). */
export interface InsertBatch {
	fileInserts: CodebaseFileInsert[];
	symbolInserts: CodebaseSymbolInsert[];
	referenceInserts: CodebaseReferenceInsert[];
}

/** A resolved symbol with optional semantic columns attached for persistence. */
export interface SymbolWithSemantic extends ResolvedSymbol {
	/** Matched semantic enrichment for this symbol's `name#startLine` key, if any. */
	semantic: SemanticSymbolEnrichment | null;
	/** ISO timestamp set when `semantic` was attached (persisted to semantic_updated_at). */
	semanticUpdatedAt: string | null;
}
