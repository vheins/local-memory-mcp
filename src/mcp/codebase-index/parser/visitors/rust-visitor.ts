/**
 * RustVisitor — extracts symbols from Rust source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_item   → Function
 * - struct_item     → Class
 * - enum_item       → Enum
 * - trait_item      → Interface
 * - type_item       → Type
 * - impl_item       → (container; methods → Method)
 * - const_item      → Constant
 * - static_item     → Constant
 * - use_declaration → Module (pub re-exports only; private `use` is not indexed)
 *
 * Export detection: checks for `visibility_modifier` child containing `pub`.
 * `pub(crate)` / `pub(super)` restricted visibilities are NOT treated as
 * exported (consistent with isExported).
 *
 * Reference emission (TASK-307 / Phase 1.1) — node types verified EMPIRICALLY
 * against the shipped tree-sitter-rust WASM (NOT guessed):
 * - `use_declaration` → one 'import' edge per binding: for a simple path the
 *   binding is the LAST path segment (`use crate::a::b::Thing` → 'Thing'); an
 *   `as` alias wins (`use foo::Bar as Baz` → 'Baz'); grouped
 *   `use foo::{x, y as z, nested::w}` emits one edge per group member
 *   (identifiers, alias clauses, `scoped_identifier` name fields, recursing
 *   into nested groups). Glob `use foo::*` and `self` members bind no introdu-
 *   cible name → emit nothing.
 * - `impl_item` with a `trait` field (`impl Trait for Type`) → one
 *   'implements' edge per trait (incl. qualified trait paths — LAST segment;
 *   generic `impl<T> Trait for ...`). Inherent impls (`impl Type { ... }`) have
 *   NO `trait` field → no heritage edge.
 * - `trait_item` with `bounds` (supertraits `trait T: Super + Other`) →
 *   one 'extends' edge per supertrait (type_identifier /
 *   scoped_type_identifier bounds; lifetimes like `'static` skip).
 * - `#[derive(Debug, Clone, serde::Serialize)]` on struct/enum (attribute list
 *   `token_tree` names, last path segment per trait) → one 'implements' edge
 *   per derived trait. Every `#[derive(...)]` is an implicit compiler-
 *   generated trait impl for the attributed type, so callerLine = the
 *   struct/enum declaration line.
 * - `call_expression` → 'call' edges (`helper()`, `obj.save()` →
 *   'save', `std::io::read()` → 'read' LAST segment, `self::f()` → 'f').
 *   macro_invocations (`println!`) are NOT call_expressions → skipped.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol, ReferenceKind } from "../language-visitor";
import { SymbolKind } from "../language-visitor";

const FUNCTION_ITEM = "function_item";
const STRUCT_ITEM = "struct_item";
const ENUM_ITEM = "enum_item";
const TRAIT_ITEM = "trait_item";
const TYPE_ITEM = "type_item";
const IMPL_ITEM = "impl_item";
const CONST_ITEM = "const_item";
const STATIC_ITEM = "static_item";
const USE_DECLARATION = "use_declaration";
const USE_AS_CLAUSE = "use_as_clause";
const SCOPED_IDENTIFIER = "scoped_identifier";
const IDENTIFIER = "identifier";
const SELF = "self";
const SUPER = "super";
const CRATE = "crate";
const COMMENT = "comment";
const LINE_COMMENT = "line_comment";
const BLOCK_COMMENT = "block_comment";
const VISIBILITY_MODIFIER = "visibility_modifier";

// Reference-emission node types (TASK-307 / Phase 1.1) — verified against the
// shipped tree-sitter-rust WASM, NOT guessed (see header comment).
const USE_LIST = "use_list";
const SCOPED_USE_LIST = "scoped_use_list";
const USE_WILDCARD = "use_wildcard";
const TYPE_IDENTIFIER = "type_identifier";
const SCOPED_TYPE_IDENTIFIER = "scoped_type_identifier";
const GENERIC_TYPE = "generic_type";
const TRAIT_BOUNDS = "trait_bounds";
const ATTRIBUTE_ITEM = "attribute_item";
const ATTRIBUTE = "attribute";
const TOKEN_TREE = "token_tree";
const CALL_EXPRESSION = "call_expression";
const FIELD_EXPRESSION = "field_expression";
const LIFETIME = "lifetime";
const DERIVE = "derive";

export class RustVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	/**
	 * Emit reference edges (TASK-307 / Phase 1.1) — imports, trait-impl
	 * heritage, supertraits, derives and call sites. See the header JSDoc for
	 * the verified grammar node mappings and edge-kind decisions.
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
	 * emission stay independent. The heritage/use/call cases emit edges and
	 * then recurse exactly like the default branch (or return for use
	 * declarations, whose members are pure names), so no node is visited
	 * twice and call sites nested in bodies are still reached.
	 */
	private walkReferences(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
		const type = node.type;

		// ── Call edges: `helper()`, `obj.save()`, `std::io::read()`, `self::f()` ──
		if (type === CALL_EXPRESSION) {
			const name = this.callTargetName(node);
			if (name) this.pushRef(refs, name, node.startPosition.row + 1, callerName, "call");
			// Recurse: arguments may hold nested calls (`f(g())`) and closures.
			for (const child of node.namedChildren) {
				this.walkReferences(child, refs, callerName);
			}
			return;
		}

		// ── Use declarations → one 'import' edge per binding ──
		if (type === USE_DECLARATION) {
			this.emitUseImports(node, refs, callerName);
			return; // members are pure names — no nested references
		}

		// ── Heritage: trait impls / supertraits / derive attributes ──
		if (type === IMPL_ITEM) {
			this.emitImplHeritage(node, refs);
			for (const child of node.namedChildren) {
				this.walkReferences(child, refs, null);
			}
			return;
		}
		if (type === TRAIT_ITEM) {
			this.emitTraitBounds(node, refs);
			for (const child of node.namedChildren) {
				this.walkReferences(child, refs, null);
			}
			return;
		}
		if (type === STRUCT_ITEM || type === ENUM_ITEM) {
			this.emitDeriveEdges(node, refs);
			for (const child of node.namedChildren) {
				this.walkReferences(child, refs, null);
			}
			return;
		}

		// ── Caller tracking: enclosing function / method name ──
		if (type === FUNCTION_ITEM) {
			const nameNode = node.childForFieldName("name") ?? node.namedChildren.find((c) => c.type === IDENTIFIER);
			const name = nameNode?.text ?? callerName;
			for (const child of node.namedChildren) {
				this.walkReferences(child, refs, name);
			}
			return;
		}

		for (const child of node.namedChildren) {
			this.walkReferences(child, refs, callerName);
		}
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideImpl: boolean): void {
		const type = node.type;

		// ── Inside impl block: extract methods ─────────────────
		if (insideImpl) {
			if (type === FUNCTION_ITEM) {
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

		// ── Function item ───────────────────────────────────────
		if (type === FUNCTION_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Struct item ─────────────────────────────────────────
		if (type === STRUCT_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
			}
			return;
		}

		// ── Enum item ───────────────────────────────────────────
		if (type === ENUM_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
			}
			return;
		}

		// ── Trait item ──────────────────────────────────────────
		if (type === TRAIT_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Interface, parentName));
			}
			return;
		}

		// ── Type item ───────────────────────────────────────────
		if (type === TYPE_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Const item ──────────────────────────────────────────
		// Only top-level / module-scope items reach here: function bodies are
		// never walked (the function_item branch returns early) and associated
		// consts inside impl blocks are consumed by the insideImpl branch.
		if (type === CONST_ITEM) {
			const nameNode = node.childForFieldName("name");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Constant, parentName));
			}
			return;
		}

		// ── Static item ─────────────────────────────────────────
		if (type === STATIC_ITEM) {
			const nameNode = node.childForFieldName("name");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Constant, parentName));
			}
			return;
		}

		// ── Use declaration (pub re-exports only) ───────────────
		if (type === USE_DECLARATION) {
			this.extractPubUse(node, symbols, parentName);
			return;
		}

		// ── Impl item: recurse for methods ──────────────────────
		if (type === IMPL_ITEM) {
			let implParent: string | null;
			const forIdx = node.children.findIndex((c) => c.type === "for");
			if (forIdx >= 0) {
				const afterFor = node.namedChildren.find(
					(c) => c.type === "type_identifier" && c.startIndex > node.children[forIdx]!.startIndex
				);
				implParent = afterFor?.text ?? parentName;
			} else {
				const typeId = node.namedChildren.find((c) => c.type === "type_identifier");
				implParent = typeId?.text ?? parentName;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, implParent, true);
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
			if (child.type === VISIBILITY_MODIFIER && child.text === "pub") {
				return true;
			}
		}
		return false;
	}

	/**
	 * Extract a `pub use` re-export as a Module symbol.
	 *
	 * Only declarations with plain `pub` visibility are indexed (matching
	 * isExported). Private `use` statements and restricted visibilities such as
	 * `pub(crate)` / `pub(super)` are skipped.
	 *
	 * Name resolution: `pub use path::to::Name as Alias` uses the `Alias`;
	 * otherwise the name is the final path segment. tree-sitter's
	 * `scoped_identifier` `name` field already yields the last segment, so any
	 * `self::`, `crate::` or leading `::` prefix is inherently stripped.
	 * Grouped (`use a::{b, c}`) and glob (`use a::*`) forms carry no single
	 * name and are not indexed.
	 */
	private extractPubUse(node: TSNode, symbols: ParsedSymbol[], parentName: string | null): void {
		if (!this.isExported(node)) return;
		const arg = node.childForFieldName("argument");
		if (!arg) return;

		let name: string | null = null;
		if (arg.type === USE_AS_CLAUSE) {
			name = arg.childForFieldName("alias")?.text ?? null;
		} else if (arg.type === SCOPED_IDENTIFIER) {
			name = arg.childForFieldName("name")?.text ?? null;
		} else if (arg.type === IDENTIFIER || arg.type === SELF || arg.type === SUPER || arg.type === CRATE) {
			name = arg.text;
		}
		if (!name || name.length === 0) return;

		symbols.push(this.makeSymbol(node, name, SymbolKind.Module, parentName));
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
		if (prev && (prev.type === COMMENT || prev.type === LINE_COMMENT || prev.type === BLOCK_COMMENT)) {
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

	// ── Reference-emission helpers (TASK-307 / Phase 1.1) ──────────────────

	private pushRef(
		refs: ParsedReference[],
		symbolName: string,
		callerLine: number,
		callerName: string | null,
		kind: ReferenceKind
	): void {
		// Targets stay null per the TASK-299 ParsedReference heritage contract —
		// edges are name-based; ADR-002 resolution happens downstream. Explicit
		// null (not undefined) so strict assertions hold.
		refs.push({ symbolName, callerFile: "", callerLine, callerName, kind, targetFile: null, targetSymbolId: null });
	}

	/**
	 * Emit one 'import' edge per binding of a `use_declaration`.
	 *
	 * Verified grammar (shipped tree-sitter-rust WASM): the `argument` field
	 * is `scoped_identifier` (simple path), `use_as_clause` (alias wins),
	 * `use_list` / `scoped_use_list` (grouped — one edge per member, recursing
	 * into nested groups), `identifier` (`use foo;`), or `use_wildcard`
	 * (`use foo::*` — glob binds no introducible name → skipped; `self` /
	 * `super` / `crate` members likewise).
	 */
	private emitUseImports(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
		const arg = node.childForFieldName("argument");
		if (!arg) return;
		const line = node.startPosition.row + 1;
		this.emitUseArgument(arg, refs, line, callerName);
	}

	private emitUseArgument(arg: TSNode, refs: ParsedReference[], line: number, callerName: string | null): void {
		switch (arg.type) {
			case USE_AS_CLAUSE: {
				const alias = arg.childForFieldName("alias");
				if (alias) this.pushRef(refs, alias.text, line, callerName, "import");
				break;
			}
			case IDENTIFIER:
				this.pushRef(refs, arg.text, line, callerName, "import");
				break;
			case SCOPED_IDENTIFIER: {
				const name = arg.childForFieldName("name");
				if (name) this.pushRef(refs, name.text, line, callerName, "import");
				break;
			}
			case USE_LIST:
			case SCOPED_USE_LIST:
				this.emitUseList(arg, refs, line, callerName);
				break;
			case USE_WILDCARD:
			case SELF:
			case SUPER:
			case CRATE:
			default:
				// Glob / self / super / crate imports bind no introducible name.
				break;
		}
	}

	private emitUseList(listNode: TSNode, refs: ParsedReference[], line: number, callerName: string | null): void {
		const list = listNode.type === SCOPED_USE_LIST ? (listNode.childForFieldName("list") ?? listNode) : listNode;
		for (const member of list.namedChildren) {
			this.emitUseArgument(member, refs, line, callerName);
		}
	}

	/**
	 * Emit one 'implements' edge for a `impl Trait for Type` block.
	 *
	 * Only impls WITH a `trait` field declare a heritage relationship; the
	 * trait resolves to its LAST name segment (`std::fmt::Display` → 'Display',
	 * `Iterator<Item = u8>` → 'Iterator', `impl<T> Trait for ...` works).
	 * Inherent impls (`impl Type { ... }`, no `trait` field) emit nothing.
	 * callerLine = the impl block's line (where the Type→Trait relationship
	 * is declared); callerName null per the ParsedReference heritage contract.
	 */
	private emitImplHeritage(node: TSNode, refs: ParsedReference[]): void {
		const traitField = node.childForFieldName("trait");
		if (!traitField) return;
		const name = this.pathTargetName(traitField);
		if (name) this.pushRef(refs, name, node.startPosition.row + 1, null, "implements");
	}

	/**
	 * Emit one 'extends' edge per supertrait of a `trait T: Super + Other`.
	 *
	 * Bounds (`trait_bounds` field) may be `type_identifier`, qualified
	 * `scoped_type_identifier` (LAST segment), `generic_type` (`Foo<u8>` →
	 * 'Foo', `std::ops::Add<f64>` → 'Add') or `lifetime` bounds (`'static`,
	 * `'a`) — lifetimes are NOT traits and are skipped. callerName null.
	 */
	private emitTraitBounds(node: TSNode, refs: ParsedReference[]): void {
		const bounds = node.childForFieldName("bounds");
		if (!bounds || bounds.type !== TRAIT_BOUNDS) return;
		const line = node.startPosition.row + 1;
		for (const bound of bounds.namedChildren) {
			if (bound.type === LIFETIME) continue;
			const name = this.pathTargetName(bound);
			if (name) this.pushRef(refs, name, line, null, "extends");
		}
	}

	/**
	 * Emit one 'implements' edge per trait in `#[derive(...)]` attributes on a
	 * struct/enum (INCLUDED per TASK-307 decision — it is cheap and every
	 * derive is an implicit compiler-generated trait impl).
	 *
	 * The `attribute_item` is the struct/enum's previous sibling (stacked
	 * attributes walked back, comments skipped); only attributes whose macro
	 * name is `derive` count (`#[repr(C)]` etc. emit nothing). The `token_tree`
	 * argument is FLAT (verified: qualified paths inside derive args are NOT
	 * `scoped_identifier` nodes — `serde::Serialize` parses as identifier
	 * 'serde', '::', identifier 'Serialize' as sibling tokens), so per
	 * comma-separated member the LAST identifier wins (`serde::Serialize` →
	 * 'Serialize', ADR-002 last segment).
	 * callerLine = the struct/enum DECLARATION line (the derived type), not
	 * the attribute line — consistent with the heritage contract.
	 */
	private emitDeriveEdges(node: TSNode, refs: ParsedReference[]): void {
		const line = node.startPosition.row + 1;
		let prev = node.previousNamedSibling;
		while (
			prev &&
			(prev.type === ATTRIBUTE_ITEM ||
				prev.type === COMMENT ||
				prev.type === LINE_COMMENT ||
				prev.type === BLOCK_COMMENT)
		) {
			if (prev.type === ATTRIBUTE_ITEM) {
				const attr = prev.namedChildren.find((c) => c.type === ATTRIBUTE);
				const macroName = attr?.namedChildren[0]?.text;
				if (macroName === DERIVE) {
					const tokenTree = attr?.childForFieldName("arguments");
					if (tokenTree && tokenTree.type === TOKEN_TREE) {
						let lastIdentifier: string | null = null;
						for (const child of tokenTree.children) {
							if (child.type === IDENTIFIER) {
								lastIdentifier = child.text;
							} else if (child.type === ",") {
								if (lastIdentifier) this.pushRef(refs, lastIdentifier, line, null, "implements");
								lastIdentifier = null;
							}
						}
						if (lastIdentifier) this.pushRef(refs, lastIdentifier, line, null, "implements");
					}
				}
			}
			prev = prev.previousNamedSibling;
		}
	}

	/**
	 * Resolve the called name of a `call_expression` — LAST name segment per
	 * ADR-002:
	 *   - `helper()`            → identifier text 'helper'
	 *   - `obj.save()`          → field_expression `field` → 'save'
	 *   - `std::io::read(&s)`   → scoped_identifier `name` → 'read'
	 *   - `self::helper()`      → scoped_identifier `name` → 'helper'
	 *   - `f()()`               → function field is a call_expression → null
	 * Macro invocations (`println!`) are NOT call_expressions → no edge.
	 */
	private callTargetName(node: TSNode): string | null {
		const fn = node.childForFieldName("function") ?? node.firstNamedChild;
		if (!fn) return null;
		if (fn.type === FIELD_EXPRESSION) {
			return fn.childForFieldName("field")?.text ?? fn.lastNamedChild?.text ?? null;
		}
		if (fn.type === SCOPED_IDENTIFIER) {
			return fn.childForFieldName("name")?.text ?? null;
		}
		if (fn.type === IDENTIFIER) return fn.text;
		return null;
	}

	/**
	 * Resolve a type-path node to its LAST name segment (ADR-002):
	 * `type_identifier` → text; `scoped_type_identifier` / `scoped_identifier`
	 * → `name` field (std::fmt::Display → 'Display'); `generic_type` →
	 * recurse into its `type` field (Iterator<Item = u8> → 'Iterator',
	 * std::ops::Add<u8> → 'Add'). Other nodes (lifetimes, primitives) → null.
	 */
	private pathTargetName(node: TSNode): string | null {
		const type = node.type;
		if (type === TYPE_IDENTIFIER || type === IDENTIFIER) return node.text;
		if (type === SCOPED_TYPE_IDENTIFIER || type === SCOPED_IDENTIFIER) {
			return node.childForFieldName("name")?.text ?? null;
		}
		if (type === GENERIC_TYPE) {
			const base = node.childForFieldName("type") ?? node.namedChildren[0];
			return base ? this.pathTargetName(base) : null;
		}
		return null;
	}
}
