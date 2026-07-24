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
	kind?: string;
	filePath?: string;
	exportedOnly?: boolean;
	limit?: number;
	offset?: number;
}

export interface SymbolSearchResult {
	symbols: CodebaseSymbol[];
	total: number;
	hasMore: boolean;
}
