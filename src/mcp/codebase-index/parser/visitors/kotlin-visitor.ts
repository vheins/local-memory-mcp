/**
 * KotlinVisitor — extracts symbols from Kotlin source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_declaration → Function
 * - class_declaration    → Class
 * - interface            → Interface
 * - type_alias           → Type
 * - variable_declaration → Variable
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor.js";
import { SymbolKind } from "../language-visitor.js";

const FUNCTION_DECLARATION = "function_declaration";
const CLASS_DECLARATION = "class_declaration";
const INTERFACE_DECLARATION = "interface_declaration";
const TYPE_ALIAS = "type_alias";
const VARIABLE_DECLARATION = "variable_declaration";
const CLASS_BODY = "class_body";
const MODIFIERS = "modifiers";
const LINE_COMMENT = "line_comment";
const BLOCK_COMMENT = "block_comment";

export class KotlinVisitor implements LanguageVisitor {
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
			if (type === FUNCTION_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
				}
				return;
			}
			if (type === CLASS_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier" || c.type === "type_identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
					const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
					if (body) {
						this.walkNode(body, symbols, nameNode.text, true);
					}
				}
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true);
			}
			return;
		}

		// ── Function declaration ────────────────────────────────
		if (type === FUNCTION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Class/Interface declaration (tree-sitter-kotlin uses class_declaration for both) ──
		if (type === CLASS_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier" || c.type === "type_identifier");
			if (nameNode) {
				const isInterface = node.text.startsWith("interface");
				const kind = isInterface ? SymbolKind.Interface : SymbolKind.Class;
				symbols.push(this.makeSymbol(node, nameNode.text, kind, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Type alias ──────────────────────────────────────────
		if (type === TYPE_ALIAS) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Variable declaration ────────────────────────────────
		if (type === VARIABLE_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Variable, parentName));
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	private isPublic(node: TSNode): boolean {
		for (const child of node.children) {
			if (child.type === MODIFIERS && child.text.includes("public")) {
				return true;
			}
		}
		return false;
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
			exported: this.isPublic(node),
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
		if (prev && (prev.type === BLOCK_COMMENT || prev.type === LINE_COMMENT)) {
			const text = prev.text;
			if (text.startsWith("/**")) {
				return text
					.replace(/^\/\*\*?\s?/, "")
					.replace(/\s?\*\/$/, "")
					.trim();
			}
		}
		return null;
	}
}
