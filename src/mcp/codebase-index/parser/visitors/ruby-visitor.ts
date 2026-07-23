/**
 * RubyVisitor — extracts symbols from Ruby source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - method           → Method
 * - singleton_method → Method
 * - class            → Class
 * - singleton_class  → Class
 * - module           → Class (treat module as class)
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor.js";
import { SymbolKind } from "../language-visitor.js";

const METHOD = "method";
const SINGLETON_METHOD = "singleton_method";
const CLASS = "class";
const SINGLETON_CLASS = "singleton_class";
const MODULE = "module";
const BODY_STATEMENT = "body_statement";
const COMMENT = "comment";

export class RubyVisitor implements LanguageVisitor {
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
			if (type === METHOD || type === SINGLETON_METHOD) {
				const nameNode = node.namedChildren.find((c) => c.type === "identifier" || c.type === "method_name");
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

		// ── Method (top-level) ──────────────────────────────────
		if (type === METHOD || type === SINGLETON_METHOD) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier" || c.type === "method_name");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
			}
			return;
		}

		// ── Class declaration ───────────────────────────────────
		if (type === CLASS || type === SINGLETON_CLASS) {
			const nameNode = node.namedChildren.find((c) => c.type === "constant");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === BODY_STATEMENT);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Module declaration ──────────────────────────────────
		if (type === MODULE) {
			const nameNode = node.namedChildren.find((c) => c.type === "constant");
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
			return prev.text.replace(/^#\s?/, "").trim();
		}
		return null;
	}
}
