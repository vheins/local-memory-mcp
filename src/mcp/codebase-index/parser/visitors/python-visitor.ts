/**
 * PythonVisitor — extracts symbols from Python source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_definition       → Function (async defs detected via the `async` keyword)
 * - async_function_definition → Function (legacy grammars with a dedicated node)
 * - class_definition          → Class
 * - decorated_definition      → Function/Class (decorator texts prefixed to the signature)
 * - expression_statement      → Constant for `__all__ = [...]` export assignments
 *
 * Python doesn't have exports per se — module-level definitions are placed at top-level,
 * and `__all__` is the explicit module export list.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";

const FUNCTION_DEFINITION = "function_definition";
const ASYNC_FUNCTION_DEFINITION = "async_function_definition";
const CLASS_DEFINITION = "class_definition";
const DECORATED_DEFINITION = "decorated_definition";
const DECORATOR = "decorator";
const STRING = "string";
const EXPRESSION_STATEMENT = "expression_statement";
const ASSIGNMENT = "assignment";
const IDENTIFIER = "identifier";
const BLOCK = "block";
const ALL_EXPORTS_NAME = "__all__";

/** Optional context threaded through the walk (decorators, async marker). */
interface WalkContext {
	/** Decorator texts (e.g. `@app.route("/x")`) applied to the indexed definition. */
	decorators?: string[];
	/** True when the definition is async (legacy `async_function_definition` grammars). */
	async?: boolean;
}

export class PythonVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	private walkNode(
		node: TSNode,
		symbols: ParsedSymbol[],
		parentName: string | null,
		insideClass: boolean,
		ctx: WalkContext = {}
	): void {
		// ── Decorated definitions: index the inner def/class, prefix decorators ──
		if (node.type === DECORATED_DEFINITION) {
			const decorators = node.namedChildren
				.filter((c) => c.type === DECORATOR)
				.map((c) => c.text.replace(/\s+/g, " ").trim());
			const definition = node.namedChildren.find((c) => c.type === FUNCTION_DEFINITION || c.type === CLASS_DEFINITION);
			if (definition) {
				this.walkNode(definition, symbols, parentName, insideClass, { ...ctx, decorators });
				return;
			}
			// Parse-error fallback: recurse generically rather than dropping the node
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, insideClass, ctx);
			}
			return;
		}

		// ── Legacy async_function_definition: index the nested function, mark async ──
		if (node.type === ASYNC_FUNCTION_DEFINITION) {
			const definition = node.namedChildren.find((c) => c.type === FUNCTION_DEFINITION);
			if (definition) {
				this.walkNode(definition, symbols, parentName, insideClass, { ...ctx, async: true });
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, insideClass, { ...ctx, async: true });
			}
			return;
		}

		// ── Inside class body: extract methods ──────────────────
		if (insideClass) {
			if (node.type === FUNCTION_DEFINITION) {
				const nameNode = node.namedChildren.find((c) => c.type === IDENTIFIER);
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName, ctx));
				}
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true, ctx);
			}
			return;
		}

		// ── Function definition ─────────────────────────────────
		if (node.type === FUNCTION_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === IDENTIFIER);
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName, ctx));
			}
			return;
		}

		// ── Class definition ────────────────────────────────────
		if (node.type === CLASS_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === IDENTIFIER);
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName, ctx));
				// Recurse into class body for methods. Decorators/async apply to the
				// class definition itself, NOT to its methods — so the context is not
				// propagated (a decorated method is handled via decorated_definition).
				const body = node.namedChildren.find((c) => c.type === BLOCK);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Module-level `__all__ = [...]` export assignment ────
		if (node.type === EXPRESSION_STATEMENT) {
			const assignment = node.namedChildren.find((c) => c.type === ASSIGNMENT);
			if (assignment) {
				const left = assignment.namedChildren.find((c) => c.type === IDENTIFIER);
				if (left?.text === ALL_EXPORTS_NAME) {
					symbols.push(this.makeSymbol(assignment, ALL_EXPORTS_NAME, SymbolKind.Constant, null));
					return; // do not recurse — avoid duplicate emission
				}
			}
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false, ctx);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	private makeSymbol(
		node: TSNode,
		name: string,
		kind: SymbolKind,
		parentName: string | null,
		ctx: WalkContext = {}
	): ParsedSymbol {
		// Python module-level definitions are always accessible
		const exported = parentName === null;

		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: this.buildSignature(node, ctx),
			docComment: this.extractDocComment(node),
			exported,
			defaultExport: false,
			parentName
		};
	}

	private buildSignature(node: TSNode, ctx: WalkContext = {}): string {
		const firstLine = node.text.split("\n")[0] ?? "";
		const normalized = firstLine.replace(/\s+/g, " ").trim();
		const parts: string[] = [];
		const decorators = ctx.decorators ?? [];
		if (decorators.length) {
			parts.push(...decorators);
		}
		if (ctx.async && !/^async\b/.test(normalized)) {
			parts.push(`async ${normalized}`);
		} else {
			parts.push(normalized);
		}
		return parts.join(" ");
	}

	private extractDocComment(node: TSNode): string | null {
		// Python docstrings are the first statement inside the function/class body block
		const block = node.namedChildren.find((c) => c.type === BLOCK);
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
