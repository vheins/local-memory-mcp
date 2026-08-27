/**
 * codebase_references — denormalized edge rows (Phase 1.1, migration v23).
 *
 * One row = one call / instantiation / import / heritage site emitted by a
 * language visitor during parsing. Two edge families share the table:
 *
 *   1. Call-site edges (v21): `symbol_name` is the referenced symbol (called
 *      identifier / constructed class / imported binding); the row lives in
 *      the CALLER's file (`caller_file`, `caller_line`, `caller_name`).
 *   2. Heritage edges (Wave 1, kinds 'extends' | 'implements'): `symbol_name`
 *      is the referenced base class / implemented interface; `caller_file`
 *      is the file declaring the derived type and `caller_line` the class
 *      declaration line.
 *
 * `target_file` / `target_symbol_id` (added v23) locate the referenced symbol
 * when resolvable at parse time (name-based resolution per ADR-002 — no LSP);
 * both are null for unresolved names. `kind` is the single enum-driven
 * taxonomy: 'call' | 'instantiation' | 'import' | 'extends' | 'implements' |
 * 'type'. The 'type' kind (added v26, issue #82) represents type-only
 * dependencies (parameter/return/property/alias/generic/union/intersection
 * usage) — distinguished further by an optional `role` column.
 */
export type CodebaseReferenceKind = "call" | "instantiation" | "import" | "extends" | "implements" | "type";

/**
 * Optional relation role for a 'type' reference edge (issue #82, migration
 * v26). `null` (the stored value for non-type kinds and for type edges where
 * the role was not determinable) means "no role". Roles are set by type-edge
 * emission in the TS/TSX visitor and surfaced in TRACE output.
 */
export type CodebaseReferenceRole =
	| "parameter"
	| "return"
	| "property"
	| "field"
	| "alias"
	| "generic"
	| "constraint"
	| "union"
	| "intersection"
	| null;

export interface CodebaseReference {
	/** UUID. */
	id: string;
	repo: string;
	/** The referenced (called / instantiated / imported / extended) symbol name. */
	symbol_name: string;
	/** File containing the call / heritage site. */
	caller_file: string;
	/** 1-based start line of the call / heritage site. */
	caller_line: number | null;
	/** Enclosing function/method name, when determinable. */
	caller_name: string | null;
	/** 'call' | 'instantiation' | 'import' | 'extends' | 'implements'. */
	kind: string;
	/** File path of the referenced symbol, when resolvable at parse time (else null). */
	target_file: string | null;
	/** codebase_symbols(id) of the referenced symbol, when resolvable (else null). */
	target_symbol_id: string | null;
	/** Optional relation role for 'type' edges (issue #82, v26); null otherwise. */
	role: CodebaseReferenceRole;
	created_at: string;
}

export interface CodebaseReferenceRow {
	id: string;
	repo: string;
	symbol_name: string;
	caller_file: string;
	caller_line: number | null;
	caller_name: string | null;
	kind: string;
	target_file: string | null;
	target_symbol_id: string | null;
	role: CodebaseReferenceRole;
	created_at: string;
}

export interface CodebaseReferenceInsert {
	repo: string;
	symbol_name: string;
	caller_file: string;
	caller_line?: number;
	caller_name?: string | null;
	kind: CodebaseReferenceKind | string;
	/** File path of the referenced symbol when resolvable at parse time. */
	target_file?: string | null;
	/** codebase_symbols(id) of the referenced symbol when resolvable. */
	target_symbol_id?: string | null;
	/** Optional relation role for 'type' edges (issue #82, v26). */
	role?: CodebaseReferenceRole;
}

/**
 * Per-symbol reference aggregation (TASK-319 dead-code / hotspots).
 *
 * Produced by `CodebaseReferenceEntity.countReferencesBySymbol` and
 * `getTopReferencedSymbols` via SQL `GROUP BY symbol_name, kind` — the same
 * name-based model as `getReferencesBySymbol` (ADR-002: a symbol is "used" if
 * ANY reference kind points at its name). No denormalized counter column is
 * stored on codebase_symbols (DB stays flat — this is a query-level compute).
 */
export interface SymbolReferenceCounts {
	/** Total reference rows across ALL kinds (call + instantiation + import + extends + implements + type). */
	total: number;
	/** Per-kind row counts, keyed by CodebaseReferenceKind. */
	countsByKind: Record<string, number>;
}

/** A row from the top-N reference aggregation (hotspots): name + total + per-kind breakdown. */
export interface TopReferencedSymbolRow {
	symbol_name: string;
	total: number;
	countsByKind: Record<string, number>;
}
