/**
 * TraceService — traces a symbol's definition and usage across the codebase.
 *
 * Phase 1.0: name-based exact matching. Pure in-memory function — no DB dependencies.
 * Accepts a CodebaseSymbol array and returns definition location, export status,
 * and optionally references from other symbols' doc_comments.
 */

import type { CodebaseSymbol } from "../../types";
import type { CodebaseReference, RelatedTypesResult } from "../../types";

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
	/**
	 * Enclosing container (e.g. class → method), resolved from the same-file
	 * parent_symbol_id link populated at index time (TASK-300). Null for
	 * top-level symbols or when the parent row is absent.
	 */
	parent: {
		id: string;
		name: string;
		kind: string;
		filePath: string;
		line: number | null;
	} | null;
	/** Direct children (e.g. a class's methods/properties), ordered by start line. */
	children: CodebaseSymbol[];
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
	 * 'call' | 'instantiation' | 'import' | 'extends' | 'implements' | 'type' —
	 * present for table-backed references (TASK-236 / #64; heritage kinds added
	 * by Phase 1.1 / TASK-299; 'type' by TASK-008 / issue #82).
	 */
	kind?: string;
	/** Enclosing function/method at the call / heritage site, when determinable. */
	callerName?: string | null;
	/** File path of the referenced symbol when resolvable (table-backed, v23). */
	targetFile?: string | null;
	/** codebase_symbols(id) of the referenced symbol when resolvable (table-backed, v23). */
	targetSymbolId?: string | null;
	/** Relation role of a 'type' edge (v26, issue #82): parameter/return/property/… Null otherwise. */
	role?: string | null;
	/** Local binding name of an 'import' edge (v27, issue #83); absent for other kinds. */
	localName?: string | null;
	/** Exported name as written in the module for an 'import' edge (v27, issue #83). */
	importedName?: string | null;
	/** Raw module specifier of an 'import' edge (v27, issue #83), e.g. `'@/domain/user'`. */
	moduleSpecifier?: string | null;
	/** 'default' | 'named' | 'namespace' | 'side-effect' (v27, issue #83); absent for other kinds. */
	importKind?: string | null;
}

// ── Related-types graph traversal (issue #84) ─────────────────────────────

/**
 * Hop bound for a single BFS level during related-types traversal.
 *
 * Each step multiplies the frontier by the fan-out of the previous level, so
 * an unbounded graph walk could blow up on a wide type surface (a DTO with
 * dozens of properties, each with generic arguments). 200 per level is far
 * beyond any realistic type-graph breadth while still bounding worst-case
 * memory/time deterministically.
 */
const MAX_TYPE_EDGES_PER_LEVEL = 200;

/**
 * Traverse 'type' reference edges (issue #82 / migration v26) from a root
 * symbol and return the deduplicated related-type subgraph (issue #84).
 *
 * The root's OWN type edges are the edges whose reference row sits in the
 * root's file (`caller_file` = root's definition file, `caller_name` =
 * root's name) — exactly the rows emitted by the TS type-edge emitter for the
 * root declaration's parameter/return/property/alias/generic/constraint/
 * union/intersection surface. Each deeper level repeats the walk from the
 * related symbols found so far.
 *
 * Resolution order per hop (ADR-002 name-based model, prefer structural):
 *   1. `target_symbol_id` — the parse-time-resolved row directly names the
 *      indexed symbol (canonical, cross-file safe).
 *   2. name-based fallback within the root symbol's own file, then repo-wide
 *      exact-name match, deduped to the first deterministically-ordered row.
 *   3. Any other fallback is skipped and counted in `skippedUnresolved` —
 *      an unresolved target never fails the whole traversal.
 *
 * Cycle-safe + deduplicated: BFS with a visited set keyed on the target
 * symbol id. A symbol already reached is never expanded again and its
 * shallowest-depth occurrence is the one reported, so repeated targets
 * collapse to a single edge carrying the first-seen relation metadata.
 *
 * @param root          the traced symbol (definition row).
 * @param repo          repo scope (may be undefined for unscoped traces).
 * @param symbols       ALL symbols loaded by the caller (repo-scoped when
 *                      `repo` is set) — provides id/name/file/kind lookups.
 * @param references    the repo's 'type' reference rows (caller filters by
 *                      kind for efficiency).
 * @param maxDepth      1..4 — BFS hop limit from the root.
 */
export function collectRelatedTypes(
	root: CodebaseSymbol,
	repo: string | undefined,
	symbols: CodebaseSymbol[],
	references: CodebaseReference[],
	maxDepth: number
): RelatedTypesResult {
	const edges: RelatedTypesResult["edges"] = [];
	let skippedUnresolved = 0;

	const symbolsById = new Map<string, CodebaseSymbol>();
	for (const s of symbols) symbolsById.set(s.id, s);

	// Root file index for the same-file name fallback; repo-wide fallback uses
	// the full `symbols` array. The file index is derived from the repo-scoped
	// `symbols`, so it never leaks cross-repo rows.
	const symbolsByFile = new Map<string, CodebaseSymbol[]>();
	for (const s of symbols) {
		const arr = symbolsByFile.get(s.file_path) ?? [];
		arr.push(s);
		symbolsByFile.set(s.file_path, arr);
	}

	// BFS bookkeeping. `reported` keys on the target symbol id — a symbol is
	// reported once, at its shallowest depth. `expanded` keys on the SOURCE
	// symbol id so a repeated source never re-walks its edges. The root is
	// pre-registered as reported so a cycle folding back to the root (A → B →
	// A) never re-emits the root as a related type.
	const reported = new Set<string>([root.id]);
	const expanded = new Set<string>();

	// Seed the frontier with the root's own type edges.
	const rootRefs = typeEdgesOf(root, references);
	let frontier: Array<{ symbolId: string; depth: number }> = [];
	for (const ref of rootRefs) {
		const resolved = resolveTypeTarget(ref, root, repo, symbols, symbolsById, symbolsByFile);
		if (!resolved) {
			skippedUnresolved++;
			continue;
		}
		const key = resolved.symbol.id;
		if (reported.has(key)) continue;
		reported.add(key);
		edges.push({
			targetSymbolId: key,
			targetName: resolved.symbol.name,
			targetFile: resolved.symbol.file_path,
			targetKind: resolved.symbol.kind,
			role: ref.role ?? null,
			depth: 1,
			fromName: root.name,
			fromSymbolId: root.id,
			line: ref.caller_line ?? null
		});
		frontier.push({ symbolId: key, depth: 1 });
	}
	expanded.add(root.id);

	// BFS through the related types. `depth` is the hop distance from the
	// root; level N expands the symbols first reached at depth N.
	for (let depth = 2; depth <= maxDepth; depth++) {
		const next: Array<{ symbolId: string; depth: number }> = [];
		let levelBreadth = 0;
		for (const current of frontier) {
			if (expanded.has(current.symbolId)) continue;
			expanded.add(current.symbolId);
			const symbol = symbolsById.get(current.symbolId);
			if (!symbol) continue;
			const refs = typeEdgesOf(symbol, references);
			for (const ref of refs) {
				if (levelBreadth >= MAX_TYPE_EDGES_PER_LEVEL) break;
				const resolved = resolveTypeTarget(ref, symbol, repo, symbols, symbolsById, symbolsByFile);
				if (!resolved) {
					skippedUnresolved++;
					continue;
				}
				const key = resolved.symbol.id;
				levelBreadth++;
				// Repeated target: already reported (or the root itself) — skip
				// without re-expanding; the shallowest-depth edge is the record.
				if (reported.has(key)) continue;
				reported.add(key);
				edges.push({
					targetSymbolId: key,
					targetName: resolved.symbol.name,
					targetFile: resolved.symbol.file_path,
					targetKind: resolved.symbol.kind,
					role: ref.role ?? null,
					depth,
					fromName: symbol.name,
					fromSymbolId: current.symbolId,
					line: ref.caller_line ?? null
				});
				next.push({ symbolId: key, depth });
			}
			if (levelBreadth >= MAX_TYPE_EDGES_PER_LEVEL) break;
		}
		frontier = next;
		if (frontier.length === 0) break;
	}

	return { edges, skippedUnresolved };
}

/**
 * All 'type' reference rows whose caller site is the given symbol: rows whose
 * `caller_file` is the symbol's definition file AND whose `caller_name` is the
 * symbol's name (the TS type-edge emitter tags function/method/field type
 * surfaces with the declaration's name; class/interface/alias type surfaces
 * emit `caller_name` null). Rows in the same file with a DIFFERENT
 * `caller_name` belong to sibling symbols and are excluded.
 */
function typeEdgesOf(symbol: CodebaseSymbol, references: CodebaseReference[]): CodebaseReference[] {
	return references.filter(
		(r) => r.kind === "type" && r.caller_file === symbol.file_path && (r.caller_name ?? null) === (symbol.name ?? null)
	);
}

/**
 * Resolve a 'type' reference row to its indexed target symbol.
 *
 * Preference order:
 *   1. `target_symbol_id` → direct id lookup (canonical, cross-file safe).
 *   2. Same-file exact-name match — the type is declared alongside the caller
 *      (the overwhelmingly common case for DTOs/interfaces in one module).
 *   3. Repo-wide exact-name match (first row in deterministic file/line
 *      order). Name-based per ADR-002; a same-name collision in another file
 *      may mis-resolve, exactly as reference aggregation does today.
 *
 * Returns null when none of the three resolve — the caller skips the hop
 * (unresolved targets never fail the traversal).
 */
function resolveTypeTarget(
	ref: CodebaseReference,
	caller: CodebaseSymbol,
	_repo: string | undefined,
	symbols: CodebaseSymbol[],
	symbolsById: Map<string, CodebaseSymbol>,
	symbolsByFile: Map<string, CodebaseSymbol[]>
): { symbol: CodebaseSymbol } | null {
	if (ref.target_symbol_id) {
		const byId = symbolsById.get(ref.target_symbol_id);
		if (byId) return { symbol: byId };
	}
	if (ref.target_file) {
		const sameFile = (symbolsByFile.get(ref.target_file) ?? []).find((s) => s.name === ref.symbol_name);
		if (sameFile) return { symbol: sameFile };
	}
	const byName = symbols.find((s) => s.name === ref.symbol_name);
	if (byName) return { symbol: byName };
	return null;
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

	// Step 3b: hierarchy (TASK-300) — the parent is the same-file container
	// whose id equals symbol.parent_symbol_id (set at index time by the parse
	// pipeline); children are the symbols whose parent_symbol_id points at this
	// symbol. Both are resolved in-memory from the provided array, which TRACE
	// mode already loads in full (getSymbolsByRepo), so no extra queries.
	const parentSymbol = symbol.parent_symbol_id ? (symbols.find((s) => s.id === symbol.parent_symbol_id) ?? null) : null;
	const children = symbols
		.filter((s) => s.parent_symbol_id === symbol.id)
		.sort((a, b) => (a.start_line ?? 0) - (b.start_line ?? 0));

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
		},
		parent: parentSymbol
			? {
					id: parentSymbol.id,
					name: parentSymbol.name,
					kind: parentSymbol.kind,
					filePath: parentSymbol.file_path,
					line: parentSymbol.start_line
				}
			: null,
		children
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
