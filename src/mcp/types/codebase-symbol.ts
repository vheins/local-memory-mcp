export interface CodebaseSymbolVector {
	symbol_id: string;
	vector: string;
	updated_at: string;
}

export interface CodebaseSymbol {
	id: string;
	repo: string;
	file_path: string;
	name: string;
	kind: string;
	exported: boolean;
	default_export: boolean;
	start_line: number | null;
	start_col: number | null;
	end_line: number | null;
	end_col: number | null;
	signature: string | null;
	doc_comment: string | null;
	parent_symbol_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface CodebaseSymbolRow {
	id: string;
	repo: string;
	file_path: string;
	name: string;
	kind: string;
	exported: number;
	default_export: number;
	start_line: number | null;
	start_col: number | null;
	end_line: number | null;
	end_col: number | null;
	signature: string | null;
	doc_comment: string | null;
	parent_symbol_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface CodebaseSymbolInsert {
	repo: string;
	file_path: string;
	name: string;
	kind: string;
	exported?: boolean;
	default_export?: boolean;
	start_line?: number;
	start_col?: number;
	end_line?: number;
	end_col?: number;
	signature?: string | null;
	doc_comment?: string | null;
	parent_symbol_id?: string | null;
}

export interface SymbolSearchQuery {
	query: string;
	repo?: string;
	/**
	 * Cross-repo scope — when non-empty, filters `cs.repo IN (...)` and takes
	 * precedence over `repo`. When both are absent the search is unscoped
	 * (callers must guard against this: codebase_symbols has no owner column).
	 */
	repos?: string[];
	kind?: string;
	filePath?: string;
	exportedOnly?: boolean;
	limit?: number;
	offset?: number;
}

/**
 * Case-insensitive prefix search on symbol names (autocomplete), served by the
 * idx_symbols_name_lower expression index (migration v20, issue #63). `repo`
 * is required to scope the scan; `kind` optionally narrows it (both are
 * trailing columns of the composite index).
 */
export interface SymbolPrefixSearchQuery {
	repo: string;
	prefix: string;
	kind?: string;
	limit?: number;
	offset?: number;
}

/**
 * Row shape for the SQL-level aggregation used by ARCHITECTURE reads
 * (OPT-PERF-08): symbol counts grouped by `(file_path, kind)` via GROUP BY.
 * Hydrating these rows is O(distinct file×kind pairs) instead of O(symbols).
 */
export interface SymbolCountGroupRow {
	file_path: string;
	kind: string;
	count: number;
}

export interface SymbolSearchResult {
	symbols: CodebaseSymbol[];
	total: number;
	hasMore: boolean;
}
