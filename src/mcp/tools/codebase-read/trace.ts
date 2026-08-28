import type { CodebaseReadInput } from "../schemas/codebase-read";
import { SQLiteStore } from "../../storage/sqlite";
import type { CodebaseSymbol, CodebaseReference } from "../../types";
import { createMcpResponse, type McpResponse } from "../../utils/mcp-response";
import { traceSymbol, AmbiguousSymbolError, type TraceReference } from "../../codebase-index/services/trace-service";
import { formatDocComment } from "../../utils/doc-comment-format";
import { logger } from "../../utils/logger";

// ── TRACE ────────────────────────────────────────────────────────────────

/**
 * Map a stored codebase_references row to a TraceReference (the trace-service
 * input contract), building the human-readable context line.
 *
 * Import metadata (v27, issue #83) is surfaced: for an aliased import the
 * context shows `import <imported> as <local> from '<specifier>'` and the
 * canonical target fields (targetFile/targetSymbolId) ride along on the
 * reference.
 */
export function storedReferenceToTraceReference(r: CodebaseReference): TraceReference {
	const importNote = r.import_kind ? ` (${r.import_kind}${r.local_name ? `, local=${r.local_name}` : ""})` : "";
	const context = `${r.kind} ${r.symbol_name}${importNote}${r.role ? ` (${r.role})` : ""}${
		r.module_specifier ? ` from '${r.module_specifier}'` : ""
	}${r.caller_name ? ` (in ${r.caller_name})` : ""}`;
	return {
		filePath: r.caller_file,
		startLine: r.caller_line ?? 0,
		startCol: 0,
		endLine: r.caller_line ?? 0,
		endCol: 0,
		context,
		kind: r.kind,
		callerName: r.caller_name,
		targetFile: r.target_file,
		targetSymbolId: r.target_symbol_id,
		role: r.role ?? null,
		localName: r.local_name ?? null,
		importedName: r.imported_name ?? null,
		moduleSpecifier: r.module_specifier ?? null,
		importKind: r.import_kind ?? null
	};
}

async function handleTraceMode(validated: CodebaseReadInput, db: SQLiteStore): Promise<McpResponse> {
	const name = validated.name!.trim();

	const repo = validated.repo?.trim();

	const allSymbols: CodebaseSymbol[] = repo
		? db.codebaseSymbols.getSymbolsByRepo(repo)
		: db.codebaseSymbols.getAllSymbols();

	const symbols = allSymbols.length > 0 ? allSymbols : [];

	function tryTrace(traceName: string): McpResponse | null {
		try {
			// Table-backed reference edges for the exact symbol (TASK-236 / #64;
			// Phase 1.1 heritage kinds + target fields v23 / TASK-299). TRACE
			// mode requires a concrete repo, so this is always scoped. Reflected
			// into TraceReference for the trace result; the service merges them
			// with the in-memory doc_comment scan and dedupes by call-site line.
			const storedRefs: TraceReference[] =
				validated.includeReferences && repo
					? db.codebaseReferences.getReferencesBySymbol(repo, traceName).map(storedReferenceToTraceReference)
					: [];

			const result = traceSymbol(traceName, repo, symbols, validated.includeReferences, storedRefs);

			const refList =
				result.references.length > 0
					? `\n\n### References (${result.references.length})\n\n${result.references
							.slice(0, 20)
							.map((r) => `- ${r.filePath}:${r.startLine}-${r.endLine}`)
							.join("\n")}${result.references.length > 20 ? `\n... and ${result.references.length - 20} more` : ""}`
					: "";

			// Hierarchy surface (TASK-300): parent container + direct children of
			// the traced symbol, populated from parent_symbol_id links at index time.
			const hierarchy =
				result.parent || result.children.length > 0
					? `\n\n### Hierarchy\n\n${result.parent ? `Parent: ${result.parent.name} (${result.parent.kind}) — ${result.parent.filePath}:${result.parent.line ?? "?"}` : "Parent: none (top-level)"}\nChildren (${result.children.length}):\n${result.children
							.slice(0, 20)
							.map((c) => `- ${c.name} (${c.kind}) — ${c.file_path}:${c.start_line ?? "?"}`)
							.join("\n")}${result.children.length > 20 ? `\n... and ${result.children.length - 20} more` : ""}`
					: "";

			const docPart = (() => {
				const d = formatDocComment(result.symbol.doc_comment);
				return d ? `\nDoc: ${d}` : "";
			})();
			const contentSummary = `Symbol "${traceName}"\nDefined: ${result.definition.file}:${result.definition.line}-${result.definition.endLine}${docPart}${refList}${hierarchy}`;

			return createMcpResponse(
				{ ...result, mode: "trace", originalName: traceName !== name ? name : undefined },
				`Symbol "${traceName}": defined in ${result.definition.file}:${result.definition.line}, ` +
					`${result.references.length} references, ` +
					`${result.parent ? `parent ${result.parent.name}, ` : ""}${result.children.length} children found`,
				{ includeJson: true, contentSummary }
			);
		} catch (err) {
			// Re-throw ambiguous errors — they should propagate, not fall through
			if (err instanceof AmbiguousSymbolError) throw err;
			return null;
		}
	}

	function camelCaseFromHyphens(s: string): string {
		return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
	}

	// Try exact name first, then fallback variants
	const nameVariants = [name];

	// Variant 1: hyphens → dots (e.g., memory-write → memory.write)
	if (name.includes("-")) {
		nameVariants.push(name.replace(/-/g, "."));
	}

	// Variant 2: hyphens → camelCase (e.g., memory-write → memoryWrite)
	if (name.includes("-")) {
		nameVariants.push(camelCaseFromHyphens(name));
	}

	// Variant 3: dots → hyphens (e.g., memory.write → memory-write)
	if (name.includes(".")) {
		nameVariants.push(name.replace(/\./g, "-"));
	}

	// Variant 4: underscores → hyphens
	if (name.includes("_")) {
		nameVariants.push(name.replace(/_/g, "-"));
	}

	// Deduplicate
	const seen = new Set<string>();
	const uniqueVariants: string[] = [];
	for (const v of nameVariants) {
		if (!seen.has(v)) {
			seen.add(v);
			uniqueVariants.push(v);
		}
	}

	try {
		for (const v of uniqueVariants) {
			const result = tryTrace(v);
			if (result) return result;
		}
	} catch (err) {
		if (err instanceof AmbiguousSymbolError) {
			return createMcpResponse(
				{
					error: err.message,
					code: "AMBIGUOUS_SYMBOL",
					disambiguation: err.disambiguation.map((s) => ({
						name: s.name,
						kind: s.kind,
						file: s.file_path,
						line: s.start_line,
						exported: s.exported
					}))
				},
				err.message,
				{ includeJson: true }
			);
		}
		const message = err instanceof Error ? err.message : String(err);
		logger.error("[handleCodebaseRead:trace] Unexpected error", { name, repo, error: message });
		return createMcpResponse({ error: message, code: "TRACE_FAILED" }, message, {
			includeJson: true
		});
	}

	// All variants failed — return SymbolNotFoundError for the original name
	return createMcpResponse(
		{ error: `Symbol "${name}" not found`, code: "SYMBOL_NOT_FOUND" },
		`Symbol "${name}" not found`,
		{ includeJson: true }
	);
}

export { handleTraceMode };
