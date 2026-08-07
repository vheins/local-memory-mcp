/**
 * LanguageVisitor — abstract interface for language-specific parsers.
 *
 * Each language implementation traverses its tree-sitter AST and extracts
 * structured symbol information (functions, classes, interfaces, etc.).
 */

import type { Tree } from "web-tree-sitter";

/** Coarse taxonomy of a call-site reference. */
export type ReferenceKind = "call" | "instantiation" | "import";

/**
 * A single call / instantiation / import site emitted by a language visitor.
 *
 * `symbolName` is the referenced symbol (the called identifier, constructed
 * class, or imported binding); `callerLine` is the 1-based start line of the
 * call site; `callerName` is the enclosing function/method name when
 * determinable (else null). The parser pool fills `callerFile` from the file
 * being parsed (visitors emit references without it).
 */
export interface ParsedReference {
	symbolName: string;
	/** File containing the call site — filled by the parser pool. */
	callerFile: string;
	/** Call-site line, 1-based. */
	callerLine: number;
	/** Enclosing function/method name, when determinable. */
	callerName: string | null;
	kind: ReferenceKind;
}

/** Classification of a parsed symbol. */
export enum SymbolKind {
	Function = "function",
	Class = "class",
	Interface = "interface",
	Type = "type",
	Enum = "enum",
	Variable = "variable",
	Method = "method",
	Property = "property",
	/** Class constant or top-level constant (PHP `const`, `define`, etc.). */
	Constant = "constant",
	/** Namespace import / module reference (PHP `use Foo\Bar;`, Python `import`, etc.). */
	Module = "module",
	/** Markdown H1 heading. */
	Heading1 = "heading1",
	/** Markdown H2 heading. */
	Heading2 = "heading2",
	/** Markdown H3–H6 heading. */
	Heading = "heading",
	/** Markdown fenced code block. */
	CodeBlock = "code_block",
	/** Route declaration (generic regex visitor). */
	Route = "route",
	/** Config key-value pair (generic regex visitor). */
	Key = "key"
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
	/**
	 * Extract symbols from a pre-parsed tree-sitter AST.
	 * For non-tree-sitter visitors (e.g. markdown), the tree is unused and may be null.
	 */
	extractSymbols(tree: Tree | null, sourceCode: string): ParsedSymbol[];

	/**
	 * OPTIONAL — emit call-site references for the parsed tree.
	 *
	 * Additive passthrough added in TASK-236 (#64) so language visitors can
	 * index calls/instantiations/imports WITHOUT breaking existing visitors
	 * that only implement `extractSymbols`. Implementers return references
	 * without `callerFile` (the pool fills it); absent references resolve to
	 * `[]`. Only TS and PHP visitors implement it today.
	 */
	extractReferences?(tree: Tree | null, sourceCode: string): ParsedReference[];
}

/** Result of a single parse operation. */
export interface ParseResult {
	/** Symbols extracted from the file. */
	symbols: ParsedSymbol[];
	/** Call-site references extracted from the file (empty when none / visitor lacks support). */
	references?: ParsedReference[];
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
