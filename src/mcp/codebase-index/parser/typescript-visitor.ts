/**
 * TypeScriptVisitor — extracts symbols from TypeScript/JavaScript source using
 * tree-sitter's AST. Implements the LanguageVisitor interface.
 *
 * Symbol extraction:
 * - Top-level declarations: functions, classes, interfaces, type aliases, enums,
 *   variable/lexical declarations, arrow functions.
 * - Class body: methods + fields (with accessibility modifiers / readonly),
 *   decorated members (@Injectable, @Component, etc.).
 * - Interface body: property signatures → Property, method signatures → Method,
 *   parented to the interface.
 * - Enum members → Constant, parented to the enum.
 * - Generic `type_parameters` are retained in signatures (TASK-059).
 */

import type { Node as TSNode, Tree as TSTree } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "./language-visitor";
import { SymbolKind } from "./language-visitor";
import { serializeDocBlock } from "./doc-comment";

// ── Node type constants ──────────────────────────────────────────────

const FUNCTION_DECLARATION = "function_declaration";
const GENERATOR_FUNCTION_DECLARATION = "generator_function_declaration";
const METHOD_DEFINITION = "method_definition";
const CLASS_DECLARATION = "class_declaration";
const ABSTRACT_CLASS_DECLARATION = "abstract_class_declaration";
const CLASS_BODY = "class_body";
const INTERFACE_DECLARATION = "interface_declaration";
const INTERFACE_BODY = "interface_body";
const TYPE_ALIAS_DECLARATION = "type_alias_declaration";
const ENUM_DECLARATION = "enum_declaration";
const ENUM_BODY = "enum_body";
const VARIABLE_DECLARATION = "variable_declaration";
const LEXICAL_DECLARATION = "lexical_declaration";
const ARROW_FUNCTION = "arrow_function";
const EXPORT_STATEMENT = "export_statement";
const NAMED_EXPORTS = "export_clause";
const EXPORT_SPECIFIER = "export_specifier";
const COMMENT = "comment";

// TS-specific member / type nodes.
const PROPERTY_SIGNATURE = "property_signature";
const METHOD_SIGNATURE = "method_signature";
const ABSTRACT_METHOD_SIGNATURE = "abstract_method_signature";
const INDEX_SIGNATURE = "index_signature";
const ENUM_ASSIGNMENT = "enum_assignment";
const PUBLIC_FIELD_DEFINITION = "public_field_definition";
const FIELD_DEFINITION = "field_definition";
const PROPERTY_IDENTIFIER = "property_identifier";
const DECORATOR = "decorator";

// Call-site / import node types (reference emission, TASK-236 / issue #64).
const CALL_EXPRESSION = "call_expression";
const NEW_EXPRESSION = "new_expression";
const MEMBER_EXPRESSION = "member_expression";
const IMPORT_STATEMENT = "import_statement";
const IMPORT_CLAUSE = "import_clause";
const NAMED_IMPORTS = "named_imports";
const IMPORT_SPECIFIER = "import_specifier";
const NAMESPACE_IMPORT = "namespace_import";

// ── Export scanner ───────────────────────────────────────────────────

/**
 * Pre-scan export statements to build a map of exported names.
 * Returns sets of exported names and default-exported names.
 */
function scanExports(root: TSNode): {
	exportedNames: Set<string>;
	defaultExportNames: Set<string>;
} {
	const exportedNames = new Set<string>();
	const defaultExportNames = new Set<string>();

	function walk(node: TSNode): void {
		if (node.type === EXPORT_STATEMENT) {
			// Check for default keyword
			for (const child of node.children) {
				if (child.type === "default") {
					const declaration = node.children.find(
						(c: TSNode): boolean =>
							c.isNamed &&
							[
								FUNCTION_DECLARATION,
								GENERATOR_FUNCTION_DECLARATION,
								CLASS_DECLARATION,
								ABSTRACT_CLASS_DECLARATION,
								INTERFACE_DECLARATION,
								TYPE_ALIAS_DECLARATION,
								ENUM_DECLARATION,
								VARIABLE_DECLARATION,
								LEXICAL_DECLARATION
							].includes(c.type)
					);
					if (declaration) {
						const name = getNameFromDeclaration(declaration);
						if (name) {
							defaultExportNames.add(name);
							exportedNames.add(name);
						}
					} else {
						const afterDefault = node.children
							.slice(node.children.indexOf(child) + 1)
							.find((c: TSNode): boolean => c.isNamed);
						if (afterDefault?.type === "identifier") {
							defaultExportNames.add(afterDefault.text);
							exportedNames.add(afterDefault.text);
						}
					}
					break;
				}
			}

			// Named export: export { x, y as z }
			const exportClause = node.descendantsOfType(NAMED_EXPORTS)[0];
			if (exportClause) {
				for (const spec of exportClause.children) {
					if (spec.type === EXPORT_SPECIFIER) {
						const nameNode = spec.namedChildren[0];
						if (nameNode) exportedNames.add(nameNode.text);
					}
				}
			}

			// export const/let/function/class (bare export)
			const bareDeclaration = node.children
				.slice(1)
				.find(
					(c: TSNode): boolean =>
						c.isNamed &&
						[
							FUNCTION_DECLARATION,
							GENERATOR_FUNCTION_DECLARATION,
							CLASS_DECLARATION,
							ABSTRACT_CLASS_DECLARATION,
							INTERFACE_DECLARATION,
							TYPE_ALIAS_DECLARATION,
							ENUM_DECLARATION,
							LEXICAL_DECLARATION,
							VARIABLE_DECLARATION
						].includes(c.type)
				);
			if (bareDeclaration) {
				for (const n of getDeclaredNames(bareDeclaration)) {
					exportedNames.add(n);
				}
			}
		}

		for (const child of node.children) {
			walk(child);
		}
	}

	walk(root);
	return { exportedNames, defaultExportNames };
}

/** Extract the identifier name from a declaration node. */
function getNameFromDeclaration(node: TSNode): string | null {
	if (node.type === VARIABLE_DECLARATION || node.type === LEXICAL_DECLARATION) {
		const declarator = node.descendantsOfType("variable_declarator")[0];
		if (declarator) {
			return declarator.namedChildren[0]?.text ?? null;
		}
	}
	// Skip leading `decorator` children (e.g. `@Injectable() class Foo {}` has the
	// decorator as its first named child) so the declaration's real name is used.
	for (const child of node.namedChildren) {
		if (child.type === DECORATOR) continue;
		if (isNameNode(child)) return child.text;
	}
	return null;
}

/** Get all declared names from a declaration. */
function getDeclaredNames(node: TSNode): string[] {
	if (node.type === VARIABLE_DECLARATION || node.type === LEXICAL_DECLARATION) {
		return node
			.descendantsOfType("variable_declarator")
			.map((d: TSNode) => d.firstNamedChild?.text ?? null)
			.filter((n: string | null): n is string => n !== null);
	}
	const name = getNameFromDeclaration(node);
	return name ? [name] : [];
}

// ── Doc comment extraction ───────────────────────────────────────────

/**
 * Find the JSDoc comment immediately preceding a node and serialize it as a
 * structured, searchable summary + tags string (see doc-comment.ts).
 *
 * The comment is usually the node's previous named sibling (verified against
 * the live WASM AST for functions, class members and fields). Two cases need
 * special handling:
 * - `export function foo() {...}` wraps the declaration in an `export_statement`,
 *   so the inner declaration's previous sibling is empty — climb to the export
 *   statement to find the JSDoc that precedes it.
 * - Decorated members are preceded by a `decorator` sibling, not the comment —
 *   the loop continues past the decorator to find the JSDoc.
 */
function extractDocComment(node: TSNode): string | null {
	let sibling: TSNode | null = node.previousNamedSibling;

	// Declarations wrapped in `export ...` have no preceding sibling of their
	// own; the JSDoc siblings the export_statement instead.
	if (!sibling && node.parent && node.parent.type === "export_statement") {
		sibling = node.parent.previousNamedSibling;
	}

	while (sibling) {
		if (sibling.type === COMMENT) {
			const text = sibling.text;
			if (text.startsWith("/**") || text.startsWith("///")) {
				return serializeDocBlock(text);
			}
		}
		// Only continue through comment / decorator siblings. Stopping at any
		// other node (another declaration, statement, etc.) prevents grabbing a
		// comment that actually belongs to a *previous* symbol.
		if (sibling.type !== DECORATOR) break;
		sibling = sibling.previousNamedSibling;
	}

	return null;
}

// ── Signature extraction ────────────────────────────────────────────

/** Collapse whitespace/newlines in a source snippet to a single line. */
function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * Collect decorator texts applied directly to a node.
 *
 * tree-sitter-typescript models decorators in two ways:
 * - A `decorator` node that is a NAMED CHILD of the declaration
 *   (e.g. `class_declaration` for `@Injectable() class Foo {}`).
 * - A `decorator` node that is the PRECEDING SIBLING of the declaration
 *   (e.g. a decorated method inside `class_body`, or `@Injectable() class`
 *   nested inside an `export_statement`).
 *
 * Returns the decorator texts in source order (e.g. `["@Injectable()"]`).
 */
function collectDecorators(node: TSNode): string[] {
	const decorators: string[] = [];

	// Direct named children (bare decorated classes).
	for (const child of node.namedChildren) {
		if (child.type === DECORATOR) {
			decorators.push(normalizeText(child.text));
		}
	}

	// Preceding sibling decorators (decorated methods, exported decorated classes).
	let sibling: TSNode | null = node.previousNamedSibling;
	while (sibling && sibling.type === DECORATOR) {
		decorators.unshift(normalizeText(sibling.text));
		sibling = sibling.previousNamedSibling;
	}

	return decorators;
}

/**
 * Build a human-readable signature from the declaration.
 *
 * Returns the first meaningful source line of the declaration normalized to a
 * single line, which naturally preserves accessibility modifiers
 * (`private readonly`), the `readonly` keyword, type annotations, and generic
 * `type_parameters` (e.g. `function foo<T>(x: T): T`).
 *
 * When the node carries decorator children (decorated fields/methods/classes),
 * their exact span is stripped from the output so the base signature is the
 * declaration itself — the decorators are then re-prefixed by the caller.
 */
function buildSignature(node: TSNode): string {
	let text = node.text;

	// Strip decorator child spans. Decorators are re-added as a prefix by
	// `withDecorators()`, so without this they would leak into (duplicate) the
	// base signature and truncate the real declaration line.
	for (const child of node.namedChildren) {
		if (child.type === DECORATOR) {
			text = text.replace(child.text, "");
		}
	}

	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	return normalizeText(lines[0] ?? "");
}

/** Whether a node represents a declarable identifier (class/type/function name or property). */
function isNameNode(node: TSNode): boolean {
	switch (node.type) {
		case "identifier":
		case "type_identifier":
		case PROPERTY_IDENTIFIER:
		case "shorthand_property_identifier_pattern":
			return true;
		default:
			return false;
	}
}

// ── Visitor implementation ───────────────────────────────────────────

/** The set of node types that represent top-level declarations. */
const TOP_LEVEL_TYPES = new Set([
	FUNCTION_DECLARATION,
	GENERATOR_FUNCTION_DECLARATION,
	CLASS_DECLARATION,
	ABSTRACT_CLASS_DECLARATION,
	INTERFACE_DECLARATION,
	TYPE_ALIAS_DECLARATION,
	ENUM_DECLARATION,
	LEXICAL_DECLARATION,
	VARIABLE_DECLARATION
]);

/** The kinds of class members extracted inside a class body. */
const CLASS_MEMBER_KINDS = new Set([
	METHOD_DEFINITION,
	ABSTRACT_METHOD_SIGNATURE,
	PUBLIC_FIELD_DEFINITION,
	FIELD_DEFINITION
]);

export class TypeScriptVisitor implements LanguageVisitor {
	/** Walk a parsed tree and extract all symbols. */
	extractSymbols(tree: TSTree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];

		const { exportedNames, defaultExportNames } = scanExports(root);

		this.walkNode(root, symbols, null, exportedNames, defaultExportNames, false);

		return symbols;
	}

	/**
	 * Emit call-site references (TASK-236 / issue #64).
	 *
	 * Cheap single AST pass emitting only obvious call targets:
	 * - `call_expression` → kind 'call' (the called identifier / last property
	 *   of a member expression — e.g. `foo()` → 'foo', `ns.helper()` → 'helper').
	 * - `new_expression` → kind 'instantiation' (the constructed class).
	 * - `import_statement` → kind 'import' (each imported binding; default and
	 *   named imports, minus import specifiers aliased to 'default').
	 *
	 * `callerName` is the enclosing function/method name, tracked while
	 * descending into function/method/arrow bodies. No attempt is made to
	 * resolve symbols or follow aliases — we index the textual call target.
	 */
	extractReferences(tree: TSTree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		this.walkReferences(tree.rootNode, null, refs);
		return refs;
	}

	private walkReferences(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
		switch (node.type) {
			case CALL_EXPRESSION: {
				const name = this.calledExpressionName(node);
				if (name) {
					refs.push({
						symbolName: name,
						callerFile: "",
						callerLine: node.startPosition.row + 1,
						callerName,
						kind: "call"
					});
				}
				// Recurse into children so nested calls (`foo().bar()`) are also
				// indexed — the enclosing name for the children is still the same.
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			case NEW_EXPRESSION: {
				const ctor = node.childForFieldName("constructor") ?? node.firstNamedChild;
				const name = this.constructorName(ctor);
				if (name) {
					refs.push({
						symbolName: name,
						callerFile: "",
						callerLine: node.startPosition.row + 1,
						callerName,
						kind: "instantiation"
					});
				}
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			case IMPORT_STATEMENT: {
				this.emitImports(node, callerName, refs);
				// Do NOT recurse into import children — the import clause itself is
				// the only meaningful reference surface here.
				return;
			}
			// Descend into function-like bodies, updating the enclosing caller name
			// so call sites inside them are attributed to the right function.
			case "function_declaration":
			case "generator_function_declaration":
			case "function_expression":
			case "arrow_function": {
				const fnName = this.declaredName(node);
				for (const child of node.namedChildren) {
					this.walkReferences(child, fnName ?? callerName, refs);
				}
				return;
			}
			case "method_definition": {
				const methodName = this.declaredName(node) ?? symbolIdentifier(node);
				for (const child of node.namedChildren) {
					this.walkReferences(child, methodName ?? callerName, refs);
				}
				return;
			}
			default:
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
		}
	}

	/** Resolve the referenced name of a call/instantiation expression. */
	private calledExpressionName(node: TSNode): string | null {
		const fn = node.firstNamedChild;
		if (!fn) return null;
		if (fn.type === MEMBER_EXPRESSION) {
			return this.memberPropertyName(fn);
		}
		if (fn.type === CALL_EXPRESSION) {
			// `foo().bar()` — the outer call's target is `foo().bar`, so the
			// member property is the meaningful callee.
			const member = fn.firstNamedChild;
			if (member?.type === MEMBER_EXPRESSION) {
				return this.memberPropertyName(member);
			}
		}
		return fn.text;
	}

	/** Name of the property accessed by a member expression (e.g. `helper` from `ns.helper`). */
	private memberPropertyName(member: TSNode): string | null {
		return member.childForFieldName("property")?.text ?? member.lastNamedChild?.text ?? null;
	}

	private constructorName(ctor: TSNode | null | undefined): string | null {
		if (!ctor) return null;
		if (ctor.type === MEMBER_EXPRESSION) {
			return this.memberPropertyName(ctor) ?? ctor.text;
		}
		return ctor.text;
	}

	/** Emit one 'import' reference per imported binding in an import_statement. */
	private emitImports(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
		const clause = node.childForFieldName("import_clause") ?? node.namedChildren.find((c) => c.type === IMPORT_CLAUSE);
		if (!clause) return; // `import "x";` side-effect import — no binding to reference

		const line = node.startPosition.row + 1;

		// Default-import binding: `import Foo from "x"` → clause's first named child is an identifier.
		const defaultImport = clause.namedChildren.find((c) => c.type === "identifier");
		if (defaultImport && defaultImport.text.length > 0) {
			refs.push({
				symbolName: defaultImport.text,
				callerFile: "",
				callerLine: line,
				callerName: callerName,
				kind: "import"
			});
		}

		// Named imports: `import { a, b } from "x"`.
		const named = clause.namedChildren.find((c) => c.type === NAMED_IMPORTS);
		if (named) {
			for (const spec of named.namedChildren) {
				if (spec.type !== IMPORT_SPECIFIER) continue;
				const nameNode = spec.childForFieldName("name");
				const imported = nameNode?.text;
				if (!imported || imported === "default") continue; // skip rebindings aliased to `default`
				refs.push({ symbolName: imported, callerFile: "", callerLine: line, callerName: callerName, kind: "import" });
			}
		}

		// Namespace import `import * as ns` — the imported (namespace) binding is
		// ambiguous; index the specifier so `ns` appears as the referenced symbol.
		const nsImport = clause.namedChildren.find((c) => c.type === NAMESPACE_IMPORT);
		if (nsImport) {
			const alias = (nsImport.lastNamedChild?.text ?? "").replace(/^as\s*/, "");
			if (alias) {
				refs.push({ symbolName: alias, callerFile: "", callerLine: line, callerName: callerName, kind: "import" });
			}
		}
	}

	/** Best-effort name of a declaration/function node for caller attribution. */
	private declaredName(node: TSNode): string | null {
		const name = getNameFromDeclaration(node);
		if (name) return name;
		return symbolIdentifier(node);
	}

	// ── Recursive AST walker ────────────────────────────────────

	private walkNode(
		node: TSNode,
		symbols: ParsedSymbol[],
		parentName: string | null,
		exportedNames: Set<string>,
		defaultExportNames: Set<string>,
		insideClass: boolean
	): void {
		// If we're inside a class/interface, only look for members, skip nested declarations
		if (insideClass) {
			if (CLASS_MEMBER_KINDS.has(node.type)) {
				const kind =
					node.type === METHOD_DEFINITION || node.type === ABSTRACT_METHOD_SIGNATURE
						? SymbolKind.Method
						: SymbolKind.Property;
				symbols.push(this.nodeToSymbol(node, kind, parentName, exportedNames, defaultExportNames));
			}
			// Recurse into children of the class body (decorators, nested getters, etc.)
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, exportedNames, defaultExportNames, true);
			}
			return;
		}

		const type = node.type;

		if (TOP_LEVEL_TYPES.has(type)) {
			if (type === LEXICAL_DECLARATION || type === VARIABLE_DECLARATION) {
				this.handleVariableDeclaration(node, symbols, parentName, exportedNames, defaultExportNames);
			} else {
				this.handleDeclaration(node, symbols, parentName, exportedNames, defaultExportNames);
			}
			return;
		}

		// Handle export statements wrapping declarations
		if (node.type === EXPORT_STATEMENT) {
			// Already pre-scanned for export names; just recurse to find declarations
			for (const child of node.namedChildren) {
				if (TOP_LEVEL_TYPES.has(child.type)) {
					if (child.type === LEXICAL_DECLARATION || child.type === VARIABLE_DECLARATION) {
						this.handleVariableDeclaration(child, symbols, parentName, exportedNames, defaultExportNames);
					} else {
						this.handleDeclaration(child, symbols, parentName, exportedNames, defaultExportNames);
					}
				}
			}
			return;
		}

		// Recurse into children for any node we haven't explicitly handled
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, exportedNames, defaultExportNames, false);
		}
	}

	// ── Declaration handlers ────────────────────────────────────

	private handleDeclaration(
		node: TSNode,
		symbols: ParsedSymbol[],
		parentName: string | null,
		exportedNames: Set<string>,
		defaultExportNames: Set<string>
	): void {
		const kind = this.nodeTypeToKind(node.type);
		if (!kind) return;

		const name = getNameFromDeclaration(node);
		if (!name) return;

		symbols.push(this.nodeToSymbol(node, kind, parentName, exportedNames, defaultExportNames));

		// Recurse into class body for methods/properties. All class members share
		// the class's parent context — decorators on individual members are
		// resolved via their own preceding-sibling decorator nodes.
		if (node.type === CLASS_DECLARATION || node.type === ABSTRACT_CLASS_DECLARATION) {
			const body = node.descendantsOfType(CLASS_BODY)[0];
			if (body) {
				this.walkNode(body, symbols, name, exportedNames, defaultExportNames, true);
			}
		}

		// Emit interface members (properties, methods) parented to the interface.
		if (node.type === INTERFACE_DECLARATION) {
			this.handleInterfaceMembers(name, node, symbols);
		}

		// Emit enum members (constants) parented to the enum.
		if (node.type === ENUM_DECLARATION) {
			this.handleEnumMembers(name, node, symbols);
		}
	}

	/** Emit `property_signature`/`method_signature` members as Property/Method symbols. */
	private handleInterfaceMembers(interfaceName: string, node: TSNode, symbols: ParsedSymbol[]): void {
		const body = node.namedChildren.find((c) => c.type === INTERFACE_BODY);
		if (!body) return;

		for (const member of body.namedChildren) {
			switch (member.type) {
				case PROPERTY_SIGNATURE:
					symbols.push(
						this.memberSymbol(member, symbolIdentifier(member) ?? "unknown", SymbolKind.Property, interfaceName)
					);
					break;
				case METHOD_SIGNATURE:
					// In this grammar version (tree-sitter-typescript ^0.23) interface
					// getters/setters parse as `method_signature`, whose first child
					// is the anonymous `get`/`set` keyword — the same as plain methods.
					// They are intentionally emitted as Method (consistent with class
					// accessors, which parse as `method_definition` → Method).
					symbols.push(
						this.memberSymbol(member, symbolIdentifier(member) ?? "unknown", SymbolKind.Method, interfaceName)
					);
					break;
				// `[key: string]: unknown` index signatures have no single identifier —
				// skip them rather than fabricate a misleading name.
				case INDEX_SIGNATURE:
				default:
					break;
			}
		}
	}

	/** Emit enum members (with or without explicit values) as Constant symbols. */
	private handleEnumMembers(enumName: string, node: TSNode, symbols: ParsedSymbol[]): void {
		const body = node.namedChildren.find((c) => c.type === ENUM_BODY);
		if (!body) return;

		for (const member of body.namedChildren) {
			if (member.type === ENUM_ASSIGNMENT) {
				const memberName = member.namedChildren[0]?.text ?? "unknown";
				symbols.push(this.memberSymbol(member, memberName, SymbolKind.Constant, enumName));
			} else if (member.type === PROPERTY_IDENTIFIER) {
				// Bare member without an explicit value: `enum { Red, Green }`.
				symbols.push(this.memberSymbol(member, member.text, SymbolKind.Constant, enumName));
			}
		}
	}

	private handleVariableDeclaration(
		node: TSNode,
		symbols: ParsedSymbol[],
		parentName: string | null,
		exportedNames: Set<string>,
		defaultExportNames: Set<string>
	): void {
		for (const declarator of node.descendantsOfType("variable_declarator")) {
			const nameNode = declarator.firstNamedChild;
			if (!nameNode) continue;

			const valueNode = declarator.namedChildren[1];
			const isFunction = valueNode?.type === ARROW_FUNCTION;
			const kind = isFunction ? SymbolKind.Function : SymbolKind.Variable;

			symbols.push(this.nodeToSymbol(declarator, kind, parentName, exportedNames, defaultExportNames));
		}
	}

	// ── Helpers ─────────────────────────────────────────────────

	private nodeTypeToKind(nodeType: string): SymbolKind | null {
		switch (nodeType) {
			case FUNCTION_DECLARATION:
			case GENERATOR_FUNCTION_DECLARATION:
				return SymbolKind.Function;
			case CLASS_DECLARATION:
			case ABSTRACT_CLASS_DECLARATION:
				return SymbolKind.Class;
			case INTERFACE_DECLARATION:
				return SymbolKind.Interface;
			case TYPE_ALIAS_DECLARATION:
				return SymbolKind.Type;
			case ENUM_DECLARATION:
				return SymbolKind.Enum;
			case METHOD_DEFINITION:
				return SymbolKind.Method;
			default:
				return null;
		}
	}

	/** Build a ParsedSymbol for a class/interface/enum member (never top-level). */
	private memberSymbol(node: TSNode, name: string, kind: SymbolKind, parentName: string | null): ParsedSymbol {
		const decorators = collectDecorators(node);
		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: this.withDecorators(buildSignature(node), decorators),
			docComment: extractDocComment(node),
			exported: false,
			defaultExport: false,
			parentName
		};
	}

	/** Prefix decorator texts to a signature, e.g. `@Injectable() class Foo {`. */
	private withDecorators(signature: string, decorators: string[]): string {
		if (decorators.length === 0) return signature;
		return decorators.concat([signature]).join(" ");
	}

	private nodeToSymbol(
		node: TSNode,
		kind: SymbolKind,
		parentName: string | null,
		exportedNames: Set<string>,
		defaultExportNames: Set<string>
	): ParsedSymbol {
		// Resolve the name
		let name: string;
		if (node.type === "variable_declarator") {
			name = node.firstNamedChild?.text ?? "unknown";
		} else if (kind === SymbolKind.Property || kind === SymbolKind.Method) {
			// Class members are named by their `property_identifier`. Prefer it over
			// the first named child, which may be an `accessibility_modifier`
			// (`private readonly apiKey` would otherwise be named "private").
			name = symbolIdentifier(node) ?? node.descendantsOfType(PROPERTY_IDENTIFIER)[0]?.text ?? "unknown";
		} else {
			// Top-level declarations; skip decorators (bare `@Injectable() class Foo {}`).
			name = getNameFromDeclaration(node) ?? node.namedChildren[0]?.text ?? "unknown";
		}

		const exported = exportedNames.has(name);
		const defaultExport = defaultExportNames.has(name);

		const decorators = collectDecorators(node);

		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: this.withDecorators(buildSignature(node), decorators),
			docComment: extractDocComment(node),
			exported,
			defaultExport,
			parentName
		};
	}
}

/** Return the first yielded child that carries a declarable identifier name. */
function symbolIdentifier(node: TSNode): string | null {
	for (const child of node.namedChildren) {
		if (isNameNode(child)) return child.text;
	}
	return null;
}
