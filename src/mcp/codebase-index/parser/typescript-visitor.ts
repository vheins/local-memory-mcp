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
 *
 * Grammar node-type constants and standalone helpers live in sibling modules
 * (ts-node-types, ts-export-scanner, ts-doc-comment, ts-signature,
 * ts-reference-emission) — this file keeps only the visitor walkers and
 * symbol construction (TASK-267 split).
 */

import type { Node as TSNode, Tree as TSTree } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "./language-visitor";
import { SymbolKind } from "./language-visitor";
import {
	ABSTRACT_CLASS_DECLARATION,
	ABSTRACT_METHOD_SIGNATURE,
	ARROW_FUNCTION,
	CALL_EXPRESSION,
	CLASS_BODY,
	CLASS_DECLARATION,
	ENUM_ASSIGNMENT,
	ENUM_BODY,
	ENUM_DECLARATION,
	EXPORT_STATEMENT,
	FIELD_DEFINITION,
	FUNCTION_DECLARATION,
	GENERATOR_FUNCTION_DECLARATION,
	IMPORT_STATEMENT,
	INDEX_SIGNATURE,
	INTERFACE_DECLARATION,
	INTERFACE_BODY,
	LEXICAL_DECLARATION,
	METHOD_DEFINITION,
	METHOD_SIGNATURE,
	NEW_EXPRESSION,
	PROPERTY_IDENTIFIER,
	PROPERTY_SIGNATURE,
	PUBLIC_FIELD_DEFINITION,
	TYPE_ALIAS_DECLARATION,
	VARIABLE_DECLARATION
} from "./ts-node-types";
import { scanExports, getNameFromDeclaration } from "./ts-export-scanner";
import { extractDocComment } from "./ts-doc-comment";
import { buildSignature, collectDecorators, symbolIdentifier, withDecorators } from "./ts-signature";
import {
	calledExpressionName,
	constructorName,
	emitHeritage,
	emitImports,
	emitReexports,
	emitTypeReferences
} from "./ts-reference-emission";

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
	 * Emit call-site references (TASK-236 / issue #64) + heritage edges
	 * (TASK-301 / Phase 1.1).
	 *
	 * Cheap single AST pass emitting only obvious call targets:
	 * - `call_expression` → kind 'call' (the called identifier / last property
	 *   of a member expression — e.g. `foo()` → 'foo', `ns.helper()` → 'helper').
	 * - `new_expression` → kind 'instantiation' (the constructed class).
	 * - `import_statement` → kind 'import' (each imported binding; default and
	 *   named imports, minus import specifiers aliased to 'default').
	 * - class/abstract class/interface declarations → kind 'extends'/'implements'
	 *   per heritage target (`class Foo extends Bar implements I` emits Bar as
	 *   'extends' and I as 'implements'; `interface A extends B` emits B as
	 *   'extends'; `class Foo<T extends Bar>` emits Bar as 'extends').
	 *
	 * `callerName` is the enclosing function/method name, tracked while
	 * descending into function/method/arrow bodies (null for heritage edges —
	 * they belong to the derived type's declaration). No attempt is made to
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
				const name = calledExpressionName(node);
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
				const name = constructorName(ctor);
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
				emitImports(node, callerName, refs);
				// Do NOT recurse into import children — the import clause itself is
				// the only meaningful reference surface here.
				return;
			}
			case EXPORT_STATEMENT: {
				const source = node.childForFieldName("source");
				if (source) {
					// Re-export-from (`export { X } from './mod'` / `export * from './mod'`):
					// emit the reexport edge(s); the clause carries no nested call sites.
					emitReexports(node, callerName, refs);
					return;
				}
				// Local exports (`export { x }`, `export const y = ...`): descend so
				// any call-site / type refs inside the exported declaration emit.
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			// Heritage edges (Phase 1.1 / TASK-301): emit 'extends'/'implements'
			// for the declaration's class heritage + generics constraints, then
			// recurse into the body so call-site refs inside members still emit.
			case CLASS_DECLARATION:
			case ABSTRACT_CLASS_DECLARATION:
			case INTERFACE_DECLARATION: {
				emitHeritage(node, refs);
				// Type edges (TASK-008 / issue #82): the declaration's own
				// generic constraints + (for interfaces) property/method type
				// surfaces. Class fields/methods are reached when the walker
				// descends into the body below. callerName is null at the
				// declaration level — only functions/methods carry their name
				// (constraint edges on classes/interfaces are attributed to the
				// declaration, i.e. no caller).
				emitTypeReferences(node, null, refs);
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			// Type-alias declarations (TASK-008 / issue #82): emit the alias
			// value's type edges + generic constraints, then descend so nested
			// call sites still emit.
			case TYPE_ALIAS_DECLARATION: {
				emitTypeReferences(node, this.declaredName(node), refs);
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			// Descend into function-like bodies, updating the enclosing caller name
			// so call sites inside them are attributed to the right function.
			case "function_declaration":
			case "generator_function_declaration":
			case "function_expression":
			case "arrow_function": {
				const fnName = this.declaredName(node);
				// Type edges (TASK-008 / issue #82): parameter + return types of
				// the function's own signature.
				emitTypeReferences(node, fnName, refs);
				for (const child of node.namedChildren) {
					this.walkReferences(child, fnName ?? callerName, refs);
				}
				return;
			}
			case "method_definition": {
				const methodName = this.declaredName(node) ?? symbolIdentifier(node);
				// Type edges: the method's own parameter + return types.
				emitTypeReferences(node, methodName, refs);
				for (const child of node.namedChildren) {
					this.walkReferences(child, methodName ?? callerName, refs);
				}
				return;
			}
			case "method_signature":
			case "abstract_method_signature": {
				// Type edges for interface/abstract method signatures — these
				// have no body to descend into, so emit + return.
				const sigName = this.declaredName(node) ?? symbolIdentifier(node);
				emitTypeReferences(node, sigName, refs);
				return;
			}
			case "public_field_definition":
			case "field_definition":
			case "property_signature": {
				// Type edges for class fields / interface properties.
				emitTypeReferences(node, callerName, refs);
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			default:
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
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
			signature: this.decoratedSignature(node, decorators),
			docComment: extractDocComment(node),
			exported: false,
			defaultExport: false,
			parentName
		};
	}

	/** Build the decorated signature for a node: `@Decorator()` prefixed onto the base signature. */
	private decoratedSignature(node: TSNode, decorators: string[]): string {
		return withDecorators(buildSignature(node), decorators);
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
			signature: this.decoratedSignature(node, decorators),
			docComment: extractDocComment(node),
			exported,
			defaultExport,
			parentName
		};
	}
}
