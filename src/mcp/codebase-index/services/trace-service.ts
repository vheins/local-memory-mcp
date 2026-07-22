/**
 * TraceService — traces a symbol's definition and usage across the codebase.
 *
 * Phase 1.0: name-based exact matching. Pure in-memory function — no DB dependencies.
 * Accepts a CodebaseSymbol array and returns definition location, export status,
 * and optionally references from other symbols' doc_comments.
 */

import type { CodebaseSymbol } from "../../types/codebase-symbol";

// ── Public types ────────────────────────────────────────────────────────

export interface TraceResult {
	symbol: CodebaseSymbol;
	definition: {
		file: string;
		line: number;
		column: number;
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
	context: string;
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
	includeReferences: boolean
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
			column: symbol.start_col ?? 0
		},
		references: [],
		exportChain: {
			exported: symbol.exported,
			defaultExport: symbol.default_export
		}
	};

	// Step 4: Find references if requested
	if (includeReferences) {
		result.references = findReferences(name, symbols, symbol.id);
	}

	return result;
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
