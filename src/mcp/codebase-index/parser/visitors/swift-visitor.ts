/**
 * SwiftVisitor — extracts symbols from Swift source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_declaration → Function
 * - class_declaration    → Class
 * - struct               → Class (type = Struct)
 * - enum                 → Enum
 * - protocol_declaration → Interface
 * - extension            → Class (type = Extension)
 * - actor                → Class (type = Actor)
 *
 * Export detection: `public` or `open` modifier.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor.js";
import { SymbolKind } from "../language-visitor.js";

const FUNCTION_DECLARATION = "function_declaration";
const CLASS_DECLARATION = "class_declaration";
const STRUCT_DECLARATION = "struct_declaration";
const ENUM_DECLARATION = "enum_declaration";
const PROTOCOL_DECLARATION = "protocol_declaration";
const EXTENSION_DECLARATION = "extension_declaration";
const ACTOR_DECLARATION = "actor_declaration";
const CLASS_BODY = "class_body";
const MODIFIERS = "modifiers";
const COMMENT = "comment";
const MULTILINE_COMMENT = "multiline_comment";
const TYPE_IDENTIFIER = "type_identifier";

export class SwiftVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class/struct/enum body: extract methods ──────
		if (insideClass) {
			if (type === FUNCTION_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
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

		// ── Function declaration ────────────────────────────────
		if (type === FUNCTION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Class declaration ───────────────────────────────────
		if (type === CLASS_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Struct ──────────────────────────────────────────────
		if (type === STRUCT_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Enum ────────────────────────────────────────────────
		if (type === ENUM_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Protocol declaration ────────────────────────────────
		if (type === PROTOCOL_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Interface, parentName));
			}
			return;
		}

		// ── Extension ───────────────────────────────────────────
		if (type === EXTENSION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Actor ───────────────────────────────────────────────
		if (type === ACTOR_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
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
			if (child.type === MODIFIERS) {
				const text = child.text.trim();
				if (text === "public" || text === "open") {
					return true;
				}
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
		if (prev && (prev.type === COMMENT || prev.type === MULTILINE_COMMENT)) {
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
}
