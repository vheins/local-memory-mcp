/**
 * codebase_references — denormalized call-site edge rows.
 *
 * One row = one call / instantiation / import site emitted by a language
 * visitor during parsing. `symbol_name` is the name of the referenced symbol
 * (the called identifier / constructed class / imported binding); the row
 * lives in the CALLER's file (`caller_file`, `caller_line`, `caller_name`).
 * `kind` is a coarse taxonomy: 'call' | 'instantiation' | 'import'.
 */
export type CodebaseReferenceKind = "call" | "instantiation" | "import";

export interface CodebaseReference {
	/** UUID. */
	id: string;
	repo: string;
	/** The referenced (called / instantiated / imported) symbol name. */
	symbol_name: string;
	/** File containing the call site. */
	caller_file: string;
	/** 1-based start line of the call site. */
	caller_line: number | null;
	/** Enclosing function/method name, when determinable. */
	caller_name: string | null;
	/** 'call' | 'instantiation' | 'import'. */
	kind: string;
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
	created_at: string;
}

export interface CodebaseReferenceInsert {
	repo: string;
	symbol_name: string;
	caller_file: string;
	caller_line?: number;
	caller_name?: string | null;
	kind: CodebaseReferenceKind | string;
}
