/**
 * Reference-target helpers for the TypeScriptVisitor (TASK-267 split).
 *
 * Resolve the referenced name of a call/instantiation expression and emit the
 * 'import' references of an import_statement. Purely structural lookups over
 * the AST — no symbol resolution or alias following; the reference walker in
 * the visitor handles traversal and caller-name tracking.
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference } from "./language-visitor";
import {
	CALL_EXPRESSION,
	IMPORT_CLAUSE,
	IMPORT_SPECIFIER,
	MEMBER_EXPRESSION,
	NAMED_IMPORTS,
	NAMESPACE_IMPORT
} from "./ts-node-types";

/** Resolve the referenced name of a call/instantiation expression. */
export function calledExpressionName(node: TSNode): string | null {
	const fn = node.firstNamedChild;
	if (!fn) return null;
	if (fn.type === MEMBER_EXPRESSION) {
		return memberPropertyName(fn);
	}
	if (fn.type === CALL_EXPRESSION) {
		// `foo().bar()` — the outer call's target is `foo().bar`, so the
		// member property is the meaningful callee.
		const member = fn.firstNamedChild;
		if (member?.type === MEMBER_EXPRESSION) {
			return memberPropertyName(member);
		}
	}
	return fn.text;
}

/** Name of the property accessed by a member expression (e.g. `helper` from `ns.helper`). */
export function memberPropertyName(member: TSNode): string | null {
	return member.childForFieldName("property")?.text ?? member.lastNamedChild?.text ?? null;
}

export function constructorName(ctor: TSNode | null | undefined): string | null {
	if (!ctor) return null;
	if (ctor.type === MEMBER_EXPRESSION) {
		return memberPropertyName(ctor) ?? ctor.text;
	}
	return ctor.text;
}

/** Emit one 'import' reference per imported binding in an import_statement. */
export function emitImports(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
	const clause = node.childForFieldName("import_clause") ?? node.namedChildren.find((c) => c.type === IMPORT_CLAUSE);
	if (!clause) return; // `import "x";` side-effect import — no binding to reference

	const line = node.startPosition.row + 1;

	// Default-import binding: `import Foo from "x"` → clause's first named child is an identifier.
	const defaultImport = clause.namedChildren.find((c) => c.type === "identifier");
	if (defaultImport && defaultImport.text.length > 0) {
		refs.push({
			symbolName: defaultImport.text,
			callerFile: "",
			callerLine: line,
			callerName: callerName,
			kind: "import"
		});
	}

	// Named imports: `import { a, b } from "x"`.
	const named = clause.namedChildren.find((c) => c.type === NAMED_IMPORTS);
	if (named) {
		for (const spec of named.namedChildren) {
			if (spec.type !== IMPORT_SPECIFIER) continue;
			const nameNode = spec.childForFieldName("name");
			const imported = nameNode?.text;
			if (!imported || imported === "default") continue; // skip rebindings aliased to `default`
			refs.push({ symbolName: imported, callerFile: "", callerLine: line, callerName: callerName, kind: "import" });
		}
	}

	// Namespace import `import * as ns` — the imported (namespace) binding is
	// ambiguous; index the specifier so `ns` appears as the referenced symbol.
	const nsImport = clause.namedChildren.find((c) => c.type === NAMESPACE_IMPORT);
	if (nsImport) {
		const alias = (nsImport.lastNamedChild?.text ?? "").replace(/^as\s*/, "");
		if (alias) {
			refs.push({ symbolName: alias, callerFile: "", callerLine: line, callerName: callerName, kind: "import" });
		}
	}
}
