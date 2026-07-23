/**
 * CVisitor — extracts symbols from C source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_definition → Function
 * - struct_specifier    → Class (type = Struct)
 * - enum_specifier      → Enum
 * - type_definition     → Type
 *
 * C has no visibility modifiers — all top-level symbols are accessible (exported = true).
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor.js";
import { SymbolKind } from "../language-visitor.js";

const FUNCTION_DEFINITION = "function_definition";
const STRUCT_SPECIFIER = "struct_specifier";
const ENUM_SPECIFIER = "enum_specifier";
const TYPE_DEFINITION = "type_definition";
const FIELD_DECLARATION = "field_declaration";
const COMMENT = "comment";

export class CVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideStruct: boolean): void {
		const type = node.type;

		// ── Inside struct: extract field declarations ───────────
		if (insideStruct) {
			if (type === FIELD_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "field_identifier" || c.type === "identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Property, parentName));
				}
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true);
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

		// ── Struct specifier ────────────────────────────────────
		if (type === STRUCT_SPECIFIER) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				// Recurse for fields
				const body = node.namedChildren.find((c) => c.type === "field_declaration_list");
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
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
