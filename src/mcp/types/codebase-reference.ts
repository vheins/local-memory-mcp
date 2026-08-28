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
 *
 * Import metadata (added v27, issue #83): 'import' rows additionally carry
 * `local_name` / `imported_name` / `module_specifier` / `import_kind` so an
 * aliased import like `import { User as DomainUser } from '@/domain/user'`
 * records BOTH the local binding (DomainUser) and the canonical exported
 * name (User) with the raw module specifier — the info TRACE needs to expose
 * canonical targets for aliased imports.
 */
export type CodebaseReferenceKind = "call" | "instantiation" | "import" | "extends" | "implements" | "type";

/**
 * Import form of an 'import' reference edge (issue #83, migration v27).
 * `null` (the stored value for non-import kinds) means "not an import edge".
 */
export type ImportKind = "default" | "named" | "namespace" | "side-effect" | null;

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
	/** 'call' | 'instantiation' | 'import' | 'extends' | 'implements' | 'type'. */
	kind: string;
	/** File path of the referenced symbol, when resolvable at parse time (else null). */
	target_file: string | null;
	/** codebase_symbols(id) of the referenced symbol, when resolvable (else null). */
	target_symbol_id: string | null;
	/** Optional relation role for 'type' edges (issue #82, v26); null otherwise. */
	role: CodebaseReferenceRole;
	/** Local binding name in the importing file (v27, issue #83); null for non-import edges. */
	local_name: string | null;
	/** Exported name as written in the module (v27, issue #83); null for non-import / side-effect edges. */
	imported_name: string | null;
	/** Raw module specifier as written in the import statement (v27, issue #83); null for non-import edges. */
	module_specifier: string | null;
	/** 'default' | 'named' | 'namespace' | 'side-effect' (v27, issue #83); null for non-import edges. */
	import_kind: ImportKind;
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
	local_name: string | null;
	imported_name: string | null;
	module_specifier: string | null;
	import_kind: ImportKind;
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
	/** Local binding name in the importing file (v27, issue #83). */
	local_name?: string | null;
	/** Exported name as written in the module (v27, issue #83). */
	imported_name?: string | null;
	/** Raw module specifier as written in the import statement (v27, issue #83). */
	module_specifier?: string | null;
	/** 'default' | 'named' | 'namespace' | 'side-effect' (v27, issue #83). */
	import_kind?: ImportKind;
}

/**
 * Resolved canonical target of an import (issue #83) — produced by
 * resolveImport at parse time and persisted onto the 'import' reference row's
 * target_file / target_symbol_id columns. `targetFile` is null when the module
 * specifier could not be mapped to an indexed file; `targetSymbolId` is null
 * when the module resolved but the imported name has no same-file exported
 * symbol (namespace / side-effect imports, barrel re-exports, unresolved
 * names). Never-throwing: every resolution failure degrades to nulls.
 */
export interface ImportResolution {
	targetFile: string | null;
	targetSymbolId: string | null;
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

/**
 * One resolved related-type hop in a TRACE related-types traversal
 * (issue #84). Produced by the trace service when `includeRelatedTypes` is
 * set: each entry is a single 'type' reference edge between two indexed
 * symbols, enriched with the relation role and the BFS depth at which the
 * target was first reached from the root symbol.
 */
export interface RelatedTypeEdge {
	/** `codebase_symbols(id)` of the TARGET (the type being referenced). */
	targetSymbolId: string;
	/** Symbol name of the target type. */
	targetName: string;
	/** File path of the target's definition (when resolvable). */
	targetFile: string | null;
	/** Kind of the target symbol (interface/class/type/…), when resolvable. */
	targetKind: string | null;
	/** Relation role of the edge (parameter/return/property/…). */
	role: CodebaseReferenceRole;
	/**
	 * BFS traversal depth from the root symbol: 1 = direct type edge,
	 * 2 = reached via one intermediate related type, etc.
	 */
	depth: number;
	/** Source symbol name of this hop (the root for depth 1). */
	fromName: string;
	/** Source symbol id of this hop. */
	fromSymbolId: string;
	/** 1-based declaration line of the reference site (root symbol's declaration). */
	line: number | null;
}

/**
 * Result of a related-types graph traversal (issue #84). `edges` is the
 * deduplicated hop set (each target symbol appears once — cycles and
 * repeated targets collapse to the shallowest-depth occurrence, carrying all
 * relation metadata); `skippedUnresolved` counts 'type' reference rows whose
 * target could not be resolved to an indexed symbol (missing target file /
 * symbol id / symbol row) and were skipped without failing the traversal.
 */
export interface RelatedTypesResult {
	edges: RelatedTypeEdge[];
	skippedUnresolved: number;
}
