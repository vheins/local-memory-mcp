/**
 * TraceService — traces a symbol's definition and usage across the codebase.
 *
 * Phase 1.0: name-based exact matching. Pure in-memory function — no DB dependencies.
 * Accepts a CodebaseSymbol array and returns definition location, export status,
 * and optionally references from other symbols' doc_comments.
 */

import type { CodebaseSymbol } from "../../types";

// ── Public types ────────────────────────────────────────────────────────

export interface TraceResult {
	symbol: CodebaseSymbol;
	definition: {
		file: string;
		line: number;
		column: number;
		endLine: number;
		endColumn: number;
	};
	references: TraceReference[];
	exportChain: {
		exported: boolean;
		defaultExport: boolean;
	};
	disambiguation?: CodebaseSymbol[];
}

export interface TraceReference {
	filePath: string;
	startLine: number;
	startCol: number;
	endLine: number;
	endCol: number;
	context: string;
	/**
	 * 'call' | 'instantiation' | 'import' | 'extends' | 'implements' — present
	 * for table-backed references (TASK-236 / #64; heritage kinds added by
	 * Phase 1.1 / TASK-299).
	 */
	kind?: string;
	/** Enclosing function/method at the call / heritage site, when determinable. */
	callerName?: string | null;
	/** File path of the referenced symbol when resolvable (table-backed, v23). */
	targetFile?: string | null;
	/** codebase_symbols(id) of the referenced symbol when resolvable (table-backed, v23). */
	targetSymbolId?: string | null;
}

// ── Errors ──────────────────────────────────────────────────────────────

export class SymbolNotFoundError extends Error {
	constructor(name: string, repo?: string) {
		const suffix = repo ? ` in repo "${repo}"` : "";
		super(`Symbol "${name}" not found${suffix}`);
		this.name = "SymbolNotFoundError";
	}
}

export class AmbiguousSymbolError extends Error {
	public readonly disambiguation: CodebaseSymbol[];

	constructor(name: string, disambiguation: CodebaseSymbol[], repo?: string) {
		const suffix = repo ? ` in repo "${repo}"` : "";
		super(`Ambiguous symbol "${name}" — ${disambiguation.length} matches found${suffix}`);
		this.name = "AmbiguousSymbolError";
		this.disambiguation = disambiguation;
	}
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Trace a symbol by exact name match.
 *
 * 1. Find symbols with exact name match in the provided array.
 * 2. If multiple matches, throw AmbiguousSymbolError with all candidates.
 * 3. If single match, find its definition location and export status.
 * 4. If includeReferences, search other symbols' doc_comments and signatures for the name.
 *
 * @throws {SymbolNotFoundError} if no symbol matches the given name.
 * @throws {AmbiguousSymbolError} if multiple symbols match (disambiguation required).
 */
export function traceSymbol(
	name: string,
	repo: string | undefined,
	symbols: CodebaseSymbol[],
	includeReferences: boolean,
	storedReferences?: TraceReference[]
): TraceResult {
	// Step 1: Find exact name matches
	const matches = symbols.filter((s) => s.name === name);

	if (matches.length === 0) {
		throw new SymbolNotFoundError(name, repo);
	}

	// Step 2: Disambiguation for multiple matches
	if (matches.length > 1) {
		throw new AmbiguousSymbolError(name, matches, repo);
	}

	// Step 3: Single match — build result
	const symbol = matches[0];

	const result: TraceResult = {
		symbol,
		definition: {
			file: symbol.file_path,
			line: symbol.start_line ?? 0,
			column: symbol.start_col ?? 0,
			endLine: symbol.end_line ?? 0,
			endColumn: symbol.end_col ?? 0
		},
		references: [],
		exportChain: {
			exported: symbol.exported,
			defaultExport: symbol.default_export
		}
	};

	// Step 4: Find references if requested. The table-backed references
	// (emitted by the parse visitors, TASK-236) are the primary precise source;
	// the in-memory doc_comment/signature scan is kept as the safety net when
	// the table has no stored refs for the symbol (e.g. pre-v21 index data or a
	// language without a reference-emitting visitor). When both exist they are
	// merged and deduped by call-site line.
	if (includeReferences) {
		const inMemory = findReferences(name, symbols, symbol.id);
		const stored = storedReferences ?? [];
		if (stored.length === 0) {
			result.references = inMemory;
		} else {
			result.references = mergeStoredAndInMemory(stored, inMemory);
		}
	}

	return result;
}

/**
 * Merge table-backed references with in-memory substring matches, deduping by
 * call-site (filePath, startLine) so the same site is never reported twice.
 * Stored references win on conflict (precise line > symbol-anchored context).
 */
function mergeStoredAndInMemory(stored: TraceReference[], inMemory: TraceReference[]): TraceReference[] {
	const seen = new Set<string>();
	const merged: TraceReference[] = [];
	for (const ref of stored) {
		const key = `${ref.filePath}:${ref.startLine}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(ref);
	}
	for (const ref of inMemory) {
		const key = `${ref.filePath}:${ref.startLine}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(ref);
	}
	return merged;
}

// ── Internal helpers ────────────────────────────────────────────────────

/**
 * Search other symbols for references to the given name.
 * Checks doc_comments and signatures for the name string.
 * Excludes the definition symbol itself by ID.
 */
function findReferences(name: string, symbols: CodebaseSymbol[], excludeId: string): TraceReference[] {
	const refs: TraceReference[] = [];
	const searchName = name;

	for (const sym of symbols) {
		if (sym.id === excludeId) continue;

		const docComment = sym.doc_comment ?? "";
		const signature = sym.signature ?? "";

		// Check doc_comment for the name
		if (docComment.includes(searchName)) {
			refs.push({
				filePath: sym.file_path,
				startLine: sym.start_line ?? 0,
				startCol: sym.start_col ?? 0,
				endLine: sym.end_line ?? 0,
				endCol: sym.end_col ?? 0,
				context: extractContext(docComment, searchName)
			});
			continue; // Don't double-add if also in signature
		}

		// Check signature for the name
		if (signature.includes(searchName)) {
			refs.push({
				filePath: sym.file_path,
				startLine: sym.start_line ?? 0,
				startCol: sym.start_col ?? 0,
				endLine: sym.end_line ?? 0,
				endCol: sym.end_col ?? 0,
				context: signature
			});
		}
	}

	return refs;
}

/**
 * Extract the line containing the search text, with the match as context.
 */
function extractContext(text: string, search: string): string {
	const lines = text.split("\n");
	for (const line of lines) {
		if (line.includes(search)) {
			return line.trim();
		}
	}
	// Fallback to first line
	return lines[0]?.trim() ?? "";
}
