/**
 * PythonVisitor — extracts symbols from Python source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_definition → Function
 * - class_definition    → Class
 *
 * Python doesn't have exports per se — module-level definitions are placed at top-level.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor.js";
import { SymbolKind } from "../language-visitor.js";

const FUNCTION_DEFINITION = "function_definition";
const CLASS_DEFINITION = "class_definition";
const COMMENT = "comment";
const STRING = "string";
const EXPRESSION_STATEMENT = "expression_statement";

export class PythonVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		// ── Inside class body: extract methods ──────────────────
		if (insideClass) {
			if (node.type === FUNCTION_DEFINITION) {
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

		// ── Function definition ─────────────────────────────────
		if (node.type === FUNCTION_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Class definition ────────────────────────────────────
		if (node.type === CLASS_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				// Recurse into class body for methods
				const body = node.namedChildren.find((c) => c.type === "block");
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

	private makeSymbol(node: TSNode, name: string, kind: SymbolKind, parentName: string | null): ParsedSymbol {
		// Python module-level definitions are always accessible
		const exported = parentName === null;

		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: this.buildSignature(node),
			docComment: this.extractDocComment(node),
			exported,
			defaultExport: false,
			parentName
		};
	}

	private buildSignature(node: TSNode): string {
		const firstLine = node.text.split("\n")[0] ?? "";
		return firstLine.replace(/\s+/g, " ").trim();
	}

	private extractDocComment(node: TSNode): string | null {
		// Python docstrings are the first statement inside the function/class body block
		const block = node.namedChildren.find((c) => c.type === "block");
		if (!block) return null;
		const first = block.namedChildren[0];
		if (first?.type === EXPRESSION_STATEMENT) {
			const str = first.namedChildren[0];
			if (str?.type === STRING) {
				return (
					str.text
						.replace(/^['"]{3}/, "")
						.replace(/['"]{3}$/, "")
						.trim() || null
				);
			}
		}
		return null;
	}
}
