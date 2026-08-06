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
 * text): `visibility? static? name(typedParams): returnType`. Parameters are
 * rendered from `formal_parameters` children (simple_parameter,
 * variadic_parameter, property_promotion_parameter) preserving each param's
 * type, by-ref/variadic marker and default value; the return type is read from
 * the `return_type` field (named_type, primitive_type, optional_type,
 * union_type, intersection_type, bottom_type, ...). Functions/methods without
 * an explicit return type omit the `: type` suffix.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";

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
const READONLY_MODIFIER = "readonly_modifier";
const COMMENT = "comment";
const DECLARATION_LIST = "declaration_list";
const NAMESPACE_USE_DECLARATION = "namespace_use_declaration";
const NAMESPACE_USE_CLAUSE = "namespace_use_clause";
const NAMESPACE_USE_GROUP = "namespace_use_group";
const NAMESPACE_NAME = "namespace_name";

export class PhpVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
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
			symbols.push(this.makeSymbol(symbolNode, rawName, SymbolKind.Variable, parentName));
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
			symbols.push(this.makeSymbolWithSignature(symbolNode, nameNode.text, SymbolKind.Constant, parentName, signature));
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
		const prefix = this.extractMethodModifiers(funcNode);
		const params = this.extractParameters(funcNode.childForFieldName("parameters"));
		const returnType = this.extractReturnType(funcNode);
		let signature = `${prefix}${name}(${params})`;
		if (returnType) {
			signature += `: ${returnType}`;
		}
		return signature;
	}

	/**
	 * Collect visibility (public/protected/private) and static modifiers from a
	 * method_declaration node as a space-separated prefix (e.g. `protected
	 * static `). Functions have no modifiers, so the prefix is empty. Modifier
	 * nodes are named children, not fields.
	 */
	private extractMethodModifiers(node: TSNode): string {
		const parts: string[] = [];
		for (const child of node.namedChildren) {
			if (child.type === VISIBILITY_MODIFIER || child.type === STATIC_MODIFIER) {
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

	private makeSymbol(node: TSNode, name: string, kind: SymbolKind, parentName: string | null): ParsedSymbol {
		return this.makeSymbolWithSignature(node, name, kind, parentName, this.buildSignature(node));
	}

	/** Like makeSymbol, but with an explicit signature (used for focused
	 * per-element previews such as `NAME = value` for constants). */
	private makeSymbolWithSignature(
		node: TSNode,
		name: string,
		kind: SymbolKind,
		parentName: string | null,
		signature: string
	): ParsedSymbol {
		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature,
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
				.replace(/^\/\/\s?/, "")
				.replace(/^\/\*\*?\s?/, "")
				.replace(/\s?\*\/$/, "")
				.trim();
		}
		return null;
	}
}
