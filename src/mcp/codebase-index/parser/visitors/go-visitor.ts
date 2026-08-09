/**
 * GoVisitor — extracts symbols from Go source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_declaration → Function
 * - method_declaration   → Method (signature includes the receiver)
 * - type_spec (struct_type) → Class (field_declaration → Variable, parented to the struct)
 * - type_spec (interface_type) → Interface (method_elem → Method with full signature)
 *  - type_spec (other)    → Type
 *  - const_declaration (const_spec) → Constant (incl. iota blocks)
 *
 * Export convention: names starting with uppercase are exported.
 *
 * Reference emission (TASK-306 / Phase 1.1) — node types verified EMPIRICALLY
 * against the shipped tree-sitter-go WASM (NOT guessed):
 * - `import_declaration` (single `import_spec` or grouped `import_spec_list`)
 *   → one 'import' edge per import_spec binding: the explicit alias when
 *   present (`import alias "strings"` → 'alias'), else the LAST path segment
 *   (`import "net/http"` → 'http'); blank (`_ "embed"`) and dot (`. "fmt"`)
 *   imports emit NOTHING (no binding name).
 * - `interface_type` `type_elem` children → one 'extends' edge per embedded
 *   interface (`interface I { J }` → I extends J; interface embeds =
 *   extends semantics per spec). Embedded qualified types resolve to the LAST
 *   name segment (`io.Reader` → 'Reader'). interface `method_elem` children
 *   and union/approximation elements (`~int | ~string`, `int | string`)
 *   emit nothing.
 * - `struct_type` anonymous field_declaration (NO `name` field — `Base`,
 *   `*Mutex`, `sync.RWMutex`, `Base[T]`) → one 'extends' edge per embedded
 *   type (struct embeds = composition with inheritance semantics).
 *   Named fields (`ID int`, `name string`) emit nothing.
 * - `call_expression` → 'call' edges (`helper()` → 'helper', `obj.Save()` →
 *   'Save' LAST segment).
 *
 * Go has NO declarative implements — explicit interface satisfaction is a
 * structural, compiler-enforced property, NOT statically declared in source.
 * Out of scope per the TASK-306 spec; only explicit embedding edges +
 * imports + calls are emitted (reported in the task).
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";

const FUNCTION_DECLARATION = "function_declaration";
const METHOD_DECLARATION = "method_declaration";
const TYPE_DECLARATION = "type_declaration";
const TYPE_SPEC = "type_spec";
const STRUCT_TYPE = "struct_type";
const INTERFACE_TYPE = "interface_type";
const FIELD_DECLARATION = "field_declaration";
const FIELD_DECLARATION_LIST = "field_declaration_list";
const METHOD_ELEM = "method_elem";
const CONST_DECLARATION = "const_declaration";
const CONST_SPEC = "const_spec";
const COMMENT = "comment";

// Reference-emission node types (TASK-306 / Phase 1.1).
const IMPORT_DECLARATION = "import_declaration";
const IMPORT_SPEC = "import_spec";
const IMPORT_SPEC_LIST = "import_spec_list";
const PACKAGE_IDENTIFIER = "package_identifier";
const TYPE_IDENTIFIER = "type_identifier";
const QUALIFIED_TYPE = "qualified_type";
const TYPE_ELEM = "type_elem";
const NEGATED_TYPE = "negated_type";
const CALL_EXPRESSION = "call_expression";
const SELECTOR_EXPRESSION = "selector_expression";
const IDENTIFIER = "identifier";

export class GoVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false, false);
		return symbols;
	}

	// ── Reference emission (TASK-306 / Phase 1.1) ─────────────────

	/**
	 * Emit reference edges (TASK-306 / Phase 1.1), mirroring the
	 * PythonVisitor / TypeScriptVisitor / JavaVisitor structure.
	 *
	 * Cheap single AST pass over the reference surfaces of the
	 * tree-sitter-go grammar:
	 * - `import_declaration` → kind 'import' — one edge per import_spec
	 *   binding: the explicit alias when present, else the LAST path segment;
	 *   blank (`_`) and dot (`.`) imports emit nothing.
	 * - `interface_type` `type_elem` children → kind 'extends' per embedded
	 *   interface (interface embeds = extends semantics).
	 * - `struct_type` anonymous `field_declaration` (no `name` field) →
	 *   kind 'extends' per embedded type (struct embeds Bar/Baz).
	 * - `call_expression` → kind 'call' (`helper()`, `obj.Save()`,
	 *   `fmt.Println()` — LAST segment for member calls).
	 *
	 * `callerName` is the enclosing function/method name (tracked by
	 * descending into function/method declaration bodies) and null for
	 * heritage edges and imports (they belong to a declaration, not a
	 * function — Go imports are package-level only). `targetFile` /
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
			// Track the enclosing function name for call-site edges, then
			// recurse into the body (identical to the default branch).
			case FUNCTION_DECLARATION: {
				const nameNode = node.namedChildren.find((c) => c.type === IDENTIFIER);
				const fnName = nameNode ? nameNode.text : null;
				for (const child of node.namedChildren) {
					this.walkReferences(child, fnName ?? callerName, refs);
				}
				return;
			}
			// Track the enclosing method name (receiver function).
			case METHOD_DECLARATION: {
				const nameNode = node.childForFieldName("name");
				const fnName = nameNode ? nameNode.text : null;
				for (const child of node.namedChildren) {
					this.walkReferences(child, fnName ?? callerName, refs);
				}
				return;
			}
			// Import edges (TASK-306): one 'import' reference per
			// import_spec. Do NOT recurse — import children are pure names,
			// never call sites (mirrors the TS/Python emission surface).
			case IMPORT_DECLARATION: {
				this.emitImportEdges(node, refs);
				return;
			}
			// Heritage edges: emit 'extends' per embedded interface / struct
			// type, then recurse (type bodies never contain call sites, but
			// the traversal stays identical to the default branch — purely
			// additive).
			case TYPE_DECLARATION: {
				const spec = node.namedChildren.find((c) => c.type === TYPE_SPEC);
				if (spec) {
					const typeNode = spec.childForFieldName("type");
					if (typeNode?.type === STRUCT_TYPE) {
						this.emitStructEmbeds(typeNode, spec, refs);
					} else if (typeNode?.type === INTERFACE_TYPE) {
						this.emitInterfaceEmbeds(typeNode, spec, refs);
					}
				}
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			// Call sites (TASK-306, optional — cheap): `helper()`,
			// `obj.Save()`, `fmt.Println()`.
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
	 * Emit one 'import' reference edge per import_spec (TASK-306 / Phase 1.1).
	 *
	 * Grammar (verified empirically against the shipped tree-sitter-go WASM):
	 * import_declaration has a single `import_spec` child for the plain form
	 * (`import "fmt"`) or an `import_spec_list` for the grouped form
	 * (`import ( ... )`). Each import_spec has an optional `name` field
	 * (package_identifier = explicit alias, blank_identifier = `_`, dot =
	 * `.`) and a REQUIRED `path` field (string literal).
	 *
	 * The referenced symbol is the LOCAL BINDING per Go semantics — the
	 * explicit alias when present (`import s "sync"` → 's'), otherwise the
	 * LAST segment of the import path (`import "net/http"` → 'http'),
	 * matching ADR-002 last-segment, name-based resolution. Blank imports
	 * (`_ "embed"` — side-effect only, no binding) and dot imports
	 * (`. "fmt"` — no named binding) emit NOTHING. `callerLine` is the
	 * import_spec line (the binding site); `callerName` is null (Go imports
	 * are package-level only).
	 */
	private emitImportEdges(node: TSNode, refs: ParsedReference[]): void {
		for (const child of node.namedChildren) {
			if (child.type === IMPORT_SPEC) {
				this.emitImportSpec(child, refs);
			} else if (child.type === IMPORT_SPEC_LIST) {
				for (const spec of child.namedChildren) {
					if (spec.type === IMPORT_SPEC) {
						this.emitImportSpec(spec, refs);
					}
				}
			}
		}
	}

	private emitImportSpec(spec: TSNode, refs: ParsedReference[]): void {
		const binding = this.importBindingName(spec);
		if (!binding) return;
		refs.push({
			symbolName: binding,
			callerFile: "",
			callerLine: spec.startPosition.row + 1,
			callerName: null,
			kind: "import"
		});
	}

	/**
	 * Resolve the local binding name of an import_spec: the explicit `name`
	 * field when it is a package_identifier (alias), else the LAST segment of
	 * the `path` literal (`"net/http"` → 'http'). Returns null when the name
	 * field is a blank_identifier (`_`) or dot (`.`) — no binding exists.
	 */
	private importBindingName(spec: TSNode): string | null {
		const nameNode = spec.childForFieldName("name");
		if (nameNode) {
			if (nameNode.type === PACKAGE_IDENTIFIER) return nameNode.text;
			// Blank `_` / dot `.` imports bind nothing.
			return null;
		}
		const pathNode = spec.childForFieldName("path");
		if (!pathNode) return null;
		let path = pathNode.text;
		// Strip the literal quotes: `"fmt"` / `` `fmt` ``.
		if (path.length >= 2) {
			const first = path[0];
			const last = path[path.length - 1];
			if ((first === '"' && last === '"') || (first === "`" && last === "`")) {
				path = path.slice(1, -1);
			}
		}
		const segments = path.split("/");
		return segments[segments.length - 1] || null;
	}

	/**
	 * Emit 'extends' heritage edges for an interface_type (TASK-306).
	 *
	 * Grammar (tree-sitter-go, verified empirically): interface_type children
	 * are `method_elem` (method requirements) and `type_elem` (embedded
	 * interfaces). Each embedded interface = ONE type_elem wrapping a single
	 * `_type` (type_identifier `Named`, qualified_type `io.Reader`). Union /
	 * approximation elements (`~int | ~string`, `int | string`) are a single
	 * type_elem with MULTIPLE children (or negated_type children) — NOT
	 * embedded interfaces — skipped. interface embeds = extends semantics
	 * (per the TASK-306 spec). `callerLine` = the interface's declaration
	 * line; `callerName` null per the heritage contract.
	 */
	private emitInterfaceEmbeds(iface: TSNode, spec: TSNode, refs: ParsedReference[]): void {
		const line = spec.startPosition.row + 1;
		for (const child of iface.namedChildren) {
			if (child.type !== TYPE_ELEM) continue;
			// A type_elem is `sep1($._type, '|')` — an EMBED is exactly ONE
			// named child (`Named`, `io.Reader`); multi-child type_elems are
			// unions (`int | float64`, `~int | ~string`) — skip them so their
			// first element cannot leak as a spurious 'extends' edge at the
			// declaration line (TASK-345 regression).
			if (child.namedChildren.length !== 1) continue;
			const target = this.embeddedTypeName(child);
			if (!target) continue;
			refs.push({
				symbolName: target,
				callerFile: "",
				callerLine: line,
				callerName: null,
				kind: "extends"
			});
		}
	}

	/**
	 * Emit 'extends' heritage edges for a struct_type (TASK-306).
	 *
	 * Grammar (tree-sitter-go, verified empirically): the struct body is a
	 * `field_declaration_list` of `field_declaration` nodes. An EMBEDDED
	 * (anonymous) field has NO `name` field — only `type`: `Base`,
	 * `*Mutex` (pointer char is an anonymous child; the `type` field is the
	 * underlying type), `sync.RWMutex` (qualified_type), `Base[int]`
	 * (generic_type). Named fields (`ID int`, `name string`) have a `name`
	 * field — skipped. struct embeds = composition with inheritance
	 * semantics → kind 'extends' (per the TASK-306 spec). `callerLine` = the
	 * struct's declaration line; `callerName` null per the heritage contract.
	 */
	private emitStructEmbeds(structNode: TSNode, spec: TSNode, refs: ParsedReference[]): void {
		const line = spec.startPosition.row + 1;
		const body = structNode.namedChildren.find((c) => c.type === FIELD_DECLARATION_LIST);
		if (!body) return;
		for (const field of body.namedChildren) {
			if (field.type !== FIELD_DECLARATION) continue;
			// Named field → not an embed.
			if (field.childrenForFieldName("name").length > 0) continue;
			const typeNode = field.childForFieldName("type");
			if (!typeNode) continue;
			const target = this.embeddedTypeName(typeNode);
			if (!target) continue;
			refs.push({
				symbolName: target,
				callerFile: "",
				callerLine: line,
				callerName: null,
				kind: "extends"
			});
		}
	}

	/**
	 * Resolve the name-based target of an embedded type node (ADR-002 LAST
	 * name segment):
	 *   - `type_identifier` → 'Base'
	 *   - `qualified_type`  → 'Reader' (io.Reader → `name` field)
	 *   - `generic_type`    → 'Base'   (Base[int] → `type` field)
	 *   - `pointer_type`    → pierce   (defensive; embedded pointer fields
	 *     put the `*` on the field_declaration, the `type` field is already
	 *     the underlying type — verified empirically)
	 *   - `negated_type`    → null     (~int — approximation, not an embed)
	 *
	 * When the node is a type_elem (interface body), only a SINGLE named
	 * child is an embed target; multi-child type_elems are unions. Returns
	 * null for unrecognized shapes (no edge emitted).
	 */
	private embeddedTypeName(node: TSNode): string | null {
		let current: TSNode = node;
		for (let depth = 0; depth < 8; depth++) {
			if (current.type === TYPE_IDENTIFIER) return current.text;
			if (current.type === QUALIFIED_TYPE) return current.childForFieldName("name")?.text ?? null;
			if (current.type === NEGATED_TYPE) return null;
			// generic_type exposes its base via the `type` field; pointer_type
			// wraps a single `_type` child.
			const inner = current.childForFieldName("type") ?? current.namedChildren[0];
			if (!inner) return null;
			current = inner;
		}
		return null;
	}

	/**
	 * Read the referenced identifier from a call_expression (TASK-306):
	 * - `helper()`     → `function` field identifier → 'helper'.
	 * - `obj.Save()`   → `function` field selector_expression → 'Save'
	 *   (LAST segment via the `field` field; covers `a.b.c()` → 'c').
	 * Returns null for dynamic function expressions (e.g. `f()()` — the
	 * function field is itself a call), which can't be name-indexed.
	 */
	private callTargetName(node: TSNode): string | null {
		const fn = node.childForFieldName("function");
		if (!fn) return null;
		if (fn.type === IDENTIFIER) return fn.text;
		if (fn.type === SELECTOR_EXPRESSION) return fn.childForFieldName("field")?.text ?? null;
		return null;
	}

	private walkNode(
		node: TSNode,
		symbols: ParsedSymbol[],
		parentName: string | null,
		insideStruct: boolean,
		insideInterface: boolean
	): void {
		// ── Inside struct body: extract fields ──────────────────
		if (insideStruct) {
			if (node.type === FIELD_DECLARATION) {
				// `x, y int` declares multiple names in one node — emit one
				// symbol per name (tree-sitter-go: commaSep1(field('name', ...))).
				const nameNodes = node.childrenForFieldName("name");
				const typeNode = node.childForFieldName("type");
				// Embedded structs (e.g. `*BaseRepo`) have no name field —
				// fall back to the embedded type as the symbol name.
				const names = nameNodes.length > 0 ? nameNodes.map((n) => n.text) : typeNode ? [typeNode.text] : [];
				for (const name of names) {
					symbols.push(this.makeSymbol(node, name, SymbolKind.Variable, parentName));
				}
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true, false);
			}
			return;
		}

		// ── Inside interface body: extract methods ──────────────
		if (insideInterface) {
			if (node.type === METHOD_ELEM) {
				const nameNode = node.childForFieldName("name");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
				}
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, false, true);
			}
			return;
		}

		const type = node.type;

		// ── Function declaration ────────────────────────────────
		if (type === FUNCTION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
				// Functions can have local type declarations inside
				for (const child of node.namedChildren) {
					this.walkNode(child, symbols, null, false, false);
				}
			}
			return;
		}

		// ── Method declaration ──────────────────────────────────
		if (type === METHOD_DECLARATION) {
			const nameNode = node.childForFieldName("name");
			if (nameNode) {
				symbols.push(
					this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName, this.buildMethodSignature(node))
				);
			}
			return;
		}

		// ── Type declaration (struct, interface, type alias) ────
		if (type === TYPE_DECLARATION) {
			const spec = node.namedChildren.find((c) => c.type === TYPE_SPEC);
			if (!spec) return;

			const nameNode = spec.childForFieldName("name");
			if (!nameNode) return;

			const typeNode = spec.childForFieldName("type");

			if (typeNode?.type === STRUCT_TYPE) {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Class, parentName));
				this.walkNode(typeNode, symbols, nameNode.text, true, false);
			} else if (typeNode?.type === INTERFACE_TYPE) {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Interface, parentName));
				this.walkNode(typeNode, symbols, nameNode.text, false, true);
			} else {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Const declaration (incl. iota blocks) ───────────────
		if (type === CONST_DECLARATION) {
			for (const child of node.namedChildren) {
				if (child.type === CONST_SPEC) {
					// `const A, B = 1, 2` declares multiple names in one spec —
					// emit one symbol per name.
					const nameNodes = child.childrenForFieldName("name");
					for (const nameNode of nameNodes) {
						symbols.push(this.makeSymbol(child, nameNode.text, SymbolKind.Constant, parentName));
					}
				}
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	private makeSymbol(
		node: TSNode,
		name: string,
		kind: SymbolKind,
		parentName: string | null,
		signature?: string
	): ParsedSymbol {
		const exported = name.length > 0 && name[0] !== name[0]!.toLowerCase();

		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: signature ?? this.buildSignature(node),
			docComment: this.extractDocComment(node),
			exported,
			defaultExport: false,
			parentName
		};
	}

	private buildSignature(node: TSNode): string {
		const firstLine = node.text.split("\n")[0] ?? "";
		return firstLine.replace(/\s+/g, " ").trim();
	}

	/**
	 * Build a method signature that includes the receiver:
	 * `(r *Repo) Save(ctx context.Context) error`.
	 * Parameters attach directly to the method name (no space before `(`).
	 */
	private buildMethodSignature(node: TSNode): string {
		const receiver = node.childForFieldName("receiver");
		const name = node.childForFieldName("name");
		const parameters = node.childForFieldName("parameters");
		const result = node.childForFieldName("result");

		const head: string[] = [];
		if (receiver) head.push(receiver.text);
		if (name) {
			head.push(parameters ? `${name.text}${parameters.text}` : name.text);
		} else if (parameters) {
			head.push(parameters.text);
		}
		if (result) head.push(result.text);

		return head.join(" ").replace(/\s+/g, " ").trim();
	}

	private extractDocComment(node: TSNode): string | null {
		const lines: string[] = [];
		let sibling: TSNode | null = node.previousNamedSibling;
		while (sibling?.type === COMMENT && sibling.text.startsWith("//")) {
			lines.unshift(sibling.text.replace(/^\/\/\s?/, "").trimEnd());
			sibling = sibling.previousNamedSibling;
		}
		return lines.length > 0 ? lines.join("\n") : null;
	}
}
