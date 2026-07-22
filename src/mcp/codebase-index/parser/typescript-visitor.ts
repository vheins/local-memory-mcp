/**
 * TypeScriptVisitor — extracts symbols from TypeScript/JavaScript source using
 * tree-sitter's AST. Implements the LanguageVisitor interface.
 */

import type { Node as TSNode, Tree as TSTree } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "./language-visitor.js";
import { SymbolKind } from "./language-visitor.js";

// ── Node type constants ──────────────────────────────────────────────

const FUNCTION_DECLARATION = "function_declaration";
const GENERATOR_FUNCTION_DECLARATION = "generator_function_declaration";
const METHOD_DEFINITION = "method_definition";
const CLASS_DECLARATION = "class_declaration";
const INTERFACE_DECLARATION = "interface_declaration";
const TYPE_ALIAS_DECLARATION = "type_alias_declaration";
const ENUM_DECLARATION = "enum_declaration";
const VARIABLE_DECLARATION = "variable_declaration";
const LEXICAL_DECLARATION = "lexical_declaration";
const ARROW_FUNCTION = "arrow_function";
const EXPORT_STATEMENT = "export_statement";
const NAMED_EXPORTS = "export_clause";
const EXPORT_SPECIFIER = "export_specifier";
const COMMENT = "comment";

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
	return node.namedChildren[0]?.text ?? null;
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

/** Find the JSDoc comment immediately preceding a node. */
function extractDocComment(node: TSNode): string | null {
	let sibling: TSNode | null = node.previousNamedSibling;

	while (sibling) {
		if (sibling.type === COMMENT) {
			const text = sibling.text;
			if (text.startsWith("/**") || text.startsWith("///")) {
				return cleanDocComment(text);
			}
		}
		sibling = sibling.previousNamedSibling;
	}

	return null;
}

function cleanDocComment(raw: string): string {
	return raw
		.replace(/^\/\*\*?\s*/, "")
		.replace(/\s*\*\/$/, "")
		.split("\n")
		.map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
		.filter((line) => line.length > 0 && line !== "*")
		.join("\n")
		.trim();
}

// ── Signature extraction ────────────────────────────────────────────

/** Build a human-readable signature from the first line of the node text. */
function buildSignature(node: TSNode): string {
	const fullText = node.text;
	const firstLine = fullText.split("\n")[0] ?? fullText;
	return firstLine.replace(/\s+/g, " ").trim();
}

// ── Visitor implementation ───────────────────────────────────────────

/** The set of node types that represent top-level declarations. */
const TOP_LEVEL_TYPES = new Set([
	FUNCTION_DECLARATION,
	GENERATOR_FUNCTION_DECLARATION,
	CLASS_DECLARATION,
	INTERFACE_DECLARATION,
	TYPE_ALIAS_DECLARATION,
	ENUM_DECLARATION,
	LEXICAL_DECLARATION,
	VARIABLE_DECLARATION
]);

export class TypeScriptVisitor implements LanguageVisitor {
	supportedExtensions(): string[] {
		return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
	}

	/**
	 * Parse source by extracting symbols from a pre-parsed tree.
	 * The ParserPool handles WASM, parser construction, and calling this.
	 */
	parse(sourceCode: string, filePath: string): ParsedSymbol[] {
		// This method is called with a tree passed to the pool.
		// Direct calls construct their own parser — used in tests.
		return [];
	}

	/** Walk a parsed tree and extract all symbols. */
	extractSymbols(tree: TSTree, sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];

		const { exportedNames, defaultExportNames } = scanExports(root);

		this.walkNode(root, symbols, null, exportedNames, defaultExportNames, false);

		return symbols;
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
		// If we're inside a class, only look for methods/properties, skip nested declarations
		if (insideClass) {
			if (node.type === METHOD_DEFINITION) {
				symbols.push(this.nodeToSymbol(node, SymbolKind.Method, parentName, exportedNames, defaultExportNames));
			} else if (node.type === "public_field_definition" || node.type === "field_definition") {
				symbols.push(this.nodeToSymbol(node, SymbolKind.Property, parentName, exportedNames, defaultExportNames));
			}
			// Recurse into children of the class body
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

		// Recurse into class body for methods/properties
		if (node.type === CLASS_DECLARATION) {
			const body = node.descendantsOfType("class_body")[0];
			if (body) {
				this.walkNode(body, symbols, name, exportedNames, defaultExportNames, true);
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

	private nodeToSymbol(
		node: TSNode,
		kind: SymbolKind,
		parentName: string | null,
		exportedNames: Set<string>,
		defaultExportNames: Set<string>
	): ParsedSymbol {
		// Resolve the name
		let name = "unknown";
		if (node.type === "variable_declarator") {
			name = node.firstNamedChild?.text ?? "unknown";
		} else if (kind === SymbolKind.Property || kind === SymbolKind.Method) {
			const nameNode = node.firstNamedChild ?? node.descendantsOfType("property_identifier")[0];
			name = nameNode?.text ?? "unknown";
		} else {
			name = node.namedChildren[0]?.text ?? "unknown";
		}

		const exported = exportedNames.has(name);
		const defaultExport = defaultExportNames.has(name);

		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: buildSignature(node),
			docComment: extractDocComment(node),
			exported,
			defaultExport,
			parentName
		};
	}
}
