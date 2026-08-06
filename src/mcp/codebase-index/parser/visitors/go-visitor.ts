/**
 * GoVisitor — extracts symbols from Go source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_declaration → Function
 * - method_declaration   → Method (signature includes the receiver)
 * - type_spec (struct_type) → Class (field_declaration → Variable, parented to the struct)
 * - type_spec (interface_type) → Interface (method_elem → Method with full signature)
 * - type_spec (other)    → Type
 * - const_declaration (const_spec) → Constant (incl. iota blocks)
 *
 * Export convention: names starting with uppercase are exported.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";

const FUNCTION_DECLARATION = "function_declaration";
const METHOD_DECLARATION = "method_declaration";
const TYPE_DECLARATION = "type_declaration";
const TYPE_SPEC = "type_spec";
const STRUCT_TYPE = "struct_type";
const INTERFACE_TYPE = "interface_type";
const FIELD_DECLARATION = "field_declaration";
const METHOD_ELEM = "method_elem";
const CONST_DECLARATION = "const_declaration";
const CONST_SPEC = "const_spec";
const COMMENT = "comment";

export class GoVisitor implements LanguageVisitor {
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
		insideStruct: boolean,
		insideInterface: boolean
	): void {
		// ── Inside struct body: extract fields ──────────────────
		if (insideStruct) {
			if (node.type === FIELD_DECLARATION) {
				// `x, y int` declares multiple names in one node — emit one
				// symbol per name (tree-sitter-go: commaSep1(field('name', ...))).
				const nameNodes = node.childrenForFieldName("name");
				const typeNode = node.childForFieldName("type");
				// Embedded structs (e.g. `*BaseRepo`) have no name field —
				// fall back to the embedded type as the symbol name.
				const names = nameNodes.length > 0 ? nameNodes.map((n) => n.text) : typeNode ? [typeNode.text] : [];
				for (const name of names) {
					symbols.push(this.makeSymbol(node, name, SymbolKind.Variable, parentName));
				}
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true, false);
			}
			return;
		}

		// ── Inside interface body: extract methods ──────────────
		if (insideInterface) {
			if (node.type === METHOD_ELEM) {
				const nameNode = node.childForFieldName("name");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
				}
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, false, true);
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
					this.walkNode(child, symbols, null, false, false);
				}
			}
			return;
		}

		// ── Method declaration ──────────────────────────────────
		if (type === METHOD_DECLARATION) {
			const nameNode = node.childForFieldName("name");
			if (nameNode) {
				symbols.push(
					this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName, this.buildMethodSignature(node))
				);
			}
			return;
		}

		// ── Type declaration (struct, interface, type alias) ────
		if (type === TYPE_DECLARATION) {
			const spec = node.namedChildren.find((c) => c.type === TYPE_SPEC);
			if (!spec) return;

			const nameNode = spec.childForFieldName("name");
			if (!nameNode) return;

			const typeNode = spec.childForFieldName("type");

			if (typeNode?.type === STRUCT_TYPE) {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Class, parentName));
				this.walkNode(typeNode, symbols, nameNode.text, true, false);
			} else if (typeNode?.type === INTERFACE_TYPE) {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Interface, parentName));
				this.walkNode(typeNode, symbols, nameNode.text, false, true);
			} else {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Const declaration (incl. iota blocks) ───────────────
		if (type === CONST_DECLARATION) {
			for (const child of node.namedChildren) {
				if (child.type === CONST_SPEC) {
					// `const A, B = 1, 2` declares multiple names in one spec —
					// emit one symbol per name.
					const nameNodes = child.childrenForFieldName("name");
					for (const nameNode of nameNodes) {
						symbols.push(this.makeSymbol(child, nameNode.text, SymbolKind.Constant, parentName));
					}
				}
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	private makeSymbol(
		node: TSNode,
		name: string,
		kind: SymbolKind,
		parentName: string | null,
		signature?: string
	): ParsedSymbol {
		const exported = name.length > 0 && name[0] !== name[0]!.toLowerCase();

		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: signature ?? this.buildSignature(node),
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

	/**
	 * Build a method signature that includes the receiver:
	 * `(r *Repo) Save(ctx context.Context) error`.
	 * Parameters attach directly to the method name (no space before `(`).
	 */
	private buildMethodSignature(node: TSNode): string {
		const receiver = node.childForFieldName("receiver");
		const name = node.childForFieldName("name");
		const parameters = node.childForFieldName("parameters");
		const result = node.childForFieldName("result");

		const head: string[] = [];
		if (receiver) head.push(receiver.text);
		if (name) {
			head.push(parameters ? `${name.text}${parameters.text}` : name.text);
		} else if (parameters) {
			head.push(parameters.text);
		}
		if (result) head.push(result.text);

		return head.join(" ").replace(/\s+/g, " ").trim();
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
