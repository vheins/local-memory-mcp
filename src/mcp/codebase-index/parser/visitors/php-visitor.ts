/**
 * PhpVisitor — extracts symbols from PHP source code using tree-sitter's AST.
 *
 * Node type mappings (tree-sitter-php_only grammar):
 * - function_definition  → Function
 * - class_declaration    → Class
 * - interface_declaration → Interface
 * - enum_declaration     → Enum
 * - enum_case            → Constant (enum case, parented to the enum)
 * - method_declaration   → Method (inside class or trait)
 * - trait_declaration    → Class (methods inside are also extracted)
 * - property_declaration → Variable (class/trait properties, parented to owner)
 * - const_declaration    → Constant (class/interface/enum members parented to
 *                          owner; top-level constants parented to null)
 * - namespace_use_declaration → Module (top-level `use Foo\Bar;` imports,
 *                          incl. group `use Foo\{Bar, Baz as Q};` forms; the
 *                          fully-qualified name goes in `name`, the optional
 *                          `as` alias in `signature`). Trait `use` statements
 *                          (`use_declaration` inside classes) are NOT imports
 *                          and are intentionally not extracted.
 *
 * Function/method `signature` is constructed structurally (not raw first-line
 * text): a leading PHP 8 attribute prefix (`#[Route('/api')] ...`) where
 * present, then `visibility? static?/abstract?/final?/readonly? name(params):
 * returnType`. Parameters are rendered from `formal_parameters` children
 * (simple_parameter, variadic_parameter, property_promotion_parameter)
 * preserving each param's type, by-ref/variadic marker and default value; the
 * return type is read from the `return_type` field (named_type, primitive_type,
 * optional_type, union_type, intersection_type, bottom_type, ...).
 * Functions/methods without an explicit return type omit the `: type` suffix.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";

const FUNCTION_DEFINITION = "function_definition";
const METHOD_DECLARATION = "method_declaration";
const CLASS_DECLARATION = "class_declaration";
const INTERFACE_DECLARATION = "interface_declaration";
const ENUM_DECLARATION = "enum_declaration";
const ENUM_CASE = "enum_case";
const TRAIT_DECLARATION = "trait_declaration";
const PROPERTY_DECLARATION = "property_declaration";
const PROPERTY_ELEMENT = "property_element";
const VARIABLE_NAME = "variable_name";
const CONST_DECLARATION = "const_declaration";
const CONST_ELEMENT = "const_element";
const NAME = "name";
const SIMPLE_PARAMETER = "simple_parameter";
const VARIADIC_PARAMETER = "variadic_parameter";
const PROPERTY_PROMOTION_PARAMETER = "property_promotion_parameter";
const VISIBILITY_MODIFIER = "visibility_modifier";
const STATIC_MODIFIER = "static_modifier";
const ABSTRACT_MODIFIER = "abstract_modifier";
const FINAL_MODIFIER = "final_modifier";
const READONLY_MODIFIER = "readonly_modifier";
const ATTRIBUTE_GROUP = "attribute_group";
const COMMENT = "comment";
const DECLARATION_LIST = "declaration_list";
const NAMESPACE_USE_DECLARATION = "namespace_use_declaration";
const NAMESPACE_USE_CLAUSE = "namespace_use_clause";
const NAMESPACE_USE_GROUP = "namespace_use_group";
const NAMESPACE_NAME = "namespace_name";

// Call-site node types (reference emission, TASK-236 / issue #64).
const FUNCTION_CALL_EXPRESSION = "function_call_expression";
const MEMBER_CALL_EXPRESSION = "member_call_expression";
const SCOPED_CALL_EXPRESSION = "scoped_call_expression";
const OBJECT_CREATION_EXPRESSION = "object_creation_expression";

// Heritage / import-name node types (reference emission, TASK-302 / Phase 1.1).
const BASE_CLAUSE = "base_clause";
const CLASS_INTERFACE_CLAUSE = "class_interface_clause";
const QUALIFIED_NAME = "qualified_name";
const RELATIVE_NAME = "relative_name";

export class PhpVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	/**
	 * Emit call-site references (TASK-236 / issue #64) + import and heritage
	 * edges (TASK-302 / Phase 1.1).
	 *
	 * Cheap single AST pass over the obvious reference surfaces in the
	 * php_only grammar:
	 * - `function_call_expression`  → kind 'call' (`helper()` → 'helper')
	 * - `member_call_expression`    → kind 'call' (`$obj->save()` → 'save')
	 * - `scoped_call_expression`    → kind 'call' (`self::make()` / `Svc::x()` → 'x')
	 * - `object_creation_expression`→ kind 'instantiation' (`new User()` → 'User')
	 * - `namespace_use_declaration` → kind 'import' (one edge per binding —
	 *   the `as` alias when present, else the LAST segment of the qualified
	 *   name; group form `use NS\{A, B as C};` covered).
	 * - class/interface/enum declarations → kind 'extends'/'implements' per
	 *   heritage target (`class Foo extends Bar implements I` emits Bar as
	 *   'extends' and I as 'implements'; `interface A extends B, C` and
	 *   `enum E implements I1, I2` emit per-target edges).
	 *
	 * `callerName` is the enclosing function/method name, tracked by descending
	 * into function_definition / method_declaration bodies, and null for
	 * heritage edges and top-level imports (they belong to a declaration, not
	 * a function). Timestamps to the tree root so no symbol is required to
	 * pre-exist the caller. Trait `use` statements (`use_declaration` inside
	 * classes) are NOT imports and stay unindexed, matching the symbol
	 * extraction contract.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		this.walkReferences(tree.rootNode, null, refs);
		return refs;
	}

	private walkReferences(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
		let called: string | null;
		switch (node.type) {
			case FUNCTION_CALL_EXPRESSION:
			case MEMBER_CALL_EXPRESSION:
			case SCOPED_CALL_EXPRESSION:
				called = this.callTargetName(node);
				break;
			case OBJECT_CREATION_EXPRESSION:
				called = this.callTargetName(node);
				break;
			case "function_definition":
			case "method_declaration": {
				const nameNode =
					node.childForFieldName("name") ??
					node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
				const fnName = nameNode ? nameNode.text : null;
				for (const child of node.namedChildren) {
					this.walkReferences(child, fnName ?? callerName, refs);
				}
				return;
			}
			case NAMESPACE_USE_DECLARATION: {
				// Import edges (TASK-302): one 'import' reference per binding.
				// Do NOT recurse — use-clause children are pure names, never
				// call sites (mirrors the TS emitImports surface).
				this.emitImportEdges(node, callerName, refs);
				return;
			}
			// Heritage edges (TASK-302): emit 'extends'/'implements' for the
			// declaration's base/interface clauses, then recurse into the body
			// so call-site refs inside members still emit (identical traversal
			// to the default branch — purely additive).
			case CLASS_DECLARATION:
			case INTERFACE_DECLARATION:
			case ENUM_DECLARATION: {
				this.emitHeritage(node, refs);
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

		if (called) {
			refs.push({
				symbolName: called,
				callerFile: "",
				callerLine: node.startPosition.row + 1,
				callerName,
				kind: node.type === OBJECT_CREATION_EXPRESSION ? "instantiation" : "call"
			});
		}

		// Recurse into children so nested calls are also indexed.
		for (const child of node.namedChildren) {
			this.walkReferences(child, callerName, refs);
		}
	}

	/**
	 * Read the referenced identifier from a call/creation node:
	 * - function_call_expression / object_creation_expression expose the target
	 *   as a `name` CHILD (not a field) — `new User()` / `helper()`.
	 * - member_/scoped_call_expression expose the callee as a `name` FIELD.
	 * Returns null for dynamic (variable) targets, which we can't index.
	 */
	private callTargetName(node: TSNode): string | null {
		const fieldName = node.childForFieldName("name");
		if (fieldName) return fieldName.text;
		const child = node.namedChildren.find((c) => c.type === "name" || c.type === NAME);
		if (!child) return null;
		const text = child.text;
		// Skip purely-dynamic targets like `$fn()` / `new $class()` — text is
		// a variable_name/placeholder, not a symbolic definition.
		return text.startsWith("$") ? null : text;
	}

	/**
	 * Emit one 'import' reference edge per binding in a `namespace_use_declaration`
	 * (top-level `use` statements), consistent with TS emitImports semantics
	 * (TASK-302 / Phase 1.1).
	 *
	 * Both grammar shapes are covered (verified empirically against the shipped
	 * php_only WASM):
	 * - Plain form: `use Foo\Bar;` / `use Foo\Bar as Baz;` / `use A, B;` → one
	 *   or more `namespace_use_clause` children.
	 * - Group form: `use NS\Util\{Factory, Repo as Store};` → a `namespace_name`
	 *   prefix + a `namespace_use_group` whose clauses hold the relative names.
	 *
	 * The referenced symbol is the LOCAL BINDING per PHP semantics — the `as`
	 * alias when present (`use Foo\Bar as Baz;` → 'Baz'), otherwise the LAST
	 * name segment of the imported name (`use Foo\Bar;` → 'Bar'), matching
	 * ADR-002 last-segment, name-based resolution. `callerLine` is the `use`
	 * statement line; `callerName` is the enclosing function/method (null in
	 * practice — PHP requires `use` at the top level).
	 */
	private emitImportEdges(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
		const line = node.startPosition.row + 1;
		const children = node.namedChildren;

		// ── Group form: `use NS\Util\{Factory, Repo as Store};` ──────────────
		const groupNode = children.find((c) => c.type === NAMESPACE_USE_GROUP);
		if (groupNode) {
			for (const clause of groupNode.namedChildren) {
				if (clause.type !== NAMESPACE_USE_CLAUSE) continue;
				this.emitImportBinding(clause, line, callerName, refs);
			}
			return;
		}

		// ── Plain form: one or more `namespace_use_clause` children ──
		for (const clause of children) {
			if (clause.type !== NAMESPACE_USE_CLAUSE) continue;
			this.emitImportBinding(clause, line, callerName, refs);
		}
	}

	/** Emit a single 'import' edge for one namespace_use_clause binding. */
	private emitImportBinding(clause: TSNode, line: number, callerName: string | null, refs: ParsedReference[]): void {
		const binding = this.importBindingName(clause);
		if (!binding) return;
		refs.push({
			symbolName: binding,
			callerFile: "",
			callerLine: line,
			callerName,
			kind: "import"
		});
	}

	/**
	 * Resolve the local binding name of a namespace_use_clause: the `as` alias
	 * when present (`use Foo\Bar as Baz;` → 'Baz'), otherwise the LAST name
	 * segment of the imported name (`use Foo\Bar;` → 'Bar').
	 */
	private importBindingName(clause: TSNode): string | null {
		const alias = clause.childForFieldName("alias");
		if (alias) return alias.text;
		const nameNode = clause.namedChildren[0];
		if (!nameNode) return null;
		return this.heritageTargetName(nameNode);
	}

	/**
	 * Emit 'extends' / 'implements' heritage edges for a class, interface or
	 * enum declaration (TASK-302, Phase 1.1).
	 *
	 * Grammar (tree-sitter-php_only, verified empirically against the shipped
	 * WASM): class heritage lives in DIRECT `base_clause` ('extends', single
	 * target) + `class_interface_clause` ('implements', list) children of the
	 * declaration — no wrapper node. `interface_declaration` heritage is a
	 * `base_clause` holding MULTIPLE targets (`interface A extends B, C`).
	 * `enum_declaration` heritage is a `class_interface_clause` ('implements').
	 * `trait_declaration` has NO heritage clause. The declaration's own
	 * backing-type `primitive_type` on enums is not a heritage target.
	 *
	 * `callerName` is null per the ParsedReference heritage contract
	 * (language-visitor.ts) — the edge belongs to the derived type's
	 * declaration, not an enclosing function. `targetFile`/`targetSymbolId`
	 * are left null: name-based resolution per ADR-002 happens at query time,
	 * not parse time.
	 */
	private emitHeritage(node: TSNode, refs: ParsedReference[]): void {
		const line = node.startPosition.row + 1;
		for (const clause of node.namedChildren) {
			if (clause.type === BASE_CLAUSE) this.emitHeritageTargets(clause, "extends", line, refs);
			else if (clause.type === CLASS_INTERFACE_CLAUSE) this.emitHeritageTargets(clause, "implements", line, refs);
		}
	}

	/** Emit one heritage edge per target inside a base_clause/class_interface_clause. */
	private emitHeritageTargets(
		clause: TSNode,
		kind: "extends" | "implements",
		line: number,
		refs: ParsedReference[]
	): void {
		for (const target of clause.namedChildren) {
			const name = this.heritageTargetName(target);
			if (!name) continue;
			refs.push({
				symbolName: name,
				callerFile: "",
				callerLine: line,
				callerName: null,
				kind
			});
		}
	}

	/**
	 * Resolve the name-based target of a heritage element or imported name.
	 *
	 * Per ADR-002 (name-based resolution, no LSP / type resolution), the edge
	 * references the LAST name segment of the heritage target / import as
	 * written:
	 *
	 *   - `name`           → `Foo`      (extends Foo / use Foo\Bar → 'Bar')
	 *   - `qualified_name`  → `Base`    (extends \App\Models\Base → 'Base')
	 *   - `relative_name`   → `Foo`     (namespace\Foo → 'Foo')
	 *
	 * Returns null for non-name elements (no edge emitted) — all children of
	 * base_clause/class_interface_clause/namespace_use_clause are name-shaped
	 * in the php_only grammar, so this is a defensive guard.
	 */
	private heritageTargetName(node: TSNode): string | null {
		if (node.type === NAME) return node.text;
		if (node.type === QUALIFIED_NAME || node.type === RELATIVE_NAME) {
			return node.lastNamedChild?.text ?? null;
		}
		return null;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class body: extract constants, properties & methods ──
		if (insideClass) {
			if (type === CONST_DECLARATION) {
				this.extractConstants(node, symbols, parentName);
				return;
			}
			if (type === PROPERTY_DECLARATION) {
				this.extractProperties(node, symbols, parentName);
				return;
			}
			if (type === METHOD_DECLARATION) {
				const nameNode =
					node.childForFieldName("name") ??
					node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
				if (nameNode) {
					const signature = this.buildFunctionSignature(node, nameNode.text);
					symbols.push(this.makeSymbolWithSignature(node, nameNode.text, SymbolKind.Method, parentName, signature));
				}
				return;
			}
			if (type === ENUM_CASE) {
				this.extractEnumCases(node, symbols, parentName);
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true);
			}
			return;
		}

		// ── Function definition ─────────────────────────────────
		if (type === FUNCTION_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
			if (nameNode) {
				const signature = this.buildFunctionSignature(node, nameNode.text);
				symbols.push(this.makeSymbolWithSignature(node, nameNode.text, SymbolKind.Function, parentName, signature));
			}
			return;
		}

		// ── Top-level const declaration ──────────────────────────
		// Also matches class/interface/enum constants when this visitor is fed
		// a tree from the full php grammar (php/grammar.js emits the distinct
		// class_const_declaration node type), though php_only aliases those to
		// const_declaration.
		if (type === CONST_DECLARATION) {
			this.extractConstants(node, symbols, parentName);
			return;
		}

		// ── Namespace use declarations (imports) ────────────────
		// Top-level `use Foo\Bar;`, `use function x;`, `use const X;` and the
		// group form `use Foo\{Bar, Baz as Q};`. Each imported name becomes a
		// Module symbol: `name` = fully-qualified name, `signature` = alias.
		if (type === NAMESPACE_USE_DECLARATION) {
			this.extractNamespaceImports(node, symbols);
			return;
		}

		// ── Class declaration ───────────────────────────────────
		if (type === CLASS_DECLARATION) {
			const nameNode =
				node.childForFieldName("name") ?? node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				// Recurse for methods
				this.extractMethods(node, symbols, nameNode.text);
			}
			return;
		}

		// ── Interface declaration ───────────────────────────────
		if (type === INTERFACE_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Interface, parentName));
				// Interfaces are class-like: walk the body for members (constants,
				// method signatures, and any property_declaration in malformed code)
				this.extractMethods(node, symbols, nameNode.text);
			}
			return;
		}

		// ── Enum declaration ────────────────────────────────────
		if (type === ENUM_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
				// Enums are class-like: walk the body for members (constants,
				// enum cases and methods).
				this.extractMethods(node, symbols, nameNode.text);
			}
			return;
		}

		// ── Trait declaration ───────────────────────────────────
		if (type === TRAIT_DECLARATION) {
			const nameNode =
				node.childForFieldName("name") ?? node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				// Traits are class-like: extract methods into their declaration list
				this.extractMethods(node, symbols, nameNode.text);
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	/**
	 * Extract namespace imports from a `namespace_use_declaration` node
	 * (top-level `use` statements).
	 *
	 * The grammar emits two shapes:
	 * - Plain form: `namespace_use_clause` children, each holding a
	 *   `qualified_name` (fully-qualified) or bare `name` (for
	 *   `use function foo;` / `use const FOO;`) plus an optional `alias`
	 *   field.
	 * - Group form: `use Foo\{Bar, Baz as Q};` → a `namespace_name` prefix
	 *   followed by a `namespace_use_group` whose clauses hold the *relative*
	 *   names. Each clause name is joined onto the prefix with `\`.
	 *
	 * `use function`/`use const` clauses carry a `type` field (`function` /
	 * `const`); the leading keyword is part of the qualified_name text for
	 * `qualified_name`-shaped clauses but not for the group items, so the
	 * prefix is also stripped of the `function ` / `const ` keyword.
	 */
	private extractNamespaceImports(node: TSNode, symbols: ParsedSymbol[]): void {
		const children = node.namedChildren;

		// ── Group form: `use Foo\{Bar, Baz as Q};` ──────────────
		const prefixNode = children.find((c) => c.type === NAMESPACE_NAME);
		const groupNode = children.find((c) => c.type === NAMESPACE_USE_GROUP);
		if (prefixNode && groupNode) {
			const prefix = prefixNode.text;
			for (const clause of groupNode.namedChildren) {
				if (clause.type !== NAMESPACE_USE_CLAUSE) continue;
				this.extractImportClause(clause, symbols, prefix);
			}
			return;
		}

		// ── Plain form: one or more `namespace_use_clause` children ──
		for (const clause of children) {
			if (clause.type !== NAMESPACE_USE_CLAUSE) continue;
			this.extractImportClause(clause, symbols, null);
		}
	}

	/**
	 * Extract a single import from a namespace_use_clause node.
	 *
	 * The clause has no `name` field — the imported name is the first named
	 * child (`qualified_name` for namespaced imports, bare `name` for
	 * `use function`/`use const`/simple imports), while the optional `as`
	 * alias lives in the `alias` field. Imports are stored with kind=Module,
	 * `name` = fully-qualified name and `signature` = alias (or empty string).
	 */
	private extractImportClause(clause: TSNode, symbols: ParsedSymbol[], prefix: string | null): void {
		// The import name is always the first named child; the alias (if any)
		// is a separate `name` node in the `alias` field — never scanned here
		// so aliased imports (`use A\B as C`) keep A\B as the symbol name.
		const nameNode = clause.namedChildren[0];
		if (!nameNode || nameNode.text.length === 0) return;
		const qualified = prefix ? `${prefix}\\${nameNode.text}` : nameNode.text;
		const aliasNode = clause.childForFieldName("alias");
		const signature = aliasNode ? aliasNode.text : "";
		symbols.push(this.makeSymbolWithSignature(clause, qualified, SymbolKind.Module, null, signature));
	}

	/**
	 * Extract methods from the declaration list body of a class-like node
	 * (class_declaration, interface_declaration, enum_declaration or
	 * trait_declaration). Method symbols are attached to the parent via
	 * parentName.
	 */
	private extractMethods(node: TSNode, symbols: ParsedSymbol[], parentName: string): void {
		const body = node.childForFieldName("body") ?? node.namedChildren.find((c) => c.type === DECLARATION_LIST);
		if (body) {
			this.walkNode(body, symbols, parentName, true);
		}
	}

	/**
	 * Extract property elements from a property_declaration node.
	 *
	 * A property_declaration wraps one or more property_element children; each
	 * element's `name` field is a variable_name node whose text is the property
	 * (e.g. `$name` — the leading `$` is stripped from the symbol name).
	 *
	 * The symbol's `signature` is built from the whole declaration so visibility
	 * modifiers (public/protected/private/readonly/static/var) and the optional
	 * type annotation (named_type, optional_type, union_type, ...) are preserved
	 * and searchable. The owning class/trait is attached via parentName.
	 */
	private extractProperties(node: TSNode, symbols: ParsedSymbol[], parentName: string | null): void {
		const elements = node.namedChildren.filter((c) => c.type === PROPERTY_ELEMENT);
		if (elements.length === 0) return;
		for (const element of elements) {
			const nameNode = element.childForFieldName("name") ?? element.namedChildren.find((c) => c.type === VARIABLE_NAME);
			if (!nameNode) continue;
			const rawName = nameNode.text.startsWith("$") ? nameNode.text.slice(1) : nameNode.text;
			if (rawName.length === 0) continue;
			// Anchor the symbol range on the name token so line/col point at the
			// property itself; the signature still reflects the full declaration.
			const symbolNode = element.startPosition.row === node.startPosition.row ? node : element;
			// Doc lookup is anchored on the whole property_declaration node: the
			// preceding PHPDoc comment siblings the declaration, not the element.
			symbols.push(this.makeSymbol(symbolNode, rawName, SymbolKind.Variable, parentName, node));
		}
	}

	/**
	 * Extract constant elements from a const_declaration node.
	 *
	 * A const_declaration wraps one or more const_element children; each
	 * element holds a `name` node (e.g. `STATUS_ACTIVE`) and an optional
	 * expression (the constant's value). The symbol is parented to the
	 * enclosing class/interface/trait when declared inside one, otherwise
	 * parentName is null (top-level `const`).
	 *
	 * The symbol's range is anchored on the name token; the `signature` is a
	 * focused per-element preview (`NAME = value`) so multi-element
	 * declarations (`const A = 1, B = 2;`) don't leak sibling constants into
	 * every element's signature. The full declaration remains searchable via
	 * the file source.
	 */
	private extractConstants(node: TSNode, symbols: ParsedSymbol[], parentName: string | null): void {
		const elements = node.namedChildren.filter((c) => c.type === CONST_ELEMENT);
		if (elements.length === 0) return;
		for (const element of elements) {
			const nameNode = element.namedChildren.find((c) => c.type === NAME);
			if (!nameNode || nameNode.text.length === 0) continue;
			const signature = this.buildConstantSignature(element);
			// Anchor the symbol range on the name token so line/col point at the
			// constant itself.
			const symbolNode = element.startPosition.row === node.startPosition.row ? node : element;
			// Doc lookup is anchored on the whole const_declaration node so a
			// preceding PHPDoc is captured even for multi-element declarations.
			symbols.push(
				this.makeSymbolWithSignature(symbolNode, nameNode.text, SymbolKind.Constant, parentName, signature, node)
			);
		}
	}

	/**
	 * Extract enum cases from an enum_case node.
	 *
	 * An enum_case node carries a required `name` field (a `name` node) and an
	 * optional `value` expression for backed enums (`case Admin = 'admin';`).
	 * Each case becomes a Constant symbol parented to the enclosing enum. The
	 * symbol range is anchored on the case node; the `signature` is a focused
	 * `CASE = value` preview (or just the case name for pure enums).
	 */
	private extractEnumCases(node: TSNode, symbols: ParsedSymbol[], parentName: string | null): void {
		const nameNode = node.childForFieldName("name") ?? node.namedChildren.find((c) => c.type === NAME);
		if (!nameNode || nameNode.text.length === 0) return;
		const valueNode = node.childForFieldName("value");
		let signature = nameNode.text;
		if (valueNode) {
			const value = valueNode.text.replace(/\s+/g, " ").trim();
			signature += ` = ${value}`;
		}
		symbols.push(this.makeSymbolWithSignature(node, nameNode.text, SymbolKind.Constant, parentName, signature));
	}

	/**
	 * Build a focused `NAME = value` preview for a const_element node.
	 *
	 * The value expression is the last named child (the `name` node is the
	 * first). The preview is capped at 30 characters; longer values (large
	 * arrays, long strings) are truncated with an ellipsis.
	 */
	private buildConstantSignature(element: TSNode): string {
		const nameNode = element.namedChildren.find((c) => c.type === NAME);
		const valueNode = element.namedChildren[element.namedChildren.length - 1];
		const name = nameNode ? nameNode.text : "";
		let preview = name;
		if (valueNode && valueNode !== nameNode) {
			const value = valueNode.text.replace(/\s+/g, " ").trim();
			preview += ` = ${value}`;
		}
		return preview.length > 30 ? `${preview.slice(0, 27)}...` : preview;
	}

	/**
	 * Build a structured signature for a function_definition or
	 * method_declaration node: `visibility? static? name(params): returnType`.
	 *
	 * Parameters are rendered per formal_parameters child preserving each
	 * param's type, by-ref/variadic marker, default value and (for promoted
	 * constructor params) visibility/readonly modifiers. The return type is
	 * read from the `return_type` field; functions without an explicit return
	 * type omit the `: type` suffix. Whitespace is collapsed to a single
	 * space so the result is a clean one-liner.
	 */
	private buildFunctionSignature(funcNode: TSNode, name: string): string {
		const attributes = this.extractAttributesPrefix(funcNode);
		const prefix = this.extractMethodModifiers(funcNode);
		const params = this.extractParameters(funcNode.childForFieldName("parameters"));
		const returnType = this.extractReturnType(funcNode);
		let signature = `${attributes}${prefix}${name}(${params})`;
		if (returnType) {
			signature += `: ${returnType}`;
		}
		return signature;
	}

	/**
	 * Collect PHP 8 attributes (`#[Route('/api')]`, `#[Attribute]`) that precede
	 * a declaration as a space-separated prefix (e.g. `#[Route('/api')] `).
	 *
	 * The `attributes` field of a method/function/class/property declaration
	 * holds a single attribute_list node whose named children are the
	 * attribute_group nodes — each rendered verbatim as `#[Attr(arg)]`. Multiple
	 * groups (`#[A] #[B]`) are joined with a single space. Declarations without
	 * attributes return an empty string, so no prefix is prepended.
	 */
	private extractAttributesPrefix(node: TSNode): string {
		const attrList = node.childForFieldName("attributes");
		if (!attrList) return "";
		const groups = attrList.namedChildren.filter((c) => c.type === ATTRIBUTE_GROUP);
		if (groups.length === 0) return "";
		const rendered = groups.map((g) => g.text.replace(/\s+/g, " ").trim()).join(" ");
		return `${rendered} `;
	}

	/**
	 * Collect visibility (public/protected/private) and static/abstract/final/
	 * readonly modifiers from a method_declaration property_declaration node as
	 * a space-separated prefix (e.g. `protected static `). Modifier nodes are
	 * named children, not fields; their source order is preserved. Functions have
	 * no modifiers, so the prefix is empty.
	 */
	private extractMethodModifiers(node: TSNode): string {
		const parts: string[] = [];
		for (const child of node.namedChildren) {
			if (
				child.type === VISIBILITY_MODIFIER ||
				child.type === STATIC_MODIFIER ||
				child.type === ABSTRACT_MODIFIER ||
				child.type === FINAL_MODIFIER ||
				child.type === READONLY_MODIFIER
			) {
				parts.push(child.text);
			}
		}
		return parts.length > 0 ? `${parts.join(" ")} ` : "";
	}

	/**
	 * Format the parameters of a formal_parameters node as `Type $a, Type &$b,
	 * Type ...$c`.
	 *
	 * Each named child is one of simple_parameter, variadic_parameter or
	 * property_promotion_parameter. A param's optional type lives in the
	 * `type` field (named_type, primitive_type, optional_type, union_type,
	 * intersection_type, ...), its name in the `name` field (variable_name,
	 * or by_ref for promoted by-reference params), its optional default in the
	 * `default_value` field, and an optional `reference_modifier` field marks
	 * by-ref params. Promoted params may carry visibility/readonly modifiers
	 * which are preserved in the rendered output. Empty params return an empty
	 * string so the caller wraps it in `()`.
	 */
	private extractParameters(formalParamsNode: TSNode | null): string {
		if (!formalParamsNode) return "";
		const parts: string[] = [];
		for (const param of formalParamsNode.namedChildren) {
			if (
				param.type !== SIMPLE_PARAMETER &&
				param.type !== VARIADIC_PARAMETER &&
				param.type !== PROPERTY_PROMOTION_PARAMETER
			) {
				continue;
			}
			const typeNode = param.childForFieldName("type");
			const nameNode = param.childForFieldName("name");
			const referenceNode = param.childForFieldName("reference_modifier");
			const defaultNode = param.childForFieldName("default_value");

			let rendered = "";
			// Promoted constructor params: `private readonly string $title`
			if (param.type === PROPERTY_PROMOTION_PARAMETER) {
				const promotions: string[] = [];
				for (const child of param.namedChildren) {
					if (child.type === VISIBILITY_MODIFIER || child.type === READONLY_MODIFIER) {
						promotions.push(child.text);
					}
				}
				if (promotions.length > 0) rendered += `${promotions.join(" ")} `;
			}
			if (typeNode) rendered += `${typeNode.text} `;
			// By-ref `&` and variadic `...` are unnamed children of the parameter;
			// prefix them directly onto the name so output is `&$y` / `...$parts`.
			if (referenceNode) rendered += `${referenceNode.text}`;
			if (param.type === VARIADIC_PARAMETER) rendered += "...";
			if (nameNode) rendered += nameNode.text;
			if (defaultNode) rendered += ` = ${defaultNode.text.replace(/\s+/g, " ").trim()}`;
			parts.push(rendered.trim());
		}
		return parts.join(", ");
	}

	/**
	 * Extract the return type of a function_definition or method_declaration
	 * node, or null when no return type is declared.
	 *
	 * The `return_type` field covers every type shape the grammar emits
	 * (named_type, primitive_type, optional_type, union_type, intersection_type,
	 * bottom_type, ...), so its text is used as-is with whitespace collapsed.
	 */
	private extractReturnType(funcNode: TSNode): string | null {
		const returnTypeNode = funcNode.childForFieldName("return_type");
		if (!returnTypeNode) return null;
		const type = returnTypeNode.text.replace(/\s+/g, " ").trim();
		return type.length > 0 ? type : null;
	}

	private makeSymbol(
		node: TSNode,
		name: string,
		kind: SymbolKind,
		parentName: string | null,
		docNode?: TSNode
	): ParsedSymbol {
		return this.makeSymbolWithSignature(node, name, kind, parentName, this.buildSignature(node), docNode);
	}

	/** Like makeSymbol, but with an explicit signature (used for focused
	 * per-element previews such as `NAME = value` for constants). */
	private makeSymbolWithSignature(
		node: TSNode,
		name: string,
		kind: SymbolKind,
		parentName: string | null,
		signature: string,
		docNode?: TSNode
	): ParsedSymbol {
		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature,
			docComment: this.extractDocComment(docNode ?? node),
			exported: false,
			defaultExport: false,
			parentName
		};
	}

	private buildSignature(node: TSNode): string {
		const firstLine = node.text.split("\n")[0] ?? "";
		return firstLine.replace(/\s+/g, " ").trim();
	}

	/**
	 * Extract the doc comment preceding a declaration node and serialize it as
	 * a structured, searchable summary + tags string (see doc-comment.ts).
	 *
	 * The comment is the declaration's previous named sibling in the php_only
	 * grammar (verified against the live WASM AST for functions, methods,
	 * classes, properties and constants). The raw block is cleaned and
	 * recomposed so `doc_comment` contains the summary, every doc-tag
	 * (@param/@return/@throws/@deprecated) and a visible `[DEPRECATED]` marker.
	 */
	private extractDocComment(node: TSNode): string | null {
		const prev = node.previousNamedSibling;
		if (prev && prev.type === COMMENT) {
			return serializeDocBlock(prev.text);
		}
		return null;
	}
}
