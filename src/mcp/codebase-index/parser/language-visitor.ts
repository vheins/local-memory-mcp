/**
 * LanguageVisitor — abstract interface for language-specific parsers.
 *
 * Each language implementation traverses its tree-sitter AST and extracts
 * structured symbol information (functions, classes, interfaces, etc.).
 */

/** Classification of a parsed symbol. */
export enum SymbolKind {
	Function = "function",
	Class = "class",
	Interface = "interface",
	Type = "type",
	Enum = "enum",
	Variable = "variable",
	Method = "method",
	Property = "property"
}

/** A parsed symbol extracted from source code. */
export interface ParsedSymbol {
	/** Human-readable identifier (e.g. "fetchUser"). */
	name: string;
	/** Classification of the symbol. */
	kind: SymbolKind;
	/** 1-based start line. */
	startLine: number;
	/** 1-based start column. */
	startCol: number;
	/** 1-based end line. */
	endLine: number;
	/** 1-based end column. */
	endCol: number;
	/** Human-readable signature (first line of the declaration or type annotation). */
	signature: string;
	/** JSDoc-style doc comment text (null if none). */
	docComment: string | null;
	/** Whether the symbol is exported. */
	exported: boolean;
	/** Whether the symbol is a default export. */
	defaultExport: boolean;
	/** Name of the enclosing symbol (class name for methods, null for top-level). */
	parentName: string | null;
}

/** Contract that every language parser must implement. */
export interface LanguageVisitor {
	/** File extensions this visitor can handle (e.g. [".ts", ".tsx"]). */
	supportedExtensions(): string[];

	/** Parse source code and return discovered symbols. */
	parse(sourceCode: string, filePath: string): ParsedSymbol[];
}

/** Result of a single parse operation. */
export interface ParseResult {
	/** Symbols extracted from the file. */
	symbols: ParsedSymbol[];
	/** Error message if parsing failed, null on success. */
	error: string | null;
	/** Wall-clock duration of the parse in milliseconds. */
	durationMs: number;
}

/** Manages the lifecycle of tree-sitter WASM parsers. */
export interface ParserPool {
	/** Lazy-init: loads WASM and creates parser on first call. */
	initialize(): Promise<void>;

	/** Whether the pool has been initialized. */
	isInitialized(): boolean;

	/** Parse a single file, returning extracted symbols. */
	parseFile(filePath: string, sourceCode: string): Promise<ParseResult>;
}
