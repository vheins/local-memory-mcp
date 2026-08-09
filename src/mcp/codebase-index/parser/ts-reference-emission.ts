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
	CLASS_HERITAGE,
	CONSTRAINT,
	EXTENDS_CLAUSE,
	EXTENDS_TYPE_CLAUSE,
	GENERIC_TYPE,
	IMPLEMENTS_CLAUSE,
	INTERFACE_DECLARATION,
	IMPORT_CLAUSE,
	IMPORT_SPECIFIER,
	MEMBER_EXPRESSION,
	NAMED_IMPORTS,
	NAMESPACE_IMPORT,
	NESTED_TYPE_IDENTIFIER,
	TYPE_IDENTIFIER,
	TYPE_PARAMETER,
	TYPE_PARAMETERS
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

/**
 * Resolve the name-based target of a single heritage element.
 *
 * Per ADR-002 (name-based resolution, no LSP / type resolution), the edge
 * references the LAST name segment of the heritage target as written:
 *
 *   - `identifier` / `type_identifier`        → `Foo`        (extends Foo / implements I)
 *   - `member_expression`                     → `Base`       (extends ns.Base)
 *   - `nested_type_identifier`                → `Iface`      (implements UI.Iface)
 *   - `generic_type`                          → `Foo`        (extends Foo<T> / implements I<U>)
 *
 * Returns null for non-name elements (parenthesized expressions, predefined
 * types, etc.) so no edge is emitted for unresolvable heritage sites.
 */
export function heritageTargetName(node: TSNode): string | null {
	if (node.type === MEMBER_EXPRESSION) return memberPropertyName(node);
	if (node.type === NESTED_TYPE_IDENTIFIER) return node.lastNamedChild?.text ?? null;
	if (node.type === GENERIC_TYPE) {
		// `Foo<T>` — the generic type identifier is the first named child.
		const base = node.namedChildren[0];
		return base ? base.text : null;
	}
	if (node.type === TYPE_IDENTIFIER || node.type === "identifier") return node.text;
	return null;
}

/**
 * Emit one heritage edge per target inside a heritage clause.
 *
 * @param clause   `extends_clause` / `implements_clause` / `extends_type_clause`
 * @param kind     'extends' or 'implements'
 * @param line     1-based declaration line of the derived type (caller site)
 * @param refs     reference accumulator
 */
function emitHeritageTargets(
	clause: TSNode,
	kind: "extends" | "implements",
	line: number,
	refs: ParsedReference[]
): void {
	for (const target of clause.namedChildren) {
		const name = heritageTargetName(target);
		if (!name) continue;
		refs.push({
			symbolName: name,
			callerFile: "",
			callerLine: line,
			callerName: null,
			kind
		});
	}
}

/**
 * Emit 'extends' / 'implements' heritage edges for a class, abstract class or
 * interface declaration (TASK-301, Phase 1.1).
 *
 * Grammar (tree-sitter-typescript, verified empirically against the shipped
 * WASM): class heritage lives in a `class_heritage` node containing
 * `extends_clause` + `implements_clause` children; interface heritage is a
 * direct `extends_type_clause` child of `interface_declaration`. Type-parameter
 * constraints (`class Foo<T extends Bar>`) emit an 'extends' edge to the
 * constraint's type reference (generics basics).
 *
 * `callerName` is null per the ParsedReference heritage contract — the edge
 * belongs to the derived type's declaration, not an enclosing function.
 * `targetFile`/`targetSymbolId` are left null: name-based resolution per
 * ADR-002 happens at query time, not parse time.
 */
export function emitHeritage(node: TSNode, refs: ParsedReference[]): void {
	const line = node.startPosition.row + 1;

	// Class heritage: `class Foo extends Bar implements I1, I2`.
	const classHeritage = node.namedChildren.find((c) => c.type === CLASS_HERITAGE);
	if (classHeritage) {
		for (const clause of classHeritage.namedChildren) {
			if (clause.type === EXTENDS_CLAUSE) emitHeritageTargets(clause, "extends", line, refs);
			else if (clause.type === IMPLEMENTS_CLAUSE) emitHeritageTargets(clause, "implements", line, refs);
		}
	}

	// Interface heritage: `interface A extends B, C` (no class_heritage wrapper).
	if (node.type === INTERFACE_DECLARATION) {
		const extClause = node.namedChildren.find((c) => c.type === EXTENDS_TYPE_CLAUSE);
		if (extClause) emitHeritageTargets(extClause, "extends", line, refs);
	}

	// Generics basics: `class Foo<T extends Bar>` → 'extends' edge to Bar.
	// Only the declaration's OWN type_parameters (direct child) — method-level
	// generics (private m<T extends U>()) are out of heritage scope.
	const ownTypeParams = node.namedChildren.find((c) => c.type === TYPE_PARAMETERS);
	if (ownTypeParams) {
		for (const param of ownTypeParams.namedChildren) {
			if (param.type !== TYPE_PARAMETER) continue;
			const constraint = param.namedChildren.find((c) => c.type === CONSTRAINT);
			if (!constraint) continue;
			for (const target of constraint.namedChildren) {
				const name = heritageTargetName(target);
				if (!name) continue;
				refs.push({
					symbolName: name,
					callerFile: "",
					callerLine: line,
					callerName: null,
					kind: "extends"
				});
			}
		}
	}
}
