/**
 * KotlinVisitor — extracts symbols from Kotlin source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_declaration → Function
 * - class_declaration    → Class (interfaces/enums are the same node with an
 *                          anonymous `interface`/`enum` token child — see TASK-131)
 * - interface            → Interface
 * - type_alias           → Type
 * - variable_declaration → Variable
 *
 * Reference emission (TASK-304 / Phase 1.1) — node types verified empirically
 * against the shipped tree-sitter-kotlin v0.3.8 WASM (NOT guessed):
 * - `import_list` → `import_header` children → `import` edges per binding
 *   (alias wins, else LAST segment; wildcard imports emit nothing).
 * - `delegation_specifier` DIRECT children of class_declaration /
 *   object_declaration / companion_object → `extends` / `implements` edges.
 * - `type_parameters` → `type_parameter` bounds + `type_constraints` (where
 *   clause) → `extends` edges (mirrors the TS generics-constraint handling).
 * - `call_expression` → `call` edges (enclosing function as callerName).
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";

const FUNCTION_DECLARATION = "function_declaration";
const CLASS_DECLARATION = "class_declaration";
const TYPE_ALIAS = "type_alias";
const VARIABLE_DECLARATION = "variable_declaration";
const CLASS_BODY = "class_body";
const MODIFIERS = "modifiers";
const LINE_COMMENT = "line_comment";
const BLOCK_COMMENT = "block_comment";

// Reference-emission node types (TASK-304 / Phase 1.1).
const IMPORT_LIST = "import_list";
const IMPORT_HEADER = "import_header";
const IMPORT_ALIAS = "import_alias";
const WILDCARD_IMPORT = "wildcard_import";
const IDENTIFIER = "identifier";
const SIMPLE_IDENTIFIER = "simple_identifier";
const DELEGATION_SPECIFIER = "delegation_specifier";
const CONSTRUCTOR_INVOCATION = "constructor_invocation";
const EXPLICIT_DELEGATION = "explicit_delegation";
const USER_TYPE = "user_type";
const TYPE_IDENTIFIER = "type_identifier";
const TYPE_PARAMETERS = "type_parameters";
const TYPE_PARAMETER = "type_parameter";
const TYPE_CONSTRAINTS = "type_constraints";
const TYPE_CONSTRAINT = "type_constraint";
const OBJECT_DECLARATION = "object_declaration";
const COMPANION_OBJECT = "companion_object";
const CALL_EXPRESSION = "call_expression";
const NAVIGATION_EXPRESSION = "navigation_expression";
const NAVIGATION_SUFFIX = "navigation_suffix";

export class KotlinVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	/**
	 * Emit call-site references + import and heritage edges (TASK-304 /
	 * Phase 1.1), mirroring the PhpVisitor / TypeScriptVisitor structure.
	 *
	 * Cheap single AST pass over the obvious reference surfaces in the
	 * tree-sitter-kotlin grammar:
	 * - `import_header` (children of `import_list`) → kind 'import' — one edge
	 *   per binding: the `as` alias when present (`import foo.Bar as Baz` →
	 *   'Baz'), else the LAST segment of the imported name (`import foo.Bar`
	 *   → 'Bar'); wildcard imports (`import java.util.*`) emit nothing.
	 * - `delegation_specifier` (direct children of class_declaration /
	 *   object_declaration / companion_object) → kind 'extends'/'implements'
	 *   per the derived type's supertype list (see emitHeritage for the
	 *   per-declaration-kind assignment).
	 * - `type_parameters` bounds + `type_constraints` (where clause) → kind
	 *   'extends' (declaration-level generics constraints only — mirrors
	 *   TASK-301 TS handling; method-level type params excluded).
	 * - `call_expression` → kind 'call' (`helper()`, `ns.thing().other()` →
	 *   both 'thing' and 'other', `super.go()` → 'go').
	 *
	 * `callerName` is the enclosing function/method name, tracked by descending
	 * into function_declaration bodies, and null for heritage edges and
	 * imports (they belong to a declaration, not a function). `targetFile` /
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
				const nameNode = node.namedChildren.find((c) => c.type === SIMPLE_IDENTIFIER);
				const fnName = nameNode ? nameNode.text : null;
				for (const child of node.namedChildren) {
					this.walkReferences(child, fnName ?? callerName, refs);
				}
				return;
			}
			// Import edges (TASK-304): one 'import' reference per import_header
			// binding. Do NOT recurse — import children are pure names, never
			// call sites (mirrors the TS/PHP import emission surface).
			case IMPORT_LIST: {
				this.emitImportEdges(node, refs);
				return;
			}
			// Heritage edges: emit 'extends'/'implements' for the declaration's
			// supertypes + generic bounds, then recurse into the body so
			// call-site refs inside members still emit (purely additive).
			case CLASS_DECLARATION: {
				this.emitHeritage(node, refs);
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			// Objects/companions can only implement interfaces in Kotlin, so
			// every supertype is an 'implements' edge.
			case OBJECT_DECLARATION:
			case COMPANION_OBJECT: {
				this.emitObjectHeritage(node, refs);
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
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
	 * Emit one 'import' reference edge per binding in an `import_list`
	 * (TASK-304 / Phase 1.1).
	 *
	 * Grammar (verified empirically against the shipped tree-sitter-kotlin
	 * v0.3.8 WASM): the import_list holds one `import_header` per import
	 * statement. Each header wraps an `identifier` chain of `simple_identifier`
	 * segments (`import foo.bar.Baz` → foo, bar, Baz), an optional
	 * `import_alias` (`import foo.bar.Qux as Quux` → alias node wrapping a
	 * `type_identifier`), and an optional `wildcard_import` (`import a.b.*`).
	 *
	 * The referenced symbol is the LOCAL BINDING per Kotlin semantics — the
	 * `as` alias when present (`as Quux` → 'Quux'), otherwise the LAST name
	 * segment (`foo.bar.Baz` → 'Baz'), matching ADR-002 last-segment,
	 * name-based resolution. `callerLine` is the import statement line;
	 * `callerName` is null (Kotlin imports are top-level).
	 */
	private emitImportEdges(node: TSNode, refs: ParsedReference[]): void {
		for (const header of node.namedChildren) {
			if (header.type !== IMPORT_HEADER) continue;
			const binding = this.importBindingName(header);
			if (!binding) continue;
			refs.push({
				symbolName: binding,
				callerFile: "",
				callerLine: header.startPosition.row + 1,
				callerName: null,
				kind: "import"
			});
		}
	}

	/**
	 * Resolve the local binding name of an import_header: the `as` alias when
	 * present (`import foo.Bar as Baz` → 'Baz'), otherwise the LAST name
	 * segment of the imported name (`import foo.bar.Baz` → 'Baz'). Returns
	 * null for wildcard imports (`import a.b.*` → no binding) and unparsed
	 * headers.
	 */
	private importBindingName(header: TSNode): string | null {
		if (header.namedChildren.some((c) => c.type === WILDCARD_IMPORT)) return null;
		const aliasNode = header.namedChildren.find((c) => c.type === IMPORT_ALIAS);
		if (aliasNode) {
			const aliasId = aliasNode.namedChildren.find((c) => c.type === TYPE_IDENTIFIER);
			if (aliasId) return aliasId.text;
		}
		const identNode = header.namedChildren.find((c) => c.type === IDENTIFIER);
		if (!identNode) return null;
		const segments = identNode.namedChildren.filter((c) => c.type === SIMPLE_IDENTIFIER);
		const last = segments[segments.length - 1];
		return last?.text ?? null;
	}

	/**
	 * Emit 'extends' / 'implements' heritage edges for a class_declaration
	 * (TASK-304, Phase 1.1).
	 *
	 * Grammar (tree-sitter-kotlin v0.3.8, verified empirically against the
	 * shipped WASM): Kotlin has NO separate interface/enum declaration node —
	 * `interface`, `enum` and `class` are anonymous (raw) token children of
	 * `class_declaration` (TASK-131 pattern). Supertypes are `delegation_specifier`
	 * nodes that are DIRECT children of the declaration (siblings of the
	 * type_identifier and class_body — NOT nested inside class_body); each
	 * specifier wraps a `constructor_invocation` (superclass call `Base("x")`),
	 * a `user_type` (interface `IFoo`, generic `Repo<Item>`, qualified
	 * `com.acme.Nested`), or an `explicit_delegation` (`Base by base`).
	 *
	 * Per-declaration-kind assignment (name-based per ADR-002 — no type
	 * resolution at parse time):
	 * - `interface`  → EVERY supertype is 'extends' (interfaces extend).
	 * - `enum`       → EVERY supertype is 'implements' (enums can only
	 *   implement interfaces per the Kotlin language rules).
	 * - class (default, incl. data/sealed/value/annotation/inner) → the FIRST
	 *   delegation_specifier is 'extends' (the primary superclass slot),
	 *   subsequent specifiers are 'implements' (interface slot) — position
	 *   heuristic per the TASK-304 spec; a lone `class X : SomeInterface`
	 *   (interface with no superclass) is therefore tagged 'extends' since
	 *   the visitor cannot distinguish class vs interface by name.
	 *
	 * Declaration-level generic bounds are also heritage-like: `type_parameters`
	 * → `type_parameter` trailing `user_type` (`class Box<T : Storable>`) and
	 * `type_constraints` → `type_constraint` (`where T : C`) emit 'extends'
	 * (mirrors TASK-301 TS constraint edges). Method-level type params are
	 * excluded (out of heritage scope). `callerName` is null per the
	 * ParsedReference heritage contract.
	 */
	private emitHeritage(node: TSNode, refs: ParsedReference[]): void {
		const line = node.startPosition.row + 1;
		const rawTokens = new Set(node.children.map((c) => c.type));
		const isInterface = rawTokens.has("interface");
		const isEnum = rawTokens.has("enum");

		// Declaration-level generic bounds → 'extends'.
		for (const child of node.namedChildren) {
			if (child.type === TYPE_PARAMETERS) {
				for (const tp of child.namedChildren) {
					if (tp.type === TYPE_PARAMETER) this.emitBoundEdges(tp, line, refs);
				}
			} else if (child.type === TYPE_CONSTRAINTS) {
				for (const tc of child.namedChildren) {
					if (tc.type === TYPE_CONSTRAINT) this.emitBoundEdges(tc, line, refs);
				}
			}
		}

		// Supertype delegation specifiers → 'extends'/'implements'.
		const specifiers = node.namedChildren.filter((c) => c.type === DELEGATION_SPECIFIER);
		if (isInterface) {
			for (const spec of specifiers) this.emitSupertypeEdge(spec, "extends", line, refs);
		} else if (isEnum) {
			for (const spec of specifiers) this.emitSupertypeEdge(spec, "implements", line, refs);
		} else {
			specifiers.forEach((spec, index) =>
				this.emitSupertypeEdge(spec, index === 0 ? "extends" : "implements", line, refs)
			);
		}
	}

	/**
	 * Emit heritage edges for an object_declaration or companion_object.
	 * Kotlin objects/companions can only implement interfaces (their supertype
	 * list holds no superclass slot), so EVERY delegation_specifier is an
	 * 'implements' edge.
	 */
	private emitObjectHeritage(node: TSNode, refs: ParsedReference[]): void {
		const line = node.startPosition.row + 1;
		for (const spec of node.namedChildren) {
			if (spec.type === DELEGATION_SPECIFIER) this.emitSupertypeEdge(spec, "implements", line, refs);
		}
	}

	/** Emit a single 'extends'/'implements' edge for one delegation_specifier. */
	private emitSupertypeEdge(spec: TSNode, kind: "extends" | "implements", line: number, refs: ParsedReference[]): void {
		const name = this.delegationTargetName(spec);
		if (!name) return;
		refs.push({
			symbolName: name,
			callerFile: "",
			callerLine: line,
			callerName: null,
			kind
		});
	}

	/**
	 * Emit 'extends' edges for the generic bounds of a type_parameter or
	 * type_constraint node (`<T : Storable>` / `where T : C`). The bound
	 * parameter's own type_identifier is the param NAME, not a heritage
	 * target — the trailing `user_type` child(ren) are the bounds.
	 */
	private emitBoundEdges(holder: TSNode, line: number, refs: ParsedReference[]): void {
		for (const child of holder.namedChildren) {
			if (child.type === TYPE_IDENTIFIER) continue;
			const name = this.userTypeName(child);
			if (!name) continue;
			refs.push({
				symbolName: name,
				callerFile: "",
				callerLine: line,
				callerName: null,
				kind: "extends"
			});
		}
	}

	/**
	 * Resolve the name-based target of a delegation_specifier (the referenced
	 * supertype). The specifier wraps one of:
	 * - `constructor_invocation` → `Base("x")` — the superclass call; inner
	 *   `user_type` holds the class name.
	 * - `user_type` → `IFoo` / `Repo<Item>` / `com.acme.Nested` — interface.
	 * - `explicit_delegation` → `Base by base` — class delegation; inner
	 *   `user_type` holds the class name.
	 *
	 * Per ADR-002 (name-based, no LSP) the edge references the LAST name
	 * segment of the supertype as written (`com.acme.Nested` → 'Nested').
	 */
	private delegationTargetName(spec: TSNode): string | null {
		const inner = spec.namedChildren[0];
		if (!inner) return null;
		if (inner.type === CONSTRUCTOR_INVOCATION || inner.type === EXPLICIT_DELEGATION) {
			const ut = inner.namedChildren.find((c) => c.type === USER_TYPE);
			return ut ? this.userTypeName(ut) : null;
		}
		if (inner.type === USER_TYPE) return this.userTypeName(inner);
		return null;
	}

	/**
	 * Resolve a user_type node to its LAST direct type_identifier child.
	 *
	 * `user_type` direct children are the identifier segments of a possibly
	 * qualified type (`com.acme.Nested` → com, acme, deep, Nested → 'Nested')
	 * plus an optional trailing `type_arguments` node (`Repo<Item>` → Repo,
	 * type_arguments — the Item identifier is nested one level deeper and is
	 * NOT a direct child, so it is never picked). Returns null for unparsed
	 * types.
	 */
	private userTypeName(node: TSNode): string | null {
		const ids = node.namedChildren.filter((c) => c.type === TYPE_IDENTIFIER);
		const last = ids[ids.length - 1];
		return last?.text ?? null;
	}

	/**
	 * Read the referenced identifier from a call_expression:
	 * - `helper()`        → direct `simple_identifier` child → 'helper'.
	 * - `bar.baz()`       → `navigation_expression` → pierce to the LAST
	 *   navigation suffix → 'baz' (also covers `x?.y?.z()` → 'z',
	 *   `super.go()` → 'go', `this.go()` → 'go', `ns.x().y()` → 'y' — the
	 *   inner `x()` call is caught by recursion into children).
	 * Returns null for dynamic/indexed targets (`list[0]()`), which we can't
	 * index (mirrors the PHP `$fn()` skip).
	 */
	private callTargetName(node: TSNode): string | null {
		const first = node.namedChildren[0];
		if (!first) return null;
		if (first.type === SIMPLE_IDENTIFIER) return first.text;
		if (first.type === NAVIGATION_EXPRESSION) return this.navigationTargetName(first);
		return null;
	}

	/** Pierce a navigation_expression chain to its last segment name. */
	private navigationTargetName(node: TSNode): string | null {
		let cur = node;
		while (cur.type === NAVIGATION_EXPRESSION) {
			const last = cur.namedChildren[cur.namedChildren.length - 1];
			if (!last) break;
			cur = last;
		}
		if (cur.type === NAVIGATION_SUFFIX) {
			const ids = cur.namedChildren.filter((c) => c.type === SIMPLE_IDENTIFIER);
			const last = ids[ids.length - 1];
			return last?.text ?? null;
		}
		if (cur.type === SIMPLE_IDENTIFIER) return cur.text;
		return null;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class body: extract methods ──────────────────
		if (insideClass) {
			if (type === FUNCTION_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
				}
				return;
			}
			if (type === CLASS_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier" || c.type === "type_identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
					const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
					if (body) {
						this.walkNode(body, symbols, nameNode.text, true);
					}
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

		// ── Class/Interface declaration (tree-sitter-kotlin uses class_declaration for both) ──
		if (type === CLASS_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier" || c.type === "type_identifier");
			if (nameNode) {
				// TASK-131: tree-sitter-kotlin emits `interface` as a raw (unnamed)
				// token direct child of class_declaration. Scan node.children so
				// preceding modifiers/annotations (e.g. `internal interface Foo`,
				// `@Ann interface Foo`) do not break detection — the old
				// `node.text.startsWith("interface")` check only matched when the
				// `interface` keyword was the very first character of the node.
				const isInterface = node.children.some((c) => c.type === "interface");
				const kind = isInterface ? SymbolKind.Interface : SymbolKind.Class;
				symbols.push(this.makeSymbol(node, nameNode.text, kind, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Type alias ──────────────────────────────────────────
		if (type === TYPE_ALIAS) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Variable declaration ────────────────────────────────
		if (type === VARIABLE_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Variable, parentName));
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	private isPublic(node: TSNode): boolean {
		for (const child of node.children) {
			if (child.type === MODIFIERS && child.text.includes("public")) {
				return true;
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
			exported: this.isPublic(node),
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
		if (prev && (prev.type === BLOCK_COMMENT || prev.type === LINE_COMMENT)) {
			const text = prev.text;
			if (text.startsWith("/**")) {
				return text
					.replace(/^\/\*\*?\s?/, "")
					.replace(/\s?\*\/$/, "")
					.trim();
			}
		}
		return null;
	}
}
