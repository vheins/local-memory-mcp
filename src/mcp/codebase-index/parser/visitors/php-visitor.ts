/**
 * PhpVisitor — extracts symbols from PHP source code using tree-sitter's AST.
 *
 * Node type mappings (tree-sitter-php_only grammar):
 * - function_definition  → Function
 * - class_declaration    → Class
 * - interface_declaration → Interface
 * - enum_declaration     → Enum
 * - method_declaration   → Method (inside class)
 * - trait_declaration    → Class
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor.js";
import { SymbolKind } from "../language-visitor.js";

const FUNCTION_DEFINITION = "function_definition";
const METHOD_DECLARATION = "method_declaration";
const CLASS_DECLARATION = "class_declaration";
const INTERFACE_DECLARATION = "interface_declaration";
const ENUM_DECLARATION = "enum_declaration";
const TRAIT_DECLARATION = "trait_declaration";
const COMMENT = "comment";
const DECLARATION_LIST = "declaration_list";

export class PhpVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class body: extract methods ──────────────────
		if (insideClass) {
			if (type === METHOD_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
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

		// ── Function definition ─────────────────────────────────
		if (type === FUNCTION_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Class declaration ───────────────────────────────────
		if (type === CLASS_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				// Recurse for methods
				const body = node.namedChildren.find((c) => c.type === DECLARATION_LIST);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Interface declaration ───────────────────────────────
		if (type === INTERFACE_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Interface, parentName));
			}
			return;
		}

		// ── Enum declaration ────────────────────────────────────
		if (type === ENUM_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
			}
			return;
		}

		// ── Trait declaration ───────────────────────────────────
		if (type === TRAIT_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
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
				.replace(/^\/\/\s?/, "")
				.replace(/^\/\*\*?\s?/, "")
				.replace(/\s?\*\/$/, "")
				.trim();
		}
		return null;
	}
}
