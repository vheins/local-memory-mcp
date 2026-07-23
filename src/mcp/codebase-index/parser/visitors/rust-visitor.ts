/**
 * RustVisitor — extracts symbols from Rust source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_item → Function
 * - struct_item   → Class
 * - enum_item     → Enum
 * - trait_item    → Interface
 * - type_item     → Type
 *
 * Export detection: checks for `visibility_modifier` child containing `pub`.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor.js";
import { SymbolKind } from "../language-visitor.js";

const FUNCTION_ITEM = "function_item";
const STRUCT_ITEM = "struct_item";
const ENUM_ITEM = "enum_item";
const TRAIT_ITEM = "trait_item";
const TYPE_ITEM = "type_item";
const IMPL_ITEM = "impl_item";
const COMMENT = "comment";
const LINE_COMMENT = "line_comment";
const BLOCK_COMMENT = "block_comment";
const VISIBILITY_MODIFIER = "visibility_modifier";

export class RustVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideImpl: boolean): void {
		const type = node.type;

		// ── Inside impl block: extract methods ─────────────────
		if (insideImpl) {
			if (type === FUNCTION_ITEM) {
				const nameNode = node.namedChildren.find((c) => c.type === "identifier");
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

		// ── Function item ───────────────────────────────────────
		if (type === FUNCTION_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Struct item ─────────────────────────────────────────
		if (type === STRUCT_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
			}
			return;
		}

		// ── Enum item ───────────────────────────────────────────
		if (type === ENUM_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
			}
			return;
		}

		// ── Trait item ──────────────────────────────────────────
		if (type === TRAIT_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Interface, parentName));
			}
			return;
		}

		// ── Type item ───────────────────────────────────────────
		if (type === TYPE_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Impl item: recurse for methods ──────────────────────
		if (type === IMPL_ITEM) {
			let implParent = parentName;
			const forIdx = node.children.findIndex((c) => c.type === "for");
			if (forIdx >= 0) {
				const afterFor = node.namedChildren.find(
					(c) => c.type === "type_identifier" && c.startIndex > node.children[forIdx]!.startIndex
				);
				implParent = afterFor?.text ?? parentName;
			} else {
				const typeId = node.namedChildren.find((c) => c.type === "type_identifier");
				implParent = typeId?.text ?? parentName;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, implParent, true);
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
			if (child.type === VISIBILITY_MODIFIER && child.text === "pub") {
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
		if (prev && (prev.type === COMMENT || prev.type === LINE_COMMENT || prev.type === BLOCK_COMMENT)) {
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
