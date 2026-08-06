/**
 * RubyVisitor — extracts symbols from Ruby source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - method           → Method
 * - singleton_method → Method
 * - class            → Class
 * - singleton_class  → Class
 * - module           → Class (treat module as class)
 * - attr_accessor/attr_reader/attr_writer → Method (one per symbol argument)
 * - extend/include (module mixing)        → Module
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";

const METHOD = "method";
const SINGLETON_METHOD = "singleton_method";
const CLASS = "class";
const SINGLETON_CLASS = "singleton_class";
const MODULE = "module";
const CALL = "call";
const BODY_STATEMENT = "body_statement";
const COMMENT = "comment";
const SIMPLE_SYMBOL = "simple_symbol";
const CONSTANT = "constant";

/** attr_accessor / attr_reader / attr_writer — synthetic reader/writer methods. */
const ATTR_METHOD_RE = /^attr_(accessor|reader|writer)$/;
/** Module-mixing calls whose constant argument is a module reference. */
const MIXIN_METHOD = new Set(["extend", "include"]);

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
			if (type === CALL) {
				this.extractCallSymbols(node, symbols, parentName);
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

	/**
	 * Extract synthetic symbols from class-body `call` nodes:
	 * - attr_accessor/attr_reader/attr_writer :foo, :bar → one Method per symbol arg
	 * - extend/include SomeModule                       → one Module per constant arg
	 */
	private extractCallSymbols(node: TSNode, symbols: ParsedSymbol[], parentName: string | null): void {
		const methodNode = node.childForFieldName("method");
		if (!methodNode || methodNode.type !== "identifier") return;
		const methodName = methodNode.text;

		const isAttrMethod = ATTR_METHOD_RE.test(methodName);
		const isMixinMethod = MIXIN_METHOD.has(methodName);
		if (!isAttrMethod && !isMixinMethod) return;

		const argsNode = node.childForFieldName("arguments");
		if (!argsNode) return;

		const argType = isAttrMethod ? SIMPLE_SYMBOL : CONSTANT;
		const kind = isAttrMethod ? SymbolKind.Method : SymbolKind.Module;
		for (const arg of argsNode.namedChildren) {
			if (arg.type !== argType) continue;
			// `attr_accessor :name` → Method named "name" (strip the leading `:`);
			// `extend SomeModule` → Module named "SomeModule".
			const name = isAttrMethod ? arg.text.replace(/^:/, "") : arg.text;
			if (!name) continue;
			symbols.push(this.makeSymbol(node, name, kind, parentName, `${methodName} ${arg.text}`));
		}
	}

	private makeSymbol(
		node: TSNode,
		name: string,
		kind: SymbolKind,
		parentName: string | null,
		signatureOverride?: string
	): ParsedSymbol {
		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: signatureOverride ?? this.buildSignature(node),
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
