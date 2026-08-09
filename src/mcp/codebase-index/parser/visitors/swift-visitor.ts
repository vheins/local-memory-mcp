/**
 * SwiftVisitor — extracts symbols from Swift source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_declaration → Function
 * - class_declaration    → Class
 * - struct               → Class (type = Struct)
 * - enum                 → Enum
 * - protocol_declaration → Interface
 * - extension            → Class (type = Extension)
 * - actor                → Class (type = Actor)
 *
 * Export detection: `public` or `open` modifier.
 *
 * Reference emission (TASK-309 / Phase 1.1) — node types verified EMPIRICALLY
 * against the shipped tree-sitter-swift WASM (dist/grammars/tree-sitter-swift,
 * NOT guessed — live AST probes):
 * - `import_declaration` → one 'import' edge per statement. Swift binds exactly
 *   one name per import; the binding is the LAST name segment of the imported
 *   `identifier` (`import UIKit` → 'UIKit'; `import class Foundation.URLSession`
 *   → 'URLSession'). The import-kind keyword ('class' | 'func' | 'struct' |
 *   'protocol' | ...) is ANONYMOUS in the AST — granularity is the whole
 *   statement, and `import class Foo.Bar` is indistinguishable from
 *   `import Foo.Bar` by name (documented decision).
 * - `class_declaration` — in this grammar version the SAME named node covers
 *   class / struct / actor / enum / extension declarations, distinguished by
 *   the `declaration_kind` FIELD (verified: 'class' | 'struct' | 'extension' |
 *   'enum' | 'actor'). There is NO `inheritance_clause` /
 *   `type_inheritance_clause` / `class_restriction` wrapper — the inheritance
 *   clause is an anonymous `:` sequence whose targets are DIRECT
 *   `inheritance_specifier` children with an `inherits_from` field →
 *   `user_type` (LAST `type_identifier` child = last name segment; generic
 *   `Base<T>` → 'Base'; dotted `ns.Base` → 'Base'):
 *     - kind 'class' | 'actor': FIRST specifier → 'extends' (the superclass),
 *       each SUBSEQUENT specifier → 'implements' (protocol conformance) —
 *       position-based heuristic (C++ TASK-308 precedent; Swift's first
 *       position can also be a lone protocol, unresolvable by name per
 *       ADR-002, documented limitation).
 *     - kind 'struct' | 'extension': ALL specifiers → 'implements' (they have
 *       no superclass — only conformances; `extension Foo: Proto`).
 *     - kind 'enum': SKIPPED entirely — `enum E: Int, CaseIterable` binds the
 *       raw-value type ('Int') with the exact same AST shape as a conformance;
 *       name-based resolution cannot distinguish them (documented).
 * - `protocol_declaration` → every `inheritance_specifier` → 'extends'
 *   (`protocol P: Q, R` → P extends Q, P extends R; `&`-composition
 *   `Base & Proto` yields one specifier per element — verified).
 * - `call_expression` → 'call' edges: the FIRST named child is a
 *   `simple_identifier` (`helper()` → 'helper') or a `navigation_expression`
 *   (`obj.save()` / `self.update()` / `a.b.c()` → LAST `simple_identifier`
 *   segment: 'save' / 'update' / 'c'). Dynamic targets — the outer call of
 *   `(getFactory)()` / `(getFactory())()` (first child is a
 *   `tuple_expression`) — emit nothing (the inner `getFactory()` sibling
 *   call still emits). `Foo()` initializer calls name-resolve to 'Foo'
 *   (name-based, documented).
 *
 * Heritage edges carry `callerName` null (the edge belongs to the derived
 * type's declaration, per the TASK-299 ParsedReference contract); `targetFile`
 * / `targetSymbolId` stay null — name-based resolution per ADR-002 happens at
 * query time, not parse time.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";

const FUNCTION_DECLARATION = "function_declaration";
const CLASS_DECLARATION = "class_declaration";
const STRUCT_DECLARATION = "struct_declaration";
const ENUM_DECLARATION = "enum_declaration";
const PROTOCOL_DECLARATION = "protocol_declaration";
const EXTENSION_DECLARATION = "extension_declaration";
const ACTOR_DECLARATION = "actor_declaration";
const CLASS_BODY = "class_body";
const MODIFIERS = "modifiers";
const COMMENT = "comment";
const MULTILINE_COMMENT = "multiline_comment";
const TYPE_IDENTIFIER = "type_identifier";

// Reference-emission node types (TASK-309 / Phase 1.1) — verified empirically
// against the shipped tree-sitter-swift WASM (NOT guessed; no
// type_inheritance_clause / class_restriction wrappers exist in this version).
const IMPORT_DECLARATION = "import_declaration";
const INHERITANCE_SPECIFIER = "inheritance_specifier";
const USER_TYPE = "user_type";
const IDENTIFIER = "identifier";
const SIMPLE_IDENTIFIER = "simple_identifier";
const CALL_EXPRESSION = "call_expression";
const NAVIGATION_EXPRESSION = "navigation_expression";
const INIT_DECLARATION = "init_declaration";

// `declaration_kind` field values of class_declaration (verified field).
const DECLARATION_KIND_CLASS = "class";
const DECLARATION_KIND_STRUCT = "struct";
const DECLARATION_KIND_EXTENSION = "extension";
const DECLARATION_KIND_ACTOR = "actor";
const DECLARATION_KIND_ENUM = "enum";

export class SwiftVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	// ── Reference emission (TASK-309 / Phase 1.1) ─────────────────

	/**
	 * Emit reference edges (TASK-309 / Phase 1.1), mirroring the GoVisitor /
	 * CppVisitor / JavaVisitor structure.
	 *
	 * Cheap single AST pass over the reference surfaces of the shipped
	 * tree-sitter-swift grammar (node shapes verified empirically — NOT
	 * guessed):
	 * - `import_declaration` → kind 'import' — one edge per statement, the
	 *   LAST name segment of the imported `identifier`
	 *   (`import class Foundation.URLSession` → 'URLSession').
	 * - `class_declaration` / `protocol_declaration` → heritage edges per
	 *   direct `inheritance_specifier` child ('extends' / 'implements' per the
	 *   declaration_kind mapping — see the class JSDoc).
	 * - `call_expression` → kind 'call' — plain `simple_identifier` or LAST
	 *   `simple_identifier` segment of a `navigation_expression`
	 *   (`helper()`, `obj.save()`, `self.update()`, `a.b.c()`); dynamic
	 *   targets (`(getFactory())()`) emit nothing.
	 *
	 * `callerName` is the enclosing function/method name (tracked by
	 * descending into function_declaration / init_declaration bodies) and null
	 * for heritage edges and imports (they belong to a declaration, not a
	 * function — Swift imports are file-scope only). `targetFile` /
	 * `targetSymbolId` are left null — name-based resolution per ADR-002
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
			case FUNCTION_DECLARATION: {
				const nameNode = node.childForFieldName("name");
				const fnName = nameNode ? nameNode.text : null;
				for (const child of node.namedChildren) {
					this.walkReferences(child, fnName ?? callerName, refs);
				}
				return;
			}
			// init_declaration: the `name` field is the keyword 'init' — thread
			// it as the enclosing caller for call edges in initializer bodies.
			case INIT_DECLARATION: {
				for (const child of node.namedChildren) {
					this.walkReferences(child, "init", refs);
				}
				return;
			}
			// Import edges (TASK-309): one 'import' edge per statement. Do NOT
			// recurse — import children are pure names, never call sites.
			case IMPORT_DECLARATION: {
				this.emitImportEdge(node, refs);
				return;
			}
			// Heritage edges: emit per direct inheritance_specifier child, then
			// recurse into the body (it contains method call sites). The
			// inheritance specifier children themselves (user_type /
			// type_identifier) are never call sites, so recursion adds nothing.
			case PROTOCOL_DECLARATION:
			case CLASS_DECLARATION: {
				this.emitHeritageEdges(node, refs);
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			// Call sites (TASK-309, optional — cheap): `helper()`,
			// `obj.save()`, `self.update()`, `a.b.c()`.
			case CALL_EXPRESSION: {
				const called = this.callTargetName(node);
				if (called) {
					refs.push({
						symbolName: called,
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
	 * Emit one 'import' edge per import_declaration (TASK-309 / Phase 1.1).
	 *
	 * Grammar (verified empirically against the shipped WASM): import_declaration
	 * has exactly one `identifier` named child — `sep1(simple_identifier, '.')`
	 * (`import UIKit` → [UIKit]; `import class Foundation.URLSession` →
	 * [Foundation, URLSession]). The import-kind keyword is ANONYMOUS (no node
	 * in the named children), so the local binding is the LAST simple segment —
	 * matching ADR-002 last-segment, name-based resolution. `callerLine` is the
	 * import statement line; `callerName` null (Swift imports are file-scope).
	 */
	private emitImportEdge(node: TSNode, refs: ParsedReference[]): void {
		const binding = this.importBindingName(node);
		if (!binding) return;
		refs.push({
			symbolName: binding,
			callerFile: "",
			callerLine: node.startPosition.row + 1,
			callerName: null,
			kind: "import"
		});
	}

	private importBindingName(node: TSNode): string | null {
		const idNode = node.namedChildren.find((c) => c.type === IDENTIFIER);
		if (!idNode) return null;
		const segments = idNode.namedChildren.filter((c) => c.type === SIMPLE_IDENTIFIER);
		const last = segments[segments.length - 1];
		return last ? last.text : null;
	}

	/**
	 * Emit heritage edges for a class / protocol declaration (TASK-309).
	 *
	 * The inheritance clause is an anonymous `:` sequence — targets are DIRECT
	 * `inheritance_specifier` children (NO inheritance_clause / class_restriction
	 * wrapper in this grammar version; verified). Kind mapping per
	 * declaration_kind — see heritageKindFor. `callerLine` = the derived type's
	 * declaration line; `callerName` null per the heritage contract.
	 */
	private emitHeritageEdges(node: TSNode, refs: ParsedReference[]): void {
		const specifiers = node.namedChildren.filter((c) => c.type === INHERITANCE_SPECIFIER);
		if (specifiers.length === 0) return;
		const isProtocol = node.type === PROTOCOL_DECLARATION;
		const declKind = node.childForFieldName("declaration_kind")?.text ?? null;
		const line = node.startPosition.row + 1;
		specifiers.forEach((spec, index) => {
			const kind = this.heritageKindFor(isProtocol, declKind, index);
			if (!kind) return;
			const target = this.heritageTargetName(spec);
			if (!target) return;
			refs.push({
				symbolName: target,
				callerFile: "",
				callerLine: line,
				callerName: null,
				kind
			});
		});
	}

	/**
	 * Map a declaration's inheritance specifier to the emitted edge kind:
	 *   - protocol_declaration → 'extends' for EVERY specifier
	 *     (`protocol P: Q, R` → P extends Q, P extends R).
	 *   - class / actor → 'extends' for the FIRST specifier (superclass),
	 *     'implements' for each SUBSEQUENT one (protocol conformances) —
	 *     position-based heuristic (C++ TASK-308 precedent; a lone first
	 *     protocol is indistinguishable from a superclass by name — ADR rule).
	 *   - struct / extension → 'implements' for every specifier (no superclass;
	 *     only conformances, `extension Foo: Proto`).
	 *   - enum → null (SKIPPED): `enum E: Int` binds the raw-value type 'Int'
	 *     with the exact same AST shape as a conformance (`CaseIterable`), and
	 *     name-based resolution cannot distinguish them (documented
	 *     limitation — enums are outside the TASK-309 heritage scope).
	 */
	private heritageKindFor(
		isProtocol: boolean,
		declKind: string | null,
		index: number
	): "extends" | "implements" | null {
		if (isProtocol) return "extends";
		switch (declKind) {
			case DECLARATION_KIND_CLASS:
			case DECLARATION_KIND_ACTOR:
				return index === 0 ? "extends" : "implements";
			case DECLARATION_KIND_STRUCT:
			case DECLARATION_KIND_EXTENSION:
				return "implements";
			case DECLARATION_KIND_ENUM:
			default:
				return null;
		}
	}

	/**
	 * Resolve the name-based heritage target (ADR-002 LAST name segment) from
	 * an inheritance_specifier: its `inherits_from` field is a `user_type`
	 * whose LAST `type_identifier` child is the target (`Base` → 'Base';
	 * `ns.Base` → 'Base'; `Base<T>` → 'Base' — type_arguments excluded).
	 * Returns null for unrecognized shapes (no edge emitted).
	 */
	private heritageTargetName(spec: TSNode): string | null {
		const inheritsFrom = spec.childForFieldName("inherits_from");
		if (!inheritsFrom) return null;
		if (inheritsFrom.type === TYPE_IDENTIFIER) return inheritsFrom.text;
		if (inheritsFrom.type === USER_TYPE) {
			const segments = inheritsFrom.namedChildren.filter((c) => c.type === TYPE_IDENTIFIER);
			const last = segments[segments.length - 1];
			return last ? last.text : null;
		}
		return null;
	}

	/**
	 * Read the referenced identifier from a call_expression (TASK-309):
	 * - `helper()`     → first named child simple_identifier → 'helper'.
	 * - `obj.save()`   → first named child navigation_expression → LAST
	 *   `simple_identifier` descendant ('save'; covers `self.update()` →
	 *   'update', `a.b.c()` → 'c', `NSObject.init()` → 'init').
	 * - `(getFactory())()` → first child is a tuple_expression (dynamic
	 *   call target) → null (the INNER call_expression still emits).
	 * Returns null for unrecognized shapes (no edge emitted).
	 */
	private callTargetName(node: TSNode): string | null {
		const fn = node.namedChildren[0];
		if (!fn) return null;
		if (fn.type === SIMPLE_IDENTIFIER) return fn.text;
		if (fn.type === NAVIGATION_EXPRESSION) {
			return this.lastSimpleIdentifier(fn);
		}
		return null;
	}

	private lastSimpleIdentifier(node: TSNode): string | null {
		let last: string | null = null;
		for (const child of node.namedChildren) {
			if (child.type === SIMPLE_IDENTIFIER) {
				last = child.text;
			} else {
				const inner = this.lastSimpleIdentifier(child);
				if (inner) last = inner;
			}
		}
		return last;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class/struct/enum body: extract methods ──────
		if (insideClass) {
			if (type === FUNCTION_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
				}
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true);
			}
			return;
		}

		// ── Function declaration ────────────────────────────────
		if (type === FUNCTION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Class declaration ───────────────────────────────────
		if (type === CLASS_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Struct ──────────────────────────────────────────────
		if (type === STRUCT_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Enum ────────────────────────────────────────────────
		if (type === ENUM_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Protocol declaration ────────────────────────────────
		if (type === PROTOCOL_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Interface, parentName));
			}
			return;
		}

		// ── Extension ───────────────────────────────────────────
		if (type === EXTENSION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Actor ───────────────────────────────────────────────
		if (type === ACTOR_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	private isExported(node: TSNode): boolean {
		for (const child of node.children) {
			if (child.type === MODIFIERS) {
				const text = child.text.trim();
				if (text === "public" || text === "open") {
					return true;
				}
			}
		}
		return false;
	}

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
			exported: this.isExported(node),
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
		if (prev && (prev.type === COMMENT || prev.type === MULTILINE_COMMENT)) {
			const text = prev.text;
			if (text.startsWith("///")) return text.replace(/^\/\/\/\s?/, "").trim();
			if (text.startsWith("/**"))
				return text
					.replace(/^\/\*\*?\s?/, "")
					.replace(/\s?\*\/$/, "")
					.trim();
		}
		return null;
	}
}
