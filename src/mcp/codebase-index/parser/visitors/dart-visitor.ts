/**
 * DartVisitor — extracts symbols and reference edges from Dart source code
 * using tree-sitter's AST.
 *
 * Symbol node type mappings:
 * - class_definition             → Class
 * - enum_declaration             → Enum
 * - function_declaration / function_signature → Function (top-level)
 * - method_signature                           → Method
 * - constructor_signature        → Method (special)
 * - extension_declaration        → Class
 * - type_alias                   → Type
 * - initialized_variable_definition → Variable
 *
 * Reference emission (TASK-311 / Phase 1.1) — node types verified EMPIRICALLY
 * against the SHIPPED tree-sitter-dart WASM (dist/grammars/tree-sitter-dart;
 * NOT guessed — live AST probes):
 * - `import` directives are `import_or_export` → `library_import` →
 *   `import_specification` → `configurable_uri` → `uri` (exports use
 *   `library_export` — skipped; `part_directive` / `part_of_directive` are
 *   separate productions). One 'import' edge per directive, symbolName = the
 *   FULL URI path with quotes stripped (`'package:foo/bar.dart'` →
 *   'package:foo/bar.dart') — mirrors the C/C++ include-path (TASK-308) and
 *   Ruby require-path (TASK-310) decisions: a library URI IS a single
 *   identifier; mapping path→symbol is query-time. The `as` prefix alias and
 *   show/hide combinators are import-selection granularity, NOT separate
 *   edges. NOTE: `deferred` imports use the alternate `import_specification`
 *   production without a `configurable_uri` → no edge either way.
 * - Heritage via DIRECT class_definition FIELDS (NO *_clause wrapper nodes in
 *   this grammar — verified): `superclass` field (node `superclass`) → one
 *   'extends' edge for the base `type_identifier` AND one 'extends' per
 *   direct `mixins` child (the `with` clause); `interfaces` field (node
 *   `interfaces`) → one 'implements' per DIRECT `type_identifier` child
 *   (type arguments of `Comparable<Animal>` are nested in `type_arguments`
 *   → never an edge). Qualified (library-prefixed) types (`extends pkg.Base`)
 *   resolve to the LAST `type_identifier` of each comma-separated segment:
 *   the hidden `_type_name` / `_type_dot_identifier` rules hoist EVERY
 *   component ('pkg' AND 'Base') as a DIRECT child, and the anonymous ','/'.'
 *   tokens are visible in raw children, so the final identifier per segment
 *   is the actual type name — the library prefix is a path component, never
 *   a heritage target (LAST-segment convention, mirrors calls here and the
 *   C/C++ TASK-308 + Ruby TASK-310 qualified-heritage decisions). Applies
 *   uniformly to the superclass base, the with-mixins list, the interfaces
 *   list, the generic `type_bound` and the mixin `on` constraint.
 *   `type_parameters` → `type_parameter` → `type_bound`
 *   → 'extends' for the class-level generic bound (mirrors the TS TASK-301
 *   generics-constraint precedent; method-level type parameters excluded).
 *   `mixin_declaration` exposes its `on` applicability constraint as a DIRECT
 *   `type_identifier` child (`mixin Jumper on Animal`) → 'extends'
 *   (inheritance-like, same decision as Ruby mixins → 'extends', TASK-310).
 * - call sites (cheap, optional per task): Dart has NO call_expression node —
 *   a call is an identifier/`this` followed by `selector` nodes; a `selector`
 *   whose FIRST named child is `argument_part` (`print('woof')`, `Dog()`,
 *   `d.bark()`) is a call → callee = the previous named sibling (plain
 *   `identifier`/`type_identifier` text, or the identifier inside a preceding
 *   `.x` `unconditional_assignable_selector`) — LAST segment convention:
 *   `g.greet('a').toUpperCase()` → 'greet'+'toUpperCase', never 'g'.
 *   `cascade_section` (`list..add(1)`) → one 'call' per `cascade_selector`
 *   that is immediately followed by an `argument_part` — bare property
 *   cascades (`list..length`, `..first`) emit nothing, mirroring the bare
 *   property-selector rule.
 *   callerName = the enclosing method/constructor/function name.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol, ReferenceKind } from "../language-visitor";
import { SymbolKind } from "../language-visitor";

const CLASS_DEFINITION = "class_definition";
const ENUM_DECLARATION = "enum_declaration";
const FUNCTION_SIGNATURE = "function_signature";
const FUNCTION_DECLARATION = "function_declaration";
const METHOD_SIGNATURE = "method_signature";
const CONSTRUCTOR_SIGNATURE = "constructor_signature";
const EXTENSION_DECLARATION = "extension_declaration";
const TYPE_ALIAS = "type_alias";
const INITIALIZED_VARIABLE_DEFINITION = "initialized_variable_definition";
const CLASS_BODY = "class_body";
const ENUM_BODY = "enum_body";
const COMMENT = "comment";

// Reference-emission node types (TASK-311 / Phase 1.1) — verified against the
// SHIPPED tree-sitter-dart WASM, NOT guessed (see header comment).
const IMPORT_OR_EXPORT = "import_or_export";
const LIBRARY_IMPORT = "library_import";
const IMPORT_SPECIFICATION = "import_specification";
const CONFIGURABLE_URI = "configurable_uri";
const URI = "uri";
const TYPE_IDENTIFIER = "type_identifier";
const IDENTIFIER = "identifier";
const MIXIN_DECLARATION = "mixin_declaration";
const MIXINS = "mixins";
const TYPE_PARAMETER = "type_parameter";
const TYPE_BOUND = "type_bound";
const SELECTOR = "selector";
const ARGUMENT_PART = "argument_part";
const UNCONDITIONAL_ASSIGNABLE_SELECTOR = "unconditional_assignable_selector";
const CASCADE_SECTION = "cascade_section";
const CASCADE_SELECTOR = "cascade_selector";
const FUNCTION_BODY = "function_body";
const GETTER_SIGNATURE = "getter_signature";
const SETTER_SIGNATURE = "setter_signature";

export class DartVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	/**
	 * Emit reference edges (TASK-311 / Phase 1.1) — library-import edges,
	 * class/mixin heritage (extends / implements / with) and call sites.
	 * See the header JSDoc for the verified grammar node mappings and
	 * edge-kind decisions.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		if (!tree) return refs;
		this.walkReferences(tree.rootNode, refs, null);
		return refs;
	}

	/**
	 * Reference walker — mirrors walkNode's traversal shape (same child
	 * recursion + caller threading) so symbol extraction and reference
	 * emission stay independent. The import/heritage/call cases emit edges
	 * and then fall through to the shared recursion, so no node is visited
	 * twice and call sites nested in bodies are still reached.
	 */
	private walkReferences(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
		const type = node.type;

		// ── Import directive → one 'import' edge ──
		if (type === IMPORT_OR_EXPORT) {
			this.emitImportEdge(node, refs);
		}

		// ── Class / mixin heritage → 'extends' + 'implements' edges ──
		if (type === CLASS_DEFINITION || type === MIXIN_DECLARATION) {
			this.emitHeritage(node, refs);
		}

		// ── Call sites: a selector whose first named child is an argument
		//    list is a call; cascades are their own node type ──
		if (type === SELECTOR) {
			this.emitCallFromSelector(node, refs, callerName);
		} else if (type === CASCADE_SECTION) {
			this.emitCallFromCascade(node, refs, callerName);
		}

		// ── Caller tracking: in this grammar the signature and the body are
		//    SIBLINGS (verified — method_signature/function_signature are
		//    followed by a sibling function_body), so the enclosing name is
		//    read from the body's PREVIOUS named sibling ──
		if (type === FUNCTION_BODY) {
			const prev = node.previousNamedSibling;
			const name =
				prev && (prev.type === METHOD_SIGNATURE || prev.type === FUNCTION_SIGNATURE)
					? (this.signatureName(prev) ?? callerName)
					: callerName;
			for (const child of node.namedChildren) {
				this.walkReferences(child, refs, name);
			}
			return;
		}

		for (const child of node.namedChildren) {
			this.walkReferences(child, refs, callerName);
		}
	}

	// ── Reference-emission helpers (TASK-311 / Phase 1.1) ──────────────────

	private pushRef(
		refs: ParsedReference[],
		symbolName: string,
		callerLine: number,
		callerName: string | null,
		kind: ReferenceKind
	): void {
		// Targets stay null per the TASK-299 ParsedReference heritage contract —
		// edges are name-based; ADR-002 resolution happens downstream. Explicit
		// null (not undefined) so strict toBeNull assertions hold (TASK-347).
		refs.push({ symbolName, callerFile: "", callerLine, callerName, kind, targetFile: null, targetSymbolId: null });
	}

	/**
	 * Resolve the declared name of a signature node. `method_signature`
	 * WRAPS the real signature (constructor/getter/setter/function — verified:
	 * the `name` field lives on the inner node), while a bare
	 * `function_signature` carries it directly.
	 */
	private signatureName(sigNode: TSNode): string | null {
		const inner =
			sigNode.type === METHOD_SIGNATURE
				? sigNode.namedChildren.find(
						(c) =>
							c.type === CONSTRUCTOR_SIGNATURE ||
							c.type === GETTER_SIGNATURE ||
							c.type === SETTER_SIGNATURE ||
							c.type === FUNCTION_SIGNATURE
					)
				: sigNode;
		return inner?.childForFieldName("name")?.text ?? null;
	}

	/**
	 * Emit one 'import' edge per `import 'uri';` directive. Verified grammar
	 * (shipped WASM): the directive is `import_or_export` whose `library_import`
	 * child (imports only — exports use `library_export` and parts use
	 * `part_directive`/`part_of_directive`) wraps `import_specification` →
	 * `configurable_uri` → `uri` whose text includes the quotes. symbolName =
	 * the FULL URI path with quotes stripped (a library URI is a single
	 * identifier; path→symbol mapping is query-time — C/C++ + Ruby precedent).
	 * The `as` alias and show/hide combinators are import-selection granularity,
	 * not separate edges. callerLine = the directive line; callerName null.
	 */
	private emitImportEdge(node: TSNode, refs: ParsedReference[]): void {
		const libraryImport = node.namedChildren.find((c) => c.type === LIBRARY_IMPORT);
		if (!libraryImport) return; // export / part — not an import
		const spec = libraryImport.namedChildren.find((c) => c.type === IMPORT_SPECIFICATION);
		const configurable = spec?.namedChildren.find((c) => c.type === CONFIGURABLE_URI);
		const uri = configurable?.namedChildren.find((c) => c.type === URI);
		if (!uri) return;
		const raw = uri.text;
		const name = raw.length >= 2 && (raw.startsWith("'") || raw.startsWith('"')) ? raw.slice(1, -1) : raw;
		if (!name) return;
		this.pushRef(refs, name, node.startPosition.row + 1, null, "import");
	}

	/**
	 * Emit heritage edges for a class_definition / mixin_declaration:
	 * - superclass field → 'extends' for the base `type_identifier` plus one
	 *   'extends' per `mixins` (with-clause) target — mixins are
	 *   inheritance-like heritage (task decision, mirrors Ruby TASK-310);
	 * - interfaces field → one 'implements' per DIRECT `type_identifier` child
	 *   (`implements Barkable, Playable`); type arguments (`Comparable<Animal>`)
	 *   are nested in `type_arguments` and never become edges;
	 * - class-level type_parameters → 'extends' for the `type_bound` target
	 *   (mirrors TS TASK-301 generics constraint; method-level bounds excluded);
	 * - mixin_declaration `on` applicability constraint (a DIRECT
	 *   `type_identifier` child) → 'extends'.
	 * Qualified (library-prefixed) names resolve to the LAST `type_identifier`
	 * per comma-separated segment via emitTypeList — see its JSDoc.
	 * callerLine = the declaration line; callerName null per the heritage
	 * contract (language-visitor.ts:22).
	 */
	private emitHeritage(node: TSNode, refs: ParsedReference[]): void {
		const line = node.startPosition.row + 1;

		if (node.type === CLASS_DEFINITION) {
			const superclass = node.childForFieldName("superclass");
			if (superclass) {
				// Base type (LAST segment — `extends pkg.Base` → 'Base'). The
				// `with` mixins node is a separate NAMED child: its internal
				// type_identifiers are not direct children of `superclass`, so
				// emitTypeList can never pick them up as base segments.
				this.emitTypeList(superclass, refs, line, "extends");
				const mixins = superclass.namedChildren.find((c) => c.type === MIXINS);
				if (mixins) {
					this.emitTypeList(mixins, refs, line, "extends");
				}
			}
			const interfaces = node.childForFieldName("interfaces");
			if (interfaces) {
				this.emitTypeList(interfaces, refs, line, "implements");
			}
			const typeParams = node.childForFieldName("type_parameters");
			if (typeParams) {
				for (const tp of typeParams.namedChildren) {
					if (tp.type !== TYPE_PARAMETER) continue;
					const bound = tp.namedChildren.find((c) => c.type === TYPE_BOUND);
					if (bound) this.emitTypeList(bound, refs, line, "extends");
				}
			}
		} else {
			// mixin_declaration: the `on` applicability constraint is a DIRECT
			// `_type_not_void_list` of the declaration node itself (`mixin Jumper
			// on Animal`) — the hoisted type_identifiers plus anonymous ','/'.'
			// tokens are raw children, while the mixin NAME is an `identifier`
			// node and type_parameters/interfaces nest their tids, so only the
			// on-targets can match. One 'extends' per on-target (LAST segment).
			this.emitTypeList(node, refs, line, "extends");
		}
	}

	/**
	 * Emit one edge per comma-separated type segment of a container node,
	 * using the LAST `type_identifier` of each segment. tree-sitter-dart's
	 * hidden `_type_name` / `_type_dot_identifier` rules (grammar.js:2216-2249,
	 * verified against the shipped WASM) hoist EVERY component of a qualified
	 * (library-prefixed) type as a DIRECT `type_identifier` child (`extends
	 * pkg.Base` → 'pkg' AND 'Base'), while the anonymous ',' and '.' tokens
	 * ARE visible in raw children — so ',' marks a segment boundary and the
	 * final identifier of each segment is the actual type name. The library
	 * prefix is a path component, never a heritage target (LAST-segment
	 * convention — mirrors call sites here and the C/C++ + Ruby
	 * qualified-heritage decisions). Nested nodes (`type_arguments` for
	 * `Comparable<Animal>`, the `mixins` with-clause) are not
	 * type_identifiers and are ignored, so generic targets still emit only
	 * the outer type.
	 */
	private emitTypeList(node: TSNode, refs: ParsedReference[], line: number, kind: ReferenceKind): void {
		let last: TSNode | null = null;
		for (const child of node.children) {
			if (child.type === TYPE_IDENTIFIER) {
				last = child;
			} else if (child.type === ",") {
				if (last) this.pushRef(refs, last.text, line, null, kind);
				last = null;
			}
		}
		if (last) this.pushRef(refs, last.text, line, null, kind);
	}

	/**
	 * Emit a 'call' edge when a `selector` node is an argument list
	 * (`print('woof')`, `Dog()`, `d.bark()`). A call iff the selector's FIRST
	 * named child is `argument_part` — bare property selectors (`.greet`
	 * without `()`) are never calls. Callee (LAST segment): the previous named
	 * sibling when it is a plain `identifier`/`type_identifier`, or the
	 * identifier inside a preceding `.x` `unconditional_assignable_selector`
	 * (`.bark` → 'bark', `g.greet('a').toUpperCase()` → 'toUpperCase' — the
	 * receiver `g` is a path component, never an edge). Generic calls
	 * (`foo<num>(1)`) carry the type_arguments INSIDE the argument_part, so
	 * the plain-identifier branch resolves them.
	 */
	private emitCallFromSelector(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
		const first = node.namedChildren[0];
		if (!first || first.type !== ARGUMENT_PART) return;
		const line = node.startPosition.row + 1;
		const prev = node.previousNamedSibling;
		let name: string | null = null;
		if (prev) {
			if (prev.type === IDENTIFIER || prev.type === TYPE_IDENTIFIER) {
				name = prev.text;
			} else if (prev.type === SELECTOR) {
				const inner = prev.namedChildren.find((c) => c.type === UNCONDITIONAL_ASSIGNABLE_SELECTOR);
				const innerId = inner?.namedChildren.find((c) => c.type === IDENTIFIER);
				if (innerId) name = innerId.text;
			}
		}
		if (name) this.pushRef(refs, name, line, callerName, "call");
	}

	/**
	 * Emit a 'call' edge per `cascade_section` (`list..add(1)..add(2)`) — the
	 * Flutter-style cascade is its own node type. A cascade is a CALL only
	 * when the `cascade_selector` is IMMEDIATELY followed by an `argument_part`
	 * named sibling (`..add(1)`) — mirror of emitCallFromSelector. Bare
	 * property cascades (`list..length`, `..first`) carry no argument list and
	 * emit nothing, matching the bare property-selector convention; null-aware
	 * cascades (`list?..add(3)`) share the same shape. Callee = the
	 * `cascade_selector` identifier (LAST segment — the receiver is a path
	 * component, never an edge).
	 */
	private emitCallFromCascade(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
		const kids = node.namedChildren;
		const selIdx = kids.findIndex((c) => c.type === CASCADE_SELECTOR);
		if (selIdx < 0) return;
		const next = kids[selIdx + 1];
		if (!next || next.type !== ARGUMENT_PART) return;
		const id = kids[selIdx].namedChildren.find((c) => c.type === IDENTIFIER);
		if (id) this.pushRef(refs, id.text, node.startPosition.row + 1, callerName, "call");
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class/enum body: extract methods ─────────────
		if (insideClass) {
			if (type === METHOD_SIGNATURE || type === CONSTRUCTOR_SIGNATURE) {
				const nameNode = node.namedChildren.find((c) => c.type === "identifier");
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

		// ── Class definition ────────────────────────────────────
		if (type === CLASS_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Enum declaration ────────────────────────────────────
		if (type === ENUM_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
				const body = node.namedChildren.find((c) => c.type === ENUM_BODY || c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Top-level function ──────────────────────────────────
		if (type === FUNCTION_DECLARATION || type === FUNCTION_SIGNATURE) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Extension declaration ───────────────────────────────
		if (type === EXTENSION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
			}
			return;
		}

		// ── Type alias ──────────────────────────────────────────
		if (type === TYPE_ALIAS) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Initialized variable definition (top-level) ─────────
		if (type === INITIALIZED_VARIABLE_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
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
			exported: false,
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
			return prev.text
				.replace(/^\/\/\/\s?/, "")
				.replace(/^\/\/\s?/, "")
				.trim();
		}
		return null;
	}
}
