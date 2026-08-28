/**
 * Reference-target helpers for the TypeScriptVisitor (TASK-267 split).
 *
 * Resolve the referenced name of a call/instantiation expression and emit the
 * 'import' references of an import_statement. Purely structural lookups over
 * the AST — no symbol resolution or alias following; the reference walker in
 * the visitor handles traversal and caller-name tracking.
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference, ReferenceRole } from "./language-visitor";
import {
	ARRAY_TYPE,
	CALL_EXPRESSION,
	CLASS_HERITAGE,
	CONSTRAINT,
	EXTENDS_CLAUSE,
	EXTENDS_TYPE_CLAUSE,
	FORMAL_PARAMETERS,
	GENERIC_TYPE,
	IMPLEMENTS_CLAUSE,
	INTERFACE_DECLARATION,
	IMPORT_CLAUSE,
	IMPORT_SPECIFIER,
	INTERSECTION_TYPE,
	MEMBER_EXPRESSION,
	NAMED_IMPORTS,
	NAMESPACE_IMPORT,
	NESTED_TYPE_IDENTIFIER,
	OPTIONAL_PARAMETER,
	PAREN_TYPE,
	REQUIRED_PARAMETER,
	STRING,
	TYPE_ALIAS_DECLARATION,
	TYPE_ANNOTATION,
	TYPE_IDENTIFIER,
	TYPE_PARAMETER,
	TYPE_PARAMETERS,
	UNION_TYPE
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

/** Extract the `'./x'` module specifier of an import_statement (null if absent). */
function moduleSpecifierOf(node: TSNode): string | null {
	const source = node.childForFieldName("source");
	if (!source) return null;
	// tree-sitter-typescript models the specifier as a `string` node whose
	// text INCLUDES the quotes — strip them for the raw specifier.
	const raw = source.type === STRING ? source.text.slice(1, -1) : source.text;
	return raw.length > 0 ? raw : null;
}

/**
 * Emit one 'import' reference per imported binding in an import_statement,
 * carrying the import metadata (issue #83, migration v27).
 *
 * Per binding the row's contract:
 *   - symbol_name   = the IMPORTED name as written in the module (the
 *     canonical name for name-based aggregation — ADR-002; the `User` of
 *     `import { User as DomainUser }`). Namespace imports index the alias
 *     (`* as ns` → 'ns' — the imported namespace has no single name).
 *   - importInfo.localName     = the LOCAL binding in the importing file
 *     (`DomainUser`; the default-import binding; the namespace alias).
 *   - importInfo.importedName  = the exported name (`User`); 'default' for
 *     default imports; '*' for namespace imports; null for side-effect.
 *   - importInfo.moduleSpecifier = the RAW specifier as written (`'@/domain/user'`).
 *   - importInfo.importKind    = 'default' | 'named' | 'namespace' |
 *     'side-effect'.
 *
 * `symbol_name` keeps its historical meaning (imported name wins over the
 * `as` alias) so existing name-based aggregation (dead-code, hotspots, KG)
 * and the existing reference-emission tests are unchanged. The local alias is
 * carried separately in importInfo for TRACE's canonical-target exposure.
 */
export function emitImports(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
	const clause = node.childForFieldName("import_clause") ?? node.namedChildren.find((c) => c.type === IMPORT_CLAUSE);
	const line = node.startPosition.row + 1;
	const moduleSpecifier = moduleSpecifierOf(node);

	// `import "x";` — side-effect import: ONE row with null imported name.
	if (!clause) {
		refs.push({
			symbolName: moduleSpecifier ?? "(side-effect)",
			callerFile: "",
			callerLine: line,
			callerName: callerName,
			kind: "import",
			importInfo: {
				localName: moduleSpecifier ?? "",
				importedName: null,
				moduleSpecifier: moduleSpecifier ?? null,
				importKind: "side-effect"
			}
		});
		return;
	}

	// Default-import binding: `import Foo from "x"` → clause's first named child is an identifier.
	const defaultImport = clause.namedChildren.find((c) => c.type === "identifier");
	if (defaultImport && defaultImport.text.length > 0) {
		refs.push({
			symbolName: defaultImport.text,
			callerFile: "",
			callerLine: line,
			callerName: callerName,
			kind: "import",
			importInfo: {
				localName: defaultImport.text,
				importedName: "default",
				moduleSpecifier: moduleSpecifier ?? null,
				importKind: "default"
			}
		});
	}

	// Named imports: `import { a, b as c } from "x"`.
	const named = clause.namedChildren.find((c) => c.type === NAMED_IMPORTS);
	if (named) {
		for (const spec of named.namedChildren) {
			if (spec.type !== IMPORT_SPECIFIER) continue;
			const nameNode = spec.childForFieldName("name");
			const imported = nameNode?.text;
			if (!imported || imported === "default") continue; // skip rebindings aliased to `default`
			const aliasNode = spec.childForFieldName("alias");
			const local = aliasNode?.text ?? imported;
			refs.push({
				symbolName: imported,
				callerFile: "",
				callerLine: line,
				callerName: callerName,
				kind: "import",
				importInfo: {
					localName: local,
					importedName: imported,
					moduleSpecifier: moduleSpecifier ?? null,
					importKind: "named"
				}
			});
		}
	}

	// Namespace import `import * as ns` — the imported (namespace) binding is
	// ambiguous; index the alias so `ns` appears as the referenced symbol.
	const nsImport = clause.namedChildren.find((c) => c.type === NAMESPACE_IMPORT);
	if (nsImport) {
		const alias = (nsImport.lastNamedChild?.text ?? "").replace(/^as\s*/, "");
		if (alias) {
			refs.push({
				symbolName: alias,
				callerFile: "",
				callerLine: line,
				callerName: callerName,
				kind: "import",
				importInfo: {
					localName: alias,
					importedName: "*",
					moduleSpecifier: moduleSpecifier ?? null,
					importKind: "namespace"
				}
			});
		}
	}
}

/**
 * Emit one 'reexport' reference per re-exported binding in an export_statement
 * that carries a `source` (issue #87, TASK-013).
 *
 * Per binding the row's contract (mirrors the 'import' edge from #83):
 *   - kind                 = 'reexport'
 *   - symbol_name          = the exported name as written in THIS module
 *     (`User` of `export { User as DomainUser }`). For wildcard `export *`
 *     the name is unknown at parse time, so symbol_name carries the raw
 *     module specifier as a placeholder (resolved transitively at query time).
 *   - importInfo.localName       = the LOCAL alias (`DomainUser`; for named
 *     re-exports without alias this equals the exported name; for wildcard '*').
 *   - importInfo.importedName    = the canonical exported name (`User`); null
 *     for wildcard `export *`.
 *   - importInfo.moduleSpecifier  = the RAW specifier as written (`'./user'`).
 *   - importInfo.importKind       = 'named' | 'wildcard'.
 *
 * These edges are structurally emitted only — canonical-target resolution
 * (barrel-chain chasing) is performed by the reexport resolver at query time
 * (TRACE) or in the parse pipeline (when `resolveReexports` is enabled), and
 * written to target_file/target_symbol_id.
 */
export function emitReexports(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
	const line = node.startPosition.row + 1;
	const moduleSpecifier = moduleSpecifierOf(node);
	if (!moduleSpecifier) return;

	// `export * from './types'` — wildcard re-export: NO export_clause node.
	const clause = node.childForFieldName("export_clause");
	if (!clause) {
		refs.push({
			symbolName: moduleSpecifier,
			callerFile: "",
			callerLine: line,
			callerName,
			kind: "reexport",
			importInfo: {
				localName: "*",
				importedName: null,
				moduleSpecifier,
				importKind: "wildcard"
			}
		});
		return;
	}

	// `export { A, B as C } from './mod'` — one edge per export_specifier.
	for (const spec of clause.namedChildren) {
		if (spec.type !== "export_specifier") continue;
		const nameNode = spec.childForFieldName("name");
		const exported = nameNode?.text;
		if (!exported) continue;
		const aliasNode = spec.childForFieldName("alias");
		const alias = aliasNode?.text ?? null;
		refs.push({
			symbolName: exported,
			callerFile: "",
			callerLine: line,
			callerName,
			kind: "reexport",
			importInfo: {
				localName: alias ?? exported,
				importedName: exported,
				moduleSpecifier,
				importKind: "named"
			}
		});
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

// ═══════════════════════════════════════════════════════════════════════════
// TYPE-REFERENCE EDGES (TASK-008 / issue #82, migration v26)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The set of node types that NAME a type reference (the leaf types we emit
 * edges for). A `type` supertype in the grammar covers these plus structural
 * shapes (object/tuple/function/conditional/template-literal types) that
 * carry no single resolvable name — those are skipped by {@link typeRefName}.
 *
 * Verified against tree-sitter-typescript node-types.json (STD-001): the
 * primary_type supertype includes `type_identifier`, `nested_type_identifier`,
 * `generic_type`, `predefined_type`, `literal_type`, `array_type`,
 * `object_type`, `tuple_type`, `parenthesized_type`, `union_type`,
 * `intersection_type`, `conditional_type`, `function_type`, `constructor_type`,
 * `template_literal_type`, `lookup_type`, `index_type_query`, `this_type`,
 * `type_query`, `existential_type`, `const`, `flow_maybe_type`.
 */
const NAMED_TYPE_NODES = new Set([TYPE_IDENTIFIER, NESTED_TYPE_IDENTIFIER, GENERIC_TYPE]);

/**
 * Resolve the name-based target of a TYPE reference (not heritage).
 *
 * Per ADR-002 (name-based resolution, no LSP / type resolution) the edge
 * references the LAST name segment of the type as written:
 *
 *   - `type_identifier`               → `Foo`        (dto: Foo)
 *   - `nested_type_identifier`        → `Iface`      (x: UI.Iface)
 *   - `generic_type`                  → `Foo`        (x: Foo<T>)
 *   - `union_type` / `intersection_type` → the FIRST named child's target —
 *     callers walk each member; returning the first child keeps nested
 *     recursion working (e.g. `A | (B & C)` → A then (B & C) → B, C).
 *   - `array_type` / `parenthesized_type` → unwrap to the inner type.
 *   - `predefined_type` / `literal_type` / `object_type` / `tuple_type` /
 *     `function_type` / `conditional_type` / structural shapes → null (no
 *     resolvable name).
 *
 * Returns null when the type carries no resolvable name so no edge is emitted
 * for anonymous / structural types.
 */
export function typeRefName(node: TSNode): string | null {
	if (node.type === GENERIC_TYPE) {
		// `Foo<T>` — the generic type name is the `name` field (type_identifier
		// or nested_type_identifier).
		const base = node.childForFieldName("name") ?? node.namedChildren[0];
		return base ? typeRefName(base) : null;
	}
	if (node.type === TYPE_IDENTIFIER || node.type === NESTED_TYPE_IDENTIFIER || node.type === "identifier") {
		return node.type === NESTED_TYPE_IDENTIFIER ? (node.lastNamedChild?.text ?? null) : node.text;
	}
	if (node.type === ARRAY_TYPE || node.type === PAREN_TYPE) {
		const inner = node.namedChildren[0];
		return inner ? typeRefName(inner) : null;
	}
	if (node.type === UNION_TYPE || node.type === INTERSECTION_TYPE) {
		// Members are walked individually by the emitter; this arm keeps
		// recursion sane for nested composite types (e.g. `(A | B)[]`).
		const first = node.namedChildren[0];
		return first ? typeRefName(first) : null;
	}
	return null;
}

/**
 * Recursively emit 'type' reference edges for a type node.
 *
 * Walks the type AST depth-first emitting one edge per named type reference:
 *
 *   - `type_identifier` / `nested_type_identifier` / `generic_type` → the
 *     type's name, with the generic's `type_arguments` walked as 'generic'.
 *   - `union_type` / `intersection_type` → every member, tagged 'union' /
 *     'intersection'.
 *   - `array_type` / `parenthesized_type` → unwrapped (the array element /
 *     inner type).
 *   - structural types (object/tuple/function/conditional/template-literal)
 *     are not nameable themselves; their nested type children are still
 *     walked so `Promise<{ data: Foo }>` reaches Foo.
 *
 * @param node  the type node to walk (usually the `type_annotation`'s single
 *              named child, or a `constraint` / `type_arguments` member).
 * @param line  the 1-based declaration line of the owning symbol (caller site).
 * @param callerName  enclosing function/method name when determinable (the
 *                    declaration's own name for functions/methods; null for
 *                    class/interface/type-alias declarations).
 * @param role   the relation role for the emitted edges.
 * @param refs   reference accumulator.
 */
export function emitTypeRefs(
	node: TSNode,
	line: number,
	callerName: string | null,
	role: ReferenceRole,
	refs: ParsedReference[]
): void {
	if (NAMED_TYPE_NODES.has(node.type)) {
		const name = typeRefName(node);
		if (name) {
			refs.push({
				symbolName: name,
				callerFile: "",
				callerLine: line,
				callerName,
				kind: "type",
				role
			});
		}
		if (node.type === GENERIC_TYPE) {
			// `Foo<T, U>` — the type arguments are themselves types; emit each
			// as a 'generic' role edge (nested generics recurse naturally).
			const args = node.childForFieldName("type_arguments");
			if (args) {
				for (const arg of args.namedChildren) {
					emitTypeRefs(arg, line, callerName, "generic", refs);
				}
			}
		}
		return;
	}

	if (node.type === UNION_TYPE || node.type === INTERSECTION_TYPE) {
		const memberRole = node.type === UNION_TYPE ? "union" : "intersection";
		for (const member of node.namedChildren) {
			emitTypeRefs(member, line, callerName, memberRole, refs);
		}
		return;
	}

	if (node.type === ARRAY_TYPE || node.type === PAREN_TYPE) {
		const inner = node.namedChildren[0];
		if (inner) emitTypeRefs(inner, line, callerName, role, refs);
		return;
	}

	// Structural / anonymous types (object_type, tuple_type, function_type,
	// conditional_type, template_literal_type, lookup_type, ...): not nameable
	// themselves — walk named children so nested named types are still found.
	for (const child of node.namedChildren) {
		emitTypeRefs(child, line, callerName, role, refs);
	}
}

/**
 * Emit type-reference edges for a single declaration's OWN type surface:
 * function/method parameters + return type, class/interface property types,
 * type-alias values, and generic constraint/type-argument bindings.
 *
 * Entry points (verified against tree-sitter-typescript node-types.json):
 *
 *   - `function_declaration` / `generator_function_declaration` /
 *     `arrow_function` / `function_expression` / `method_definition` /
 *     `method_signature` / `abstract_method_signature` / `call_signature` /
 *     `construct_signature` / `function_type` / `constructor_type`:
 *     `parameters` (formal_parameters → required/optional_parameter → `type`
 *     field = type_annotation) → 'parameter'; `return_type` field
 *     (type_annotation) → 'return'. `callerName` = the declared name (or null
 *     for anonymous functions).
 *   - `class_declaration` / `abstract_class_declaration`: properties
 *     (`public_field_definition` / `field_definition` → `type` field) →
 *     'property'; method definitions are handled by their own entry.
 *   - `interface_declaration`: `property_signature` members → 'property';
 *     `method_signature` members → parameters/return of the member.
 *   - `type_alias_declaration`: `value` field (type) → 'alias'.
 *   - Generic `type_parameters` (on functions/methods/classes/interfaces/
 *     aliases): each `type_parameter`'s `constraint` → 'constraint', and its
 *     `default_type` (value field) → 'generic' (a default binding is a
 *     type-level dependency).
 *
 * Type-annotation-less declarations emit nothing (existing behavior unchanged).
 */
export function emitTypeReferences(node: TSNode, declaredName: string | null, refs: ParsedReference[]): void {
	const line = node.startPosition.row + 1;

	// ── Generic type parameters (constraints + defaults) — all declarations ──
	const ownTypeParams = node.namedChildren.find((c) => c.type === TYPE_PARAMETERS);
	if (ownTypeParams) {
		for (const param of ownTypeParams.namedChildren) {
			if (param.type !== TYPE_PARAMETER) continue;
			for (const child of param.namedChildren) {
				if (child.type === CONSTRAINT) {
					for (const target of child.namedChildren) {
						emitTypeRefs(target, line, declaredName, "constraint", refs);
					}
				} else if (child.type === "default_type") {
					for (const target of child.namedChildren) {
						emitTypeRefs(target, line, declaredName, "generic", refs);
					}
				}
			}
		}
	}

	// ── Function-like: parameters + return type ──
	const parameters = node.childForFieldName("parameters");
	if (parameters && parameters.type === FORMAL_PARAMETERS) {
		for (const p of parameters.namedChildren) {
			if (p.type !== REQUIRED_PARAMETER && p.type !== OPTIONAL_PARAMETER) continue;
			const ann = p.childForFieldName("type");
			if (!ann || ann.type !== TYPE_ANNOTATION) continue;
			for (const t of ann.namedChildren) {
				emitTypeRefs(t, line, declaredName, "parameter", refs);
			}
		}
	}
	const returnType = node.childForFieldName("return_type");
	if (returnType && returnType.type === TYPE_ANNOTATION) {
		for (const t of returnType.namedChildren) {
			emitTypeRefs(t, line, declaredName, "return", refs);
		}
	}

	// ── Class/interface properties & fields + type-alias values ──
	if (node.type === TYPE_ALIAS_DECLARATION) {
		const value = node.childForFieldName("value");
		if (value) {
			for (const t of value.namedChildren) {
				emitTypeRefs(t, line, null, "alias", refs);
			}
		}
	}
	if (
		node.type === "public_field_definition" ||
		node.type === "field_definition" ||
		node.type === "property_signature"
	) {
		const ann = node.childForFieldName("type");
		if (ann && ann.type === TYPE_ANNOTATION) {
			for (const t of ann.namedChildren) {
				emitTypeRefs(t, line, declaredName, "property", refs);
			}
		}
	}
}
