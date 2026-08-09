/**
 * codebase-graph — dashboard graph-domain service layer (TASK-324, CG-B).
 *
 * Backend for the file-content / symbol-callers / code-graph endpoints that
 * feed the dashboard FileViewer + CallGraph DAG + code-graph force panel:
 *
 *  1. `readFileContent`  — GET/POST /api/codebase/file/content. Reads a file
 *     from DISK at the resolved repo root (resolveRepoPath is owned by
 *     CodebaseService, which passes the verified root in). Indexed files flow
 *     through the PROCESS-SHARED checksum-keyed LRU cache from CODE mode
 *     (code-search.ts, TASK-316) — cache reuse, no DB content storage.
 *     Non-indexed files are read fresh from disk (the cache's validity key is
 *     the codebase_files row checksum; without a row there is nothing to key
 *     on, and the FileViewer must show current disk state). Path traversal is
 *     REJECTED: the resolved path must stay inside the repo root (lexical
 *     containment + realpath hardening — absolute and `..` inputs are
 *     refused before any read, symlinks are resolved and re-checked).
 *  2. `getSymbolCallers` — GET /api/codebase/symbol/callers. Caller/callee
 *     PAIRS from codebase_references grouped by caller symbol — the CallGraph
 *     DAG data (mirrors trace-service.ts's reference model, but exposes the
 *     ordered pair list the graph needs instead of a single flat array).
 *  3. `buildCodeGraph`   — GET /api/codebase/graph. Layout-compatible
 *     nodes/edges for KGGraphCanvas (LayoutNode{id,name,kind,filePath,size} /
 *     LayoutEdge{source,target,relation_type}): nodes = symbols (id `sym-*`),
 *     edges = resolved codebase_references (call/import/… relation types;
 *     heritage + module-scope import rows carry caller_name=null and are
 *     anchored to their caller symbol by SPAN — TASK-374) + same-file
 *     consecutive co_defined edges (mirrors unified-graph.service.ts:90-105).
 *     Server-side degree ranking selects the
 *     top-N symbols (by reference count), only edges between selected symbols
 *     are shipped, and the edge list is capped at CODE_GRAPH_MAX_EDGES with
 *     combined-degree priority — cargo bounded regardless of repo size.
 *
 * No schema change, no migrations, no DB growth — disk reads + existing
 * tables only. Controllers delegate here (CodebaseService owns owner-/
 * repo-path resolution); this module touches `db` directly like
 * UnifiedGraphService.
 */

import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/context";
import { ServiceError } from "../lib/jsonApi";
import { codeSearchCache } from "../../mcp/codebase-index/services/code-search";
import { detectLanguage } from "../../mcp/codebase-index/services/file-discovery";
import {
	CODE_GRAPH_DEFAULT_NODE_LIMIT,
	CODE_GRAPH_MAX_EDGES,
	CODE_GRAPH_MAX_NODES,
	FILE_CONTENT_MAX_LINES
} from "../../mcp/utils/constants";
import type { CodebaseReference, CodebaseSymbol } from "../../mcp/types";

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface FileContentResult {
	/** Relative file path as requested (codebase_files.file_path form). */
	file_path: string;
	/** codebase_files.language for indexed files, extension-derived otherwise. */
	language: string | null;
	/** Total lines in the file on disk (unaffected by the content cap). */
	lines: number;
	/** Total UTF-8 byte size of the file on disk (unaffected by the cap). */
	size_bytes: number;
	/** File content, bounded to FILE_CONTENT_MAX_LINES lines. */
	content: string;
	/** True when the file was longer than FILE_CONTENT_MAX_LINES. */
	truncated: boolean;
}

/** One directed call-site relationship: caller symbol → callee symbol. */
export interface CallerCalleePair {
	caller: {
		/** Enclosing function/method name at the call site (null when undeterminable). */
		name: string | null;
		/** File holding the call site (codebase_references.caller_file). */
		filePath: string;
		line: number | null;
	};
	callee: {
		/** The referenced (called/imported/…) symbol name. */
		name: string;
		/** Target file when resolvable at parse time (v23), else null. */
		filePath: string | null;
	};
	/** 'call' | 'instantiation' | 'import' | 'extends' | 'implements'. */
	kind: string;
}

export interface SymbolCallersResult {
	/** The queried symbol (filePath-scoped when provided; unique name otherwise). */
	symbol: { name: string; kind: string; filePath: string; line: number | null };
	/** Flat caller→callee pairs — the CallGraph DAG edge list. */
	pairs: CallerCalleePair[];
	/** The same pairs grouped by caller symbol (aggregation for the DAG tooltip/drill). */
	groupedByCaller: Array<{
		caller: { name: string | null; filePath: string; kind: string | null };
		count: number;
		pairs: CallerCalleePair[];
	}>;
	total: number;
}

/** Graph node in KGGraphCanvas-compatible shape (LayoutNode subset). */
export interface CodeGraphNode {
	/** `sym-${codebase_symbols.id}` — unique per symbol. */
	id: string;
	name: string;
	kind: string;
	filePath: string;
	/** Degree-scaled visual weight (14 + min(degree, 30)) — importance signal. */
	size: number;
	/** Reference/edge degree used for server-side ranking. */
	degree: number;
}

/** Graph edge in KGGraphCanvas-compatible shape (LayoutEdge subset). */
export interface CodeGraphEdge {
	source: string;
	target: string;
	/** 'call' | 'instantiation' | 'import' | 'extends' | 'implements' | 'co_defined'. */
	relation_type: string;
}

export type CodeGraphKind = "call" | "import" | "co_defined";

export interface CodeGraphResult {
	/** `codebase-graph-${repo}`. */
	id: string;
	nodes: CodeGraphNode[];
	edges: CodeGraphEdge[];
	/** True when the edge list was trimmed to CODE_GRAPH_MAX_EDGES. */
	truncated: boolean;
	stats: {
		totalSymbols: number;
		totalRefs: number;
		nodeLimit: number;
		edgeCap: number;
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY BOUNDARY — path containment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve a caller-supplied relative path strictly INSIDE the repo root.
 *
 * Returns null when the path is not contained — the caller must reject the
 * request (PATH_TRAVERSAL). Three layers:
 *   1. Absolute inputs are refused outright (`path.resolve` would otherwise
 *      DISCARD repoRoot and anchor at the absolute path — the classic escape).
 *   2. Lexical containment: the resolved path's relative offset must not
 *      start with `..` nor be absolute (catches `../`, nested `a/../../b`).
 *   3. realpath hardening (defense-in-depth): even a lexically-contained
 *      path can smuggle a symlink whose target lives outside the repo — both
 *      sides are realpath'd and containment re-checked on the REAL paths.
 *      A missing file (ENOENT) passes the lexical path through so the read
 *      surfaces the proper 404 (FILE_NOT_FOUND); any other realpath failure
 *      resolves to "not contained" (reject).
 *
 * `repoRoot` must be a directory (CODEBASE_REPOS_DIR / repoPath verified by
 * CodebaseService via resolveRepoPath).
 */
function resolveInsideRepo(repoRoot: string, filePath: string): string | null {
	if (path.isAbsolute(filePath)) return null;
	const resolved = path.resolve(repoRoot, filePath);
	const rel = path.relative(repoRoot, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
	try {
		const realRoot = fs.realpathSync(repoRoot);
		const realFile = fs.realpathSync(resolved);
		const realRel = path.relative(realRoot, realFile);
		if (realRel.startsWith("..") || path.isAbsolute(realRel)) return null;
		return realFile;
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return resolved;
		return null;
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. FILE CONTENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read a file's content from disk (bounded) for the FileViewer.
 *
 * - `repoRoot` is the VERIFIED repo root (CodebaseService resolves it via
 *   resolveRepoPath). `repo` is the short repo name (DB form) used for the
 *   codebase_files lookup + cache key.
 * - Indexed files reuse the process-shared checksum-keyed LRU (CODE mode /
 *   TASK-316) — repeated reads never touch disk again until a re-index bumps
 *   the row checksum. Language comes from the codebase_files row.
 * - Non-indexed files are read fresh on every request (no checksum validity
 *   key exists, and the viewer must reflect current disk state); language is
 *   extension-derived via detectLanguage.
 * - Traversal is rejected before any read (resolveInsideRepo).
 *
 * @throws ServiceError 400 PATH_TRAVERSAL / 404 FILE_NOT_FOUND.
 */
export async function readFileContent(repoRoot: string, repo: string, filePath: string): Promise<FileContentResult> {
	const absolutePath = resolveInsideRepo(repoRoot, filePath);
	if (absolutePath === null) {
		throw new ServiceError(400, `path "${filePath}" does not resolve inside the repo root`, "PATH_TRAVERSAL");
	}

	const indexed = db.codebaseFiles.getFile(repo, filePath);

	let content: string;
	try {
		if (indexed) {
			// Cache-reuse path (TASK-324 reuses the TASK-316 CODE-mode cache):
			// the codebase_files row checksum is the validity key.
			content = await codeSearchCache.getContent(repo, filePath, indexed.checksum ?? null, absolutePath);
		} else {
			content = await fs.promises.readFile(absolutePath, "utf-8");
		}
	} catch {
		throw new ServiceError(404, `File not found on disk: ${filePath}`, "FILE_NOT_FOUND");
	}

	const [lines, sizeBytes] = countLinesAndBytes(content);
	const truncated = lines > FILE_CONTENT_MAX_LINES;
	const boundedContent = truncated ? sliceLines(content, FILE_CONTENT_MAX_LINES) : content;

	return {
		file_path: filePath,
		// Authoritative for indexed files; extension-derived for non-indexed.
		language: indexed?.language ?? detectLanguage(filePath),
		lines,
		size_bytes: sizeBytes,
		content: boundedContent,
		truncated
	};
}

/** Total line count + UTF-8 byte size for a file's content. */
function countLinesAndBytes(content: string): [number, number] {
	const lines = content.split(/\r?\n/).length;
	return [lines, Buffer.byteLength(content, "utf-8")];
}

/** Keep only the first `maxLines` lines (CRLF preserved per line). */
function sliceLines(content: string, maxLines: number): string {
	return content.split(/\r?\n/).slice(0, maxLines).join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. SYMBOL CALLERS (CallGraph DAG pairs)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Caller/callee pairs for a symbol, grouped by caller (CallGraph DAG data).
 *
 * Mirrors the reference model of trace-service.ts (rows where
 * `symbol_name = target`), but exposes the ordered PAIR list the graph needs.
 * Caller context comes from codebase_references (caller_file / caller_line /
 * caller_name); callee = the queried symbol (with target_file when the v23
 * parse resolved it). Pairs are deduped by (caller name/file/line + kind) so
 * one call site never yields duplicate edges.
 *
 * `filePath` (optional, TASK-373) scopes the lookup to a single definition —
 * graph nodes carry filePath, so the CallGraph drilldown (TASK-328) always
 * disambiguates duplicate symbol names. When the scope still leaves multiple
 * matches (or a duplicate name is queried without filePath), the call fails
 * with 409 AMBIGUOUS_SYMBOL listing the candidates — mirroring traceSymbol's
 * disambiguation contract instead of silently picking an arbitrary
 * definition. filePath-scoped PAIRS are filtered to rows whose target
 * resolves to that exact symbol (target_symbol_id, else target_file), so the
 * returned symbol metadata and its edges describe the SAME node.
 *
 * @throws ServiceError 404 SYMBOL_NOT_FOUND when no symbol of that name
 *   exists (in that file, when filePath is provided).
 * @throws ServiceError 409 AMBIGUOUS_SYMBOL on duplicate names that filePath
 *   does not narrow to one.
 */
export function getSymbolCallers(repo: string, name: string, kind?: string, filePath?: string): SymbolCallersResult {
	const matches = db.codebaseSymbols.getSymbolByName(repo, name);
	if (matches.length === 0) {
		throw new ServiceError(404, `Symbol "${name}" not found in repo "${repo}"`, "SYMBOL_NOT_FOUND");
	}
	// Optional filePath scoping — never fall back to an arbitrary definition
	// for duplicate names (409, mirroring traceSymbol).
	const scoped = filePath ? matches.filter((m) => m.file_path === filePath) : matches;
	if (scoped.length === 0) {
		const where = filePath ? ` in file "${filePath}"` : "";
		throw new ServiceError(404, `Symbol "${name}" not found${where} in repo "${repo}"`, "SYMBOL_NOT_FOUND");
	}
	if (scoped.length > 1) {
		const candidates = scoped.map((s) => `${s.file_path}:${s.start_line ?? 0}`).join(", ");
		throw new ServiceError(
			409,
			`Ambiguous symbol "${name}" in repo "${repo}" — ${scoped.length} matches (${candidates}); provide filePath to disambiguate`,
			"AMBIGUOUS_SYMBOL"
		);
	}
	const symbol = scoped[0];

	let refs = db.codebaseReferences.getReferencesBySymbol(repo, name);
	// When scoped to a file, keep only pairs attributable to that definition
	// (exact target_symbol_id, else target_file) — the pairs + symbol
	// metadata must describe the same node the drilldown points at.
	if (filePath) {
		refs = refs.filter((r) =>
			r.target_symbol_id ? r.target_symbol_id === symbol.id : r.target_file === symbol.file_path
		);
	}
	if (kind) refs = refs.filter((r) => r.kind === kind);

	// Per-file symbol preload (bounded per request) resolves caller kinds for
	// the grouped view without an N+1 per call site.
	const fileSymbolsCache = new Map<string, CodebaseSymbol[]>();
	const callerKindOf = (filePath: string, callerName: string | null): string | null => {
		if (!callerName) return null;
		let fileSymbols = fileSymbolsCache.get(filePath);
		if (!fileSymbols) {
			fileSymbols = db.codebaseSymbols.getSymbolsByFile(repo, filePath);
			fileSymbolsCache.set(filePath, fileSymbols);
		}
		return fileSymbols.find((s) => s.name === callerName)?.kind ?? null;
	};

	const pairKey = (p: CallerCalleePair): string =>
		`${p.caller.name ?? ""}\u0000${p.caller.filePath}\u0000${p.caller.line ?? 0}\u0000${p.kind}`;

	const pairs: CallerCalleePair[] = [];
	const seenPairs = new Set<string>();
	for (const ref of refs) {
		const pair: CallerCalleePair = {
			caller: { name: ref.caller_name, filePath: ref.caller_file, line: ref.caller_line },
			callee: { name: ref.symbol_name, filePath: ref.target_file },
			kind: ref.kind
		};
		const key = pairKey(pair);
		if (seenPairs.has(key)) continue;
		seenPairs.add(key);
		pairs.push(pair);
	}

	// Group by caller symbol (name + file), preserving first-seen order.
	const grouped = new Map<string, SymbolCallersResult["groupedByCaller"][number]>();
	for (const pair of pairs) {
		const key = `${pair.caller.name ?? ""}\u0000${pair.caller.filePath}`;
		let entry = grouped.get(key);
		if (!entry) {
			entry = {
				caller: {
					name: pair.caller.name,
					filePath: pair.caller.filePath,
					kind: callerKindOf(pair.caller.filePath, pair.caller.name)
				},
				count: 0,
				pairs: []
			};
			grouped.set(key, entry);
		}
		entry.count++;
		entry.pairs.push(pair);
	}

	return {
		symbol: { name: symbol.name, kind: symbol.kind, filePath: symbol.file_path, line: symbol.start_line },
		pairs,
		groupedByCaller: [...grouped.values()],
		total: pairs.length
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. CODE GRAPH (KGGraphCanvas-compatible nodes/edges)
// ═══════════════════════════════════════════════════════════════════════════

/** Valid `kind` values for GET /api/codebase/graph. */
export const CODE_GRAPH_KINDS: readonly CodeGraphKind[] = ["call", "import", "co_defined"];

/**
 * Build the aggregated code graph for a repo.
 *
 * Pipeline: verify indexed → resolve caller/target symbols for every
 * reference row → degree-rank symbols → select top-N → ship only edges whose
 * both endpoints are selected → cap edges (CODE_GRAPH_MAX_EDGES) with
 * combined-degree priority. Callers resolve by name; rows with caller_name
 * null (heritage extends/implements + module-scope imports — the TS emitter
 * hard-codes null there) resolve by SPAN: the innermost symbol containing
 * caller_line, else the file's first top-level symbol (TASK-374). `kind`
 * filters the edge families; absent means ALL reference kinds + co_defined.
 * Deterministic everywhere (file/line ordering, stable sorts,
 * insertion-ordered Maps).
 *
 * @throws ServiceError 404 REPO_NOT_INDEXED (no files) / 400 INVALID_GRAPH_KIND.
 */
export function buildCodeGraph(repo: string, rawLimit?: string, rawKind?: string): CodeGraphResult {
	if (db.codebaseFiles.getFileCountByRepo(repo) === 0) {
		throw new ServiceError(404, `Repo "${repo}" is not indexed — run index first`, "REPO_NOT_INDEXED");
	}

	const kind = normalizeGraphKind(rawKind);
	const nodeLimit = parseNodeLimit(rawLimit);

	const symbols = db.codebaseSymbols.getSymbolsByRepo(repo);
	const refs = db.codebaseReferences.getReferencesByRepo(repo);

	// Symbol indexes: by id (target_symbol_id resolution), by file+name
	// (caller_name / unresolved target resolution — the name-based model), and
	// by file (span-based caller resolution for caller_name-null rows —
	// heritage + module-scope imports, TASK-374).
	const byId = new Map<string, CodebaseSymbol>();
	const byFileAndName = new Map<string, CodebaseSymbol>();
	const byFile = new Map<string, CodebaseSymbol[]>();
	for (const sym of symbols) {
		byId.set(sym.id, sym);
		const key = `${sym.file_path}\u0000${sym.name}`;
		if (!byFileAndName.has(key)) byFileAndName.set(key, sym);
		const fileList = byFile.get(sym.file_path);
		if (fileList) fileList.push(sym);
		else byFile.set(sym.file_path, [sym]);
	}

	interface RawEdge {
		source: string;
		target: string;
		relation_type: string;
	}

	const refEdges: RawEdge[] = [];
	const coEdges: RawEdge[] = [];
	// Degree = count of in-scope edges touching each symbol (spec: "degree
	// from refs count" — co_defined edges only contribute in co_defined mode,
	// where they are the only signal available).
	const degree = new Map<string, number>();
	const bump = (id: string): void => {
		degree.set(id, (degree.get(id) ?? 0) + 1);
	};

	// ── Reference edges (call/instantiation/import/extends/implements) ──
	if (kind !== "co_defined") {
		for (const ref of refs) {
			if (kind === "call" && ref.kind !== "call") continue;
			if (kind === "import" && ref.kind !== "import") continue;

			// Caller by name when the emitter resolved one; by SPAN when
			// caller_name is null (heritage/module-scope import rows) — never
			// drop a heritage/import edge just because the parse had no name.
			const callerSym =
				ref.caller_name !== null
					? byFileAndName.get(`${ref.caller_file}\u0000${ref.caller_name}`)
					: resolveCallerBySpan(ref, byFile);
			if (!callerSym) continue;
			const targetSym = resolveTargetSymbol(ref, byId, byFileAndName);
			if (!targetSym || targetSym.id === callerSym.id) continue;

			refEdges.push({ source: callerSym.id, target: targetSym.id, relation_type: ref.kind });
			bump(callerSym.id);
			bump(targetSym.id);
		}
	}

	// ── co_defined edges (same-file consecutive symbols, unified-graph
	//    pattern :90-105) — deterministic via getSymbolsByRepo ordering ──
	if (kind !== "call" && kind !== "import") {
		const fileGroups = new Map<string, string[]>();
		for (const sym of symbols) {
			const ids = fileGroups.get(sym.file_path) ?? [];
			ids.push(sym.id);
			fileGroups.set(sym.file_path, ids);
		}
		for (const ids of fileGroups.values()) {
			for (let i = 1; i < ids.length; i++) {
				coEdges.push({ source: ids[i - 1], target: ids[i], relation_type: "co_defined" });
				if (kind === "co_defined") {
					bump(ids[i - 1]);
					bump(ids[i]);
				}
			}
		}
	}

	// ── Degree ranking + top-N node selection ───────────────────────────
	const symbolIndex = new Map<string, number>();
	symbols.forEach((sym, i) => symbolIndex.set(sym.id, i));
	const rankedIds: string[] =
		degree.size === 0
			? symbols.map((s) => s.id) // no refs/co signal → file-order fallback
			: [...degree.entries()]
					.sort((a, b) => b[1] - a[1] || (symbolIndex.get(a[0]) ?? 0) - (symbolIndex.get(b[0]) ?? 0))
					.map(([id]) => id);
	const selected = new Set(rankedIds.slice(0, nodeLimit));

	// ── Edge assembly: dedupe (site multiplicity ≠ graph multiplicity) → keep
	//    only edges between selected nodes → cap by combined-degree priority ──
	const deduped: RawEdge[] = [];
	{
		const seen = new Set<string>();
		const all =
			kind === "co_defined" ? coEdges : kind === "call" || kind === "import" ? refEdges : [...refEdges, ...coEdges];
		for (const edge of all) {
			const key = `${edge.source}\u0000${edge.target}\u0000${edge.relation_type}`;
			if (seen.has(key)) continue;
			seen.add(key);
			deduped.push(edge);
		}
	}

	const inScope = deduped.filter((e) => selected.has(e.source) && selected.has(e.target));
	const truncated = inScope.length > CODE_GRAPH_MAX_EDGES;
	const priority = (e: RawEdge): number => (degree.get(e.source) ?? 0) + (degree.get(e.target) ?? 0);
	const finalEdges: RawEdge[] = truncated
		? [...inScope].sort((a, b) => priority(b) - priority(a)).slice(0, CODE_GRAPH_MAX_EDGES)
		: inScope;

	const nodes: CodeGraphNode[] = rankedIds
		.filter((id) => selected.has(id))
		.map((id) => {
			const sym = byId.get(id);
			if (!sym) throw new ServiceError(500, `Selected symbol ${id} missing from index`, "GRAPH_ASSEMBLY");
			const deg = degree.get(id) ?? 0;
			return {
				id: `sym-${id}`,
				name: sym.name,
				kind: sym.kind,
				filePath: sym.file_path,
				size: 14 + Math.min(deg, 30),
				degree: deg
			};
		});

	return {
		id: `codebase-graph-${repo}`,
		nodes,
		edges: finalEdges.map((e) => ({
			source: `sym-${e.source}`,
			target: `sym-${e.target}`,
			relation_type: e.relation_type
		})),
		truncated,
		stats: { totalSymbols: symbols.length, totalRefs: refs.length, nodeLimit, edgeCap: CODE_GRAPH_MAX_EDGES }
	};
}

/**
 * Resolve a reference row to its target SYMBOL (the callee node):
 * target_symbol_id (exact, v23) → (target_file, symbol_name) → same-file
 * (symbol_name in caller_file, the v21 pre-target-file fallback). Returns
 * undefined when the target cannot be anchored to a real symbol — such rows
 * are dropped (an edge needs a real node at both ends, and a dangling name
 * points at a symbol that was never indexed into this repo's row set).
 */
function resolveTargetSymbol(
	ref: CodebaseReference,
	byId: Map<string, CodebaseSymbol>,
	byFileAndName: Map<string, CodebaseSymbol>
): CodebaseSymbol | undefined {
	if (ref.target_symbol_id) {
		const exact = byId.get(ref.target_symbol_id);
		if (exact) return exact;
	}
	if (ref.target_file) {
		const byPath = byFileAndName.get(`${ref.target_file}\u0000${ref.symbol_name}`);
		if (byPath) return byPath;
	}
	return byFileAndName.get(`${ref.caller_file}\u0000${ref.symbol_name}`);
}

/**
 * Resolve the caller symbol for a reference row whose caller_name is null.
 *
 * The TS emitter hard-codes callerName:null for ALL heritage rows
 * (extends/implements — ts-reference-emission.ts) and for module-scope import
 * rows (typescript-visitor.ts), so name-based lookup is impossible. Anchor by
 * SPAN instead: the innermost symbol in `ref.caller_file` whose
 * [start_line, end_line] contains `ref.caller_line`. When nothing contains
 * the line (or the line is unknown — e.g. a module-scope import sitting above
 * the first symbol's span), fall back to the file's first top-level symbol
 * (parent_symbol_id null), giving the edge a deterministic file-level anchor.
 * The row is only dropped when the caller file has NO symbols at all.
 *
 * Deterministic: innermost by span width, ties by earlier start then id;
 * top-level fallback by (start_line, start_col, id).
 */
function resolveCallerBySpan(
	ref: CodebaseReference,
	byFile: Map<string, CodebaseSymbol[]>
): CodebaseSymbol | undefined {
	const fileSymbols = byFile.get(ref.caller_file);
	if (!fileSymbols || fileSymbols.length === 0) return undefined;

	// Innermost symbol containing the call-site line (smallest span wins —
	// a nested class/method beats its enclosing class).
	let innermost: CodebaseSymbol | undefined;
	if (ref.caller_line !== null) {
		for (const sym of fileSymbols) {
			const start = sym.start_line ?? 0;
			const end = sym.end_line ?? start;
			if (ref.caller_line < start || ref.caller_line > end) continue;
			if (innermost && !isNarrower(sym, innermost)) continue;
			innermost = sym;
		}
	}
	if (innermost) return innermost;

	// Nothing contains the line (module-scope import above the first symbol):
	// anchor at the first top-level symbol of the caller file.
	let topLevel: CodebaseSymbol | undefined;
	for (const sym of fileSymbols) {
		if (sym.parent_symbol_id !== null) continue;
		if (topLevel && !isEarlier(sym, topLevel)) continue;
		topLevel = sym;
	}
	if (topLevel) return topLevel;
	// Defensive: file has symbols but none top-level — first in file order.
	return fileSymbols[0];
}

/** True when `a` is a strictly "narrower" (innermost) span than `b`; ties by earlier start, then id. */
function isNarrower(a: CodebaseSymbol, b: CodebaseSymbol): boolean {
	const aStart = a.start_line ?? 0;
	const bStart = b.start_line ?? 0;
	const aWidth = (a.end_line ?? aStart) - aStart;
	const bWidth = (b.end_line ?? bStart) - bStart;
	if (aWidth !== bWidth) return aWidth < bWidth;
	if (aStart !== bStart) return aStart < bStart;
	return a.id < b.id;
}

/** True when `a` precedes `b` in file order (start_line, start_col); ties by id. */
function isEarlier(a: CodebaseSymbol, b: CodebaseSymbol): boolean {
	if ((a.start_line ?? 0) !== (b.start_line ?? 0)) return (a.start_line ?? 0) < (b.start_line ?? 0);
	if ((a.start_col ?? 0) !== (b.start_col ?? 0)) return (a.start_col ?? 0) < (b.start_col ?? 0);
	return a.id < b.id;
}

/** Validate the `kind` query param; absent → all edge families. */
function normalizeGraphKind(raw: string | undefined): CodeGraphKind | undefined {
	if (raw === undefined || raw.trim() === "") return undefined;
	const k = raw.trim().toLowerCase();
	if ((CODE_GRAPH_KINDS as readonly string[]).includes(k)) return k as CodeGraphKind;
	throw new ServiceError(400, `kind must be one of: ${CODE_GRAPH_KINDS.join(", ")}`, "INVALID_GRAPH_KIND");
}

/** Clamp the `limit` (node count) param to [default, CODE_GRAPH_MAX_NODES]. */
function parseNodeLimit(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") return CODE_GRAPH_DEFAULT_NODE_LIMIT;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0) return CODE_GRAPH_DEFAULT_NODE_LIMIT;
	return Math.min(n, CODE_GRAPH_MAX_NODES);
}
