/**
 * DartVisitor — extracts symbols from Dart source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - class_definition             → Class
 * - enum_declaration             → Enum
 * - function_declaration / function_signature → Function (top-level)
 * - method_signature                           → Method
 * - constructor_signature        → Method (special)
 * - extension_declaration        → Class
 * - type_alias                   → Type
 * - initialized_variable_definition → Variable
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor.js";
import { SymbolKind } from "../language-visitor.js";

const CLASS_DEFINITION = "class_definition";
const ENUM_DECLARATION = "enum_declaration";
const FUNCTION_SIGNATURE = "function_signature";
const FUNCTION_DECLARATION = "function_declaration";
const METHOD_SIGNATURE = "method_signature";
const CONSTRUCTOR_SIGNATURE = "constructor_signature";
const EXTENSION_DECLARATION = "extension_declaration";
const TYPE_ALIAS = "type_alias";
const INITIALIZED_VARIABLE_DEFINITION = "initialized_variable_definition";
const CLASS_BODY = "class_body";
const ENUM_BODY = "enum_body";
const COMMENT = "comment";

export class DartVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class/enum body: extract methods ─────────────
		if (insideClass) {
			if (type === METHOD_SIGNATURE || type === CONSTRUCTOR_SIGNATURE) {
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

		// ── Class definition ────────────────────────────────────
		if (type === CLASS_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Enum declaration ────────────────────────────────────
		if (type === ENUM_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
				const body = node.namedChildren.find((c) => c.type === ENUM_BODY || c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Top-level function ──────────────────────────────────
		if (type === FUNCTION_DECLARATION || type === FUNCTION_SIGNATURE) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Extension declaration ───────────────────────────────
		if (type === EXTENSION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
			}
			return;
		}

		// ── Type alias ──────────────────────────────────────────
		if (type === TYPE_ALIAS) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Initialized variable definition (top-level) ─────────
		if (type === INITIALIZED_VARIABLE_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
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
				.replace(/^\/\/\/\s?/, "")
				.replace(/^\/\/\s?/, "")
				.trim();
		}
		return null;
	}
}
