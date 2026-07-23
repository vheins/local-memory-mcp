/**
 * CppVisitor — extracts symbols from C++ source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_definition → Function
 * - class_specifier     → Class
 * - struct_specifier    → Class (type = Struct)
 * - enum_specifier      → Enum
 * - type_definition     → Type
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor.js";
import { SymbolKind } from "../language-visitor.js";

const FUNCTION_DEFINITION = "function_definition";
const CLASS_SPECIFIER = "class_specifier";
const STRUCT_SPECIFIER = "struct_specifier";
const ENUM_SPECIFIER = "enum_specifier";
const TYPE_DEFINITION = "type_definition";
const FIELD_DECLARATION = "field_declaration";
const FIELD_DECLARATION_LIST = "field_declaration_list";
const COMMENT = "comment";
const DESTRUCTOR_NAME = "destructor_name";

export class CppVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false, false);
		return symbols;
	}

	private walkNode(
		node: TSNode,
		symbols: ParsedSymbol[],
		parentName: string | null,
		insideClass: boolean,
		insideStruct: boolean
	): void {
		const type = node.type;

		// ── Inside class/struct body: extract members ───────────
		if (insideClass || insideStruct) {
			// Method: function_definition inside class body
			if (type === FUNCTION_DEFINITION) {
				const declarator = node.namedChildren.find((c) => c.type === "function_declarator");
				if (declarator) {
					const nameNode = declarator.namedChildren.find(
						(c) => c.type === "identifier" || c.type === "field_identifier"
					);
					if (nameNode) {
						symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
					}
				}
				return;
			}
			// Field declaration
			if (type === FIELD_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "field_identifier" || c.type === "identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Property, parentName));
				}
				return;
			}
			// Nested class/struct
			if (type === CLASS_SPECIFIER || type === STRUCT_SPECIFIER) {
				const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
				if (nameNode) {
					const kind = type === CLASS_SPECIFIER ? SymbolKind.Class : SymbolKind.Class;
					symbols.push(this.makeSymbol(node, nameNode.text, kind, parentName));
					const body = node.namedChildren.find((c) => c.type === FIELD_DECLARATION_LIST);
					if (body) {
						this.walkNode(body, symbols, nameNode.text, true, type === STRUCT_SPECIFIER);
					}
				}
				return;
			}
			// Destructor
			if (type === DESTRUCTOR_NAME) {
				// Handled via function_declaration parent
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, insideClass, insideStruct);
			}
			return;
		}

		// ── Function definition ─────────────────────────────────
		if (type === FUNCTION_DEFINITION) {
			const declarator = node.namedChildren.find((c) => c.type === "function_declarator");
			if (declarator) {
				const nameNode = declarator.namedChildren.find((c) => c.type === "identifier" || c.type === "field_identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
				}
			}
			return;
		}

		// ── Class specifier ─────────────────────────────────────
		if (type === CLASS_SPECIFIER) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === FIELD_DECLARATION_LIST);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true, false);
				}
			}
			return;
		}

		// ── Struct specifier ────────────────────────────────────
		if (type === STRUCT_SPECIFIER) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === FIELD_DECLARATION_LIST);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, false, true);
				}
			}
			return;
		}

		// ── Enum specifier ──────────────────────────────────────
		if (type === ENUM_SPECIFIER) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
			}
			return;
		}

		// ── Type definition ─────────────────────────────────────
		if (type === TYPE_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	// C++ symbols always have exported: true because tree-sitter parses
	// header and source files without distinguishing visibility at the
	// symbol level. Access specifiers (public/private/protected) are
	// context-dependent and a single method call is insufficient.
	// Consumer code should filter by parent access specifier if needed.

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
			exported: true,
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
			if (prev.text.startsWith("/**")) {
				return prev.text
					.replace(/^\/\*\*?\s?/, "")
					.replace(/\s?\*\/$/, "")
					.trim();
			}
		}
		return null;
	}
}
