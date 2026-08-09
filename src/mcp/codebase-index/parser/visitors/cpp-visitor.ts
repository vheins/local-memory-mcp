/**
 * CppVisitor — extracts symbols from C++ source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_definition → Function
 * - class_specifier     → Class
 * - struct_specifier    → Class (type = Struct)
 * - enum_specifier      → Enum
 * - type_definition     → Type
 *
 * Reference emission (TASK-308 / Phase 1.1) — node types verified EMPIRICALLY
 * against the shipped tree-sitter-cpp WASM (NOT guessed):
 * - `preproc_include` (field `path` = `string_literal` for `"base.h"` — with
 *   a `string_content` child — or `system_lib_string` for `<vector>`) → one
 *   'import' edge per include; the symbol name is the header path with
 *   delimiters stripped (`"base.h"` → 'base.h', `<sys/stat.h>` →
 *   'sys/stat.h'). Mapping a header to a symbol is out of scope — the name
 *   is the include path string itself (per the TASK-308 spec).
 * - `class_specifier` / `struct_specifier` with a `base_class_clause` child
 *   → heritage edges: the FIRST base (`type_identifier`, `template_type` —
 *   `Base<int>` → 'Base' — or qualified `ns::Base` → 'Base') is 'extends';
 *   each SUBSEQUENT base is 'implements' (position-based heuristic — C++ has
 *   no interface keyword; the grammar exposes one flat base list).
 *   `access_specifier` / `attribute_declaration` nodes are skipped (an
 *   attribute-specifier like `class X : [[deprecated]] Base` is legal C++
 *   on base-specifiers and must not shift the first-base position);
 *   `virtual` inheritance does not change the kind assignment (the base is
 *   still a `type_identifier`).
 * - `call_expression` → 'call' edges: `helper()` → 'helper' (identifier),
 *   `obj.method()` / `this->update()` → LAST segment (field_expression),
 *   `ns::func()` / `X::Y::z()` → LAST segment (qualified_identifier).
 *
 * The enclosing function/method name (call-site `callerName`) is resolved by
 * PIERCING declarator wrappers, verified empirically against the shipped
 * tree-sitter-cpp WASM: the name is NOT always a direct
 * identifier/field_identifier child of the direct function_declarator —
 * out-of-line definitions (`void Widget::outline()`) wrap it in a
 * `qualified_identifier` (name = LAST segment 'outline'), pointer/reference-
 * returning functions nest the function_declarator inside a
 * `pointer_declarator` / `reference_declarator` (`int *getPtr()` →
 * 'getPtr'), and destructors use a `destructor_name` node (`~W()` → 'W').
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";

const FUNCTION_DEFINITION = "function_definition";
const CLASS_SPECIFIER = "class_specifier";
const STRUCT_SPECIFIER = "struct_specifier";
const ENUM_SPECIFIER = "enum_specifier";
const TYPE_DEFINITION = "type_definition";
const FIELD_DECLARATION = "field_declaration";
const FIELD_DECLARATION_LIST = "field_declaration_list";
const COMMENT = "comment";
const DESTRUCTOR_NAME = "destructor_name";

// Reference-emission node types (TASK-308 / Phase 1.1).
const PREPROC_INCLUDE = "preproc_include";
const STRING_LITERAL = "string_literal";
const STRING_CONTENT = "string_content";
const SYSTEM_LIB_STRING = "system_lib_string";
const BASE_CLASS_CLAUSE = "base_class_clause";
const ACCESS_SPECIFIER = "access_specifier";
const TYPE_IDENTIFIER = "type_identifier";
const TEMPLATE_TYPE = "template_type";
const CALL_EXPRESSION = "call_expression";
const FIELD_EXPRESSION = "field_expression";
const QUALIFIED_IDENTIFIER = "qualified_identifier";
const IDENTIFIER = "identifier";
const FIELD_IDENTIFIER = "field_identifier";
const FUNCTION_DECLARATOR = "function_declarator";
const ATTRIBUTE_DECLARATION = "attribute_declaration";
const POINTER_DECLARATOR = "pointer_declarator";
const REFERENCE_DECLARATOR = "reference_declarator";
const PARENTHESIZED_DECLARATOR = "parenthesized_declarator";
const PARAMETER_LIST = "parameter_list";

export class CppVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false, false);
		return symbols;
	}

	// ── Reference emission (TASK-308 / Phase 1.1) ─────────────────

	/**
	 * Emit reference edges (TASK-308 / Phase 1.1), mirroring the GoVisitor /
	 * JavaVisitor / PythonVisitor structure.
	 *
	 * Cheap single AST pass over the reference surfaces of the
	 * tree-sitter-cpp grammar:
	 * - `preproc_include` → kind 'import' — one edge per include; the symbol
	 *   name is the header path with delimiters stripped (`"base.h"` →
	 *   'base.h', `<sys/stat.h>` → 'sys/stat.h'). Mapping header→symbol is
	 *   out of scope — the include path string is the name (TASK-308 spec).
	 * - `class_specifier` / `struct_specifier` `base_class_clause` →
	 *   kind 'extends' for the FIRST base, 'implements' for each SUBSEQUENT
	 *   base (position-based heuristic — C++ has no interface keyword; the
	 *   grammar exposes one flat base list; documented limitation: a class
	 *   with a single base that is actually an interface is tagged 'extends',
	 *   name-based parsing cannot distinguish them — ADR-002 constraint).
	 * - `call_expression` → kind 'call' (`helper()`, `obj.method()`,
	 *   `ns::func()` — LAST segment for member/qualified calls).
	 *
	 * `callerName` is the enclosing function/method name (tracked by
	 * descending into function_definition bodies — the declarator holds the
	 * method name inside class bodies) and null for heritage edges and
	 * includes (they belong to a declaration, not a function). `targetFile`
	 * / `targetSymbolId` are left null — name-based resolution per ADR-002
	 * happens at query time, not parse time.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		this.walkReferences(tree.rootNode, null, refs);
		return refs;
	}

	private walkReferences(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
		switch (node.type) {
			// Track the enclosing function/method name for call-site edges,
			// then recurse into the body (identical to the default branch).
			case FUNCTION_DEFINITION: {
				const fnName = this.functionName(node);
				for (const child of node.namedChildren) {
					this.walkReferences(child, fnName ?? callerName, refs);
				}
				return;
			}
			// Include edges (TASK-308): one 'import' reference per
			// preproc_include. Do NOT recurse — the path child
			// (string_literal / system_lib_string) is pure name, never a
			// call site.
			case PREPROC_INCLUDE: {
				this.emitIncludeEdge(node, refs);
				return;
			}
			// Heritage edges (TASK-308): emit 'extends'/'implements' per base
			// class, then recurse (class bodies may hold call sites).
			case CLASS_SPECIFIER:
			case STRUCT_SPECIFIER: {
				this.emitHeritage(node, refs);
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			// Call sites (TASK-308, optional — cheap): `helper()`,
			// `obj.method()`, `ns::func()`, `this->update()`.
			case CALL_EXPRESSION: {
				const target = this.callTargetName(node);
				if (target) {
					refs.push({
						symbolName: target,
						callerFile: "",
						callerLine: node.startPosition.row + 1,
						callerName,
						kind: "call"
					});
				}
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			default:
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
		}
	}

	/**
	 * Name of a function/method definition, PIERCING declarator wrappers
	 * (verified empirically against the shipped tree-sitter-cpp WASM — the
	 * name is not always a direct identifier/field_identifier child of a
	 * direct function_declarator):
	 *   - plain `void top()`            → function_declarator → 'top';
	 *   - out-of-line `void Widget::outline()` → function_declarator →
	 *     qualified_identifier → LAST segment 'outline';
	 *   - pointer/ref-returning `int *getPtr()` / `int& getRef()` →
	 *     pointer_declarator / reference_declarator wrapping the
	 *     function_declarator → 'getPtr' / 'getRef';
	 *   - destructor `~W()`             → function_declarator →
	 *     destructor_name → inner identifier 'W'.
	 * Returns null only when no name node is found (e.g. operator
	 * definitions, which carry no identifier — same as before the pierce).
	 */
	private functionName(node: TSNode): string | null {
		const declarator = this.findFunctionDeclarator(node);
		if (!declarator) return null;
		const nameNode = this.findDeclaratorName(declarator);
		return nameNode ? this.lastSegmentName(nameNode) : null;
	}

	/**
	 * Locate the function_declarator of a function_definition, descending
	 * ONLY through declarator wrappers (`pointer_declarator`,
	 * `reference_declarator`, `parenthesized_declarator`). The wrappers are
	 * never descended into for names — just pierced to reach the
	 * function_declarator. Returns null if none is found.
	 */
	private findFunctionDeclarator(node: TSNode): TSNode | null {
		for (const child of node.namedChildren) {
			if (child.type === FUNCTION_DECLARATOR) return child;
			if (
				child.type === POINTER_DECLARATOR ||
				child.type === REFERENCE_DECLARATOR ||
				child.type === PARENTHESIZED_DECLARATOR
			) {
				const nested = this.findFunctionDeclarator(child);
				if (nested) return nested;
			}
		}
		return null;
	}

	/**
	 * Name-bearing node inside a function_declarator: an
	 * identifier / field_identifier, a qualified_identifier (out-of-line
	 * definitions), or a destructor_name. Pierces nested declarators
	 * (parenthesized_declarator / pointer_declarator around the name, e.g.
	 * function-pointer shapes) but NEVER descends into the parameter_list —
	 * parameter names are identifiers too and must not be mistaken for the
	 * function name.
	 */
	private findDeclaratorName(node: TSNode): TSNode | null {
		if (
			node.type === IDENTIFIER ||
			node.type === FIELD_IDENTIFIER ||
			node.type === QUALIFIED_IDENTIFIER ||
			node.type === DESTRUCTOR_NAME
		) {
			return node;
		}
		for (const child of node.namedChildren) {
			if (child.type === PARAMETER_LIST) continue;
			const name = this.findDeclaratorName(child);
			if (name) return name;
		}
		return null;
	}

	/**
	 * Emit one 'import' reference edge per preproc_include (TASK-308).
	 *
	 * Grammar (verified empirically against the shipped tree-sitter-cpp
	 * WASM): preproc_include has a `path` field holding a `string_literal`
	 * (`#include "base.h"` — a `string_content` child carries the inner text)
	 * or a `system_lib_string` (`#include <vector>` — raw text with angle
	 * brackets). The referenced symbol is the header path with delimiters
	 * stripped — the FULL path (`"utils/math.h"` → 'utils/math.h',
	 * `<sys/stat.h>` → 'sys/stat.h'), NOT the last segment: mapping a header
	 * to a symbol is out of scope and the include path string is the natural
	 * name unit (per the TASK-308 spec; last-segment would mangle
	 * 'sys/stat.h' → 'stat.h'). `callerLine` = the include line; `callerName`
	 * null (includes are not inside functions).
	 */
	private emitIncludeEdge(node: TSNode, refs: ParsedReference[]): void {
		const pathNode = node.childForFieldName("path");
		if (!pathNode) return;
		const header = this.includeHeaderName(pathNode);
		if (!header) return;
		refs.push({
			symbolName: header,
			callerFile: "",
			callerLine: node.startPosition.row + 1,
			callerName: null,
			kind: "import"
		});
	}

	/**
	 * Resolve the include header name from the `path` child of a
	 * preproc_include: `string_literal` → its `string_content`
	 * ('base.h', 'utils/math.h'); `system_lib_string` → inner text with
	 * angle brackets stripped ('vector', 'sys/stat.h'); a bare `identifier`
	 * (macro form `#include FOO`) → its text. Returns null for unrecognized
	 * shapes (no edge emitted).
	 */
	private includeHeaderName(pathNode: TSNode): string | null {
		if (pathNode.type === STRING_LITERAL) {
			const content = pathNode.namedChildren.find((c) => c.type === STRING_CONTENT);
			if (content) return content.text;
			const text = pathNode.text;
			return text.length >= 2 ? text.slice(1, -1) : null;
		}
		if (pathNode.type === SYSTEM_LIB_STRING) {
			const text = pathNode.text;
			return text.length >= 2 ? text.slice(1, -1) : null;
		}
		if (pathNode.type === IDENTIFIER) return pathNode.text;
		return null;
	}

	/**
	 * Emit heritage edges for a class_specifier / struct_specifier
	 * (TASK-308).
	 *
	 * Grammar (tree-sitter-cpp, verified empirically): the optional
	 * `base_class_clause` child holds a FLAT list of base entries
	 * (`class Derived : public Base, protected ILeft, virtual IRight`):
	 * anonymous `:` / `,` / `virtual` tokens, named `access_specifier`
	 * nodes, named `attribute_declaration` nodes (an attribute-specifier on
	 * a base-specifier is legal C++ — `class X : [[deprecated]] Base {};`),
	 * and named base-type nodes — `type_identifier` (`Base`),
	 * `template_type` (`Base<int>` → base is its first named child), or a
	 * qualified name (`ns::Base` → LAST segment). The FIRST base
	 * (position-based heuristic, Kotlin TASK-304 precedent) → kind 'extends';
	 * each SUBSEQUENT base → 'implements'. `access_specifier` and
	 * `attribute_declaration` nodes are skipped and do not count toward the
	 * position. `callerLine` = the class/struct declaration line; `callerName`
	 * null per the heritage contract.
	 */
	private emitHeritage(node: TSNode, refs: ParsedReference[]): void {
		const baseClause = node.namedChildren.find((c) => c.type === BASE_CLASS_CLAUSE);
		if (!baseClause) return;
		const line = node.startPosition.row + 1;
		let baseIndex = 0;
		for (const child of baseClause.namedChildren) {
			// Skip non-base entries so they neither emit a spurious edge nor
			// shift the first-base 'extends' position (FIX TASK-350).
			if (child.type === ACCESS_SPECIFIER || child.type === ATTRIBUTE_DECLARATION) continue;
			const target = this.baseTargetName(child);
			if (!target) continue;
			refs.push({
				symbolName: target,
				callerFile: "",
				callerLine: line,
				callerName: null,
				kind: baseIndex === 0 ? "extends" : "implements"
			});
			baseIndex++;
		}
	}

	/**
	 * Resolve the name-based target of a base-class node (ADR-002 LAST name
	 * segment, capped pierce):
	 *   - `type_identifier` → 'Base'
	 *   - `template_type`   → 'Base'  (Base<int> → first named child)
	 *   - qualified name    → LAST segment (ns::Base → 'Base')
	 *
	 * Returns null for unrecognized shapes (no edge emitted).
	 */
	private baseTargetName(node: TSNode): string | null {
		let current: TSNode = node;
		for (let depth = 0; depth < 8; depth++) {
			if (current.type === TYPE_IDENTIFIER || current.type === IDENTIFIER) return current.text;
			const inner =
				current.type === TEMPLATE_TYPE
					? current.namedChildren[0]
					: current.namedChildren[current.namedChildren.length - 1];
			if (!inner) return null;
			current = inner;
		}
		return null;
	}

	/**
	 * Read the referenced identifier from a call_expression (TASK-308):
	 * - `helper()`     → `function` field identifier → 'helper'.
	 * - `obj.method()` / `this->update()` / `a.b.c()` → `function` field
	 *   field_expression → LAST segment (field_identifier → 'method' /
	 *   'update' / 'c').
	 * - `ns::func()` / `X::Y::z()` → `function` field qualified_identifier →
	 *   LAST segment (identifier → 'func' / 'z').
	 * Returns null for dynamic function expressions (`(*fp)()`,
	 * parenthesized_expression) and C-style casts (`int(x)`, primitive_type)
	 * which can't be name-indexed.
	 */
	private callTargetName(node: TSNode): string | null {
		const fn = node.childForFieldName("function");
		if (!fn) return null;
		if (fn.type === IDENTIFIER) return fn.text;
		if (fn.type === FIELD_EXPRESSION || fn.type === QUALIFIED_IDENTIFIER) {
			return this.lastSegmentName(fn);
		}
		return null;
	}

	/** LAST name segment of a (possibly nested) member/qualified expression. */
	private lastSegmentName(node: TSNode): string | null {
		if (node.type === IDENTIFIER || node.type === FIELD_IDENTIFIER) return node.text;
		const last = node.namedChildren[node.namedChildren.length - 1];
		if (!last) return null;
		return this.lastSegmentName(last);
	}

	private walkNode(
		node: TSNode,
		symbols: ParsedSymbol[],
		parentName: string | null,
		insideClass: boolean,
		insideStruct: boolean
	): void {
		const type = node.type;

		// ── Inside class/struct body: extract members ───────────
		if (insideClass || insideStruct) {
			// Method: function_definition inside class body
			if (type === FUNCTION_DEFINITION) {
				const declarator = node.namedChildren.find((c) => c.type === "function_declarator");
				if (declarator) {
					const nameNode = declarator.namedChildren.find(
						(c) => c.type === "identifier" || c.type === "field_identifier"
					);
					if (nameNode) {
						symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
					}
				}
				return;
			}
			// Field declaration
			if (type === FIELD_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "field_identifier" || c.type === "identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Property, parentName));
				}
				return;
			}
			// Nested class/struct
			if (type === CLASS_SPECIFIER || type === STRUCT_SPECIFIER) {
				const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
				if (nameNode) {
					const kind = type === CLASS_SPECIFIER ? SymbolKind.Class : SymbolKind.Class;
					symbols.push(this.makeSymbol(node, nameNode.text, kind, parentName));
					const body = node.namedChildren.find((c) => c.type === FIELD_DECLARATION_LIST);
					if (body) {
						this.walkNode(body, symbols, nameNode.text, true, type === STRUCT_SPECIFIER);
					}
				}
				return;
			}
			// Destructor
			if (type === DESTRUCTOR_NAME) {
				// Handled via function_declaration parent
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, insideClass, insideStruct);
			}
			return;
		}

		// ── Function definition ─────────────────────────────────
		if (type === FUNCTION_DEFINITION) {
			const declarator = node.namedChildren.find((c) => c.type === "function_declarator");
			if (declarator) {
				const nameNode = declarator.namedChildren.find((c) => c.type === "identifier" || c.type === "field_identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
				}
			}
			return;
		}

		// ── Class specifier ─────────────────────────────────────
		if (type === CLASS_SPECIFIER) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === FIELD_DECLARATION_LIST);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true, false);
				}
			}
			return;
		}

		// ── Struct specifier ────────────────────────────────────
		if (type === STRUCT_SPECIFIER) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === FIELD_DECLARATION_LIST);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, false, true);
				}
			}
			return;
		}

		// ── Enum specifier ──────────────────────────────────────
		if (type === ENUM_SPECIFIER) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
			}
			return;
		}

		// ── Type definition ─────────────────────────────────────
		if (type === TYPE_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	// C++ symbols always have exported: true because tree-sitter parses
	// header and source files without distinguishing visibility at the
	// symbol level. Access specifiers (public/private/protected) are
	// context-dependent and a single method call is insufficient.
	// Consumer code should filter by parent access specifier if needed.

	private makeSymbol(node: TSNode, name: string, kind: SymbolKind, parentName: string | null): ParsedSymbol {
		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: this.buildSignature(node),
			docComment: this.extractDocComment(node),
			exported: true,
			defaultExport: false,
			parentName
		};
	}

	private buildSignature(node: TSNode): string {
		const firstLine = node.text.split("\n")[0] ?? "";
		return firstLine.replace(/\s+/g, " ").trim();
	}

	private extractDocComment(node: TSNode): string | null {
		const prev = node.previousNamedSibling;
		if (prev && prev.type === COMMENT) {
			if (prev.text.startsWith("/**")) {
				return prev.text
					.replace(/^\/\*\*?\s?/, "")
					.replace(/\s?\*\/$/, "")
					.trim();
			}
		}
		return null;
	}
}
