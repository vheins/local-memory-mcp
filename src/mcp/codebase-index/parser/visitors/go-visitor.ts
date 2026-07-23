/**
 * GoVisitor — extracts symbols from Go source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_declaration → Function
 * - method_declaration   → Method (inside struct)
 * - type_spec (struct_type) → Class
 * - type_spec (interface_type) → Interface
 * - type_spec (other)    → Type
 *
 * Export convention: names starting with uppercase are exported.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor.js";
import { SymbolKind } from "../language-visitor.js";

const FUNCTION_DECLARATION = "function_declaration";
const METHOD_DECLARATION = "method_declaration";
const TYPE_DECLARATION = "type_declaration";
const TYPE_SPEC = "type_spec";
const STRUCT_TYPE = "struct_type";
const INTERFACE_TYPE = "interface_type";
const FIELD_DECLARATION = "field_declaration";
const COMMENT = "comment";

export class GoVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideStruct: boolean): void {
		// ── Inside struct body: extract fields ──────────────────
		if (insideStruct) {
			if (node.type === FIELD_DECLARATION) {
				const nameNode = node.namedChildren[0];
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Property, parentName));
				}
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true);
			}
			return;
		}

		const type = node.type;

		// ── Function declaration ────────────────────────────────
		if (type === FUNCTION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
				// Functions can have local type declarations inside
				for (const child of node.namedChildren) {
					this.walkNode(child, symbols, null, false);
				}
			}
			return;
		}

		// ── Method declaration ──────────────────────────────────
		if (type === METHOD_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "field_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
			}
			return;
		}

		// ── Type declaration (struct, interface, type alias) ────
		if (type === TYPE_DECLARATION) {
			const spec = node.namedChildren.find((c) => c.type === TYPE_SPEC);
			if (!spec) return;

			const nameNode = spec.namedChildren.find((c) => c.type === "type_identifier");
			if (!nameNode) return;

			const typeNode = spec.namedChildren.find((c) => c.type === STRUCT_TYPE || c.type === INTERFACE_TYPE);

			if (typeNode?.type === STRUCT_TYPE) {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Class, parentName));
				this.walkNode(typeNode, symbols, nameNode.text, true);
			} else if (typeNode?.type === INTERFACE_TYPE) {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Interface, parentName));
			} else {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Type, parentName));
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
		const exported = name.length > 0 && name[0] !== name[0]!.toLowerCase();

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
		const lines: string[] = [];
		let sibling: TSNode | null = node.previousNamedSibling;
		while (sibling?.type === COMMENT && sibling.text.startsWith("//")) {
			lines.unshift(sibling.text.replace(/^\/\/\s?/, "").trimEnd());
			sibling = sibling.previousNamedSibling;
		}
		return lines.length > 0 ? lines.join("\n") : null;
	}
}
