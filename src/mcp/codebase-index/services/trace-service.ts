/**
 * TraceService — traces a symbol's definition and usage across the codebase.
 *
 * Phase 1.0: name-based exact matching. Pure in-memory function — no DB dependencies.
 * Accepts a CodebaseSymbol array and returns definition location, export status,
 * and optionally references from other symbols' doc_comments.
 */

import type { CodebaseSymbol } from "../../types";
import type { CodebaseReference, RelatedTypesResult, PackedContextResult } from "../../types";

// ── Public types ────────────────────────────────────────────────────────

export interface TraceResult {
	symbol: CodebaseSymbol;
	definition: {
		file: string;
		line: number;
		column: number;
		endLine: number;
		endColumn: number;
	};
	references: TraceReference[];
	exportChain: {
		exported: boolean;
		defaultExport: boolean;
	};
	/**
	 * Enclosing container (e.g. class → method), resolved from the same-file
	 * parent_symbol_id link populated at index time (TASK-300). Null for
	 * top-level symbols or when the parent row is absent.
	 */
	parent: {
		id: string;
		name: string;
		kind: string;
		filePath: string;
		line: number | null;
	} | null;
	/** Direct children (e.g. a class's methods/properties), ordered by start line. */
	children: CodebaseSymbol[];
	disambiguation?: CodebaseSymbol[];
	/**
	 * Public export / re-export chain (issue #87, TASK-013): the `export { X }`
	 * / `export * from` edges whose resolved target is THIS symbol — i.e. every
	 * module that publicly re-exports it. Empty for symbols with no re-exporters.
	 */
	reexportChain: ReexportChainEntry[];
}

/**
 * One entry in a symbol's public re-export chain (issue #87): a module that
 * re-exports the traced symbol via `export { X } from './mod'` /
 * `export { X as Y } from './mod'` / `export * from './mod'`.
 */
export interface ReexportChainEntry {
	/** File that re-exports the symbol. */
	filePath: string;
	/** 1-based line of the re-export statement. */
	startLine: number | null;
	/** Local alias (`DomainUser` of `export { User as DomainUser }`); null when none. */
	aliasName: string | null;
	/** Canonical exported name as written in the re-exporting module. */
	canonicalName: string | null;
	/** Raw module specifier of the re-export (`'./domain/user'`). */
	moduleSpecifier: string | null;
	/** 'named' | 'wildcard' (v27, issue #83/#87); null for non re-export rows. */
	importKind: string | null;
}

export interface TraceReference {
	filePath: string;
	startLine: number;
	startCol: number;
	endLine: number;
	endCol: number;
	context: string;
	/**
	 * 'call' | 'instantiation' | 'import' | 'extends' | 'implements' | 'type' —
	 * present for table-backed references (TASK-236 / #64; heritage kinds added
	 * by Phase 1.1 / TASK-299; 'type' by TASK-008 / issue #82).
	 */
	kind?: string;
	/** Enclosing function/method at the call / heritage site, when determinable. */
	callerName?: string | null;
	/** File path of the referenced symbol when resolvable (table-backed, v23). */
	targetFile?: string | null;
	/** codebase_symbols(id) of the referenced symbol when resolvable (table-backed, v23). */
	targetSymbolId?: string | null;
	/** Relation role of a 'type' edge (v26, issue #82): parameter/return/property/… Null otherwise. */
	role?: string | null;
	/** Local binding name of an 'import' edge (v27, issue #83); absent for other kinds. */
	localName?: string | null;
	/** Exported name as written in the module for an 'import' edge (v27, issue #83). */
	importedName?: string | null;
	/** Raw module specifier of an 'import' edge (v27, issue #83), e.g. `'@/domain/user'`. */
	moduleSpecifier?: string | null;
	/** 'default' | 'named' | 'namespace' | 'side-effect' (v27, issue #83); absent for other kinds. */
	importKind?: string | null;
}

// ── Related-types graph traversal (issue #84) ─────────────────────────────

/**
 * Hop bound for a single BFS level during related-types traversal.
 *
 * Each step multiplies the frontier by the fan-out of the previous level, so
 * an unbounded graph walk could blow up on a wide type surface (a DTO with
 * dozens of properties, each with generic arguments). 200 per level is far
 * beyond any realistic type-graph breadth while still bounding worst-case
 * memory/time deterministically.
 */
const MAX_TYPE_EDGES_PER_LEVEL = 200;

/**
 * Traverse 'type' reference edges (issue #82 / migration v26) from a root
 * symbol and return the deduplicated related-type subgraph (issue #84).
 *
 * The root's OWN type edges are the edges whose reference row sits in the
 * root's file (`caller_file` = root's definition file, `caller_name` =
 * root's name) — exactly the rows emitted by the TS type-edge emitter for the
 * root declaration's parameter/return/property/alias/generic/constraint/
 * union/intersection surface. Each deeper level repeats the walk from the
 * related symbols found so far.
 *
 * Resolution order per hop (ADR-002 name-based model, prefer structural):
 *   1. `target_symbol_id` — the parse-time-resolved row directly names the
 *      indexed symbol (canonical, cross-file safe).
 *   2. name-based fallback within the root symbol's own file, then repo-wide
 *      exact-name match, deduped to the first deterministically-ordered row.
 *   3. Any other fallback is skipped and counted in `skippedUnresolved` —
 *      an unresolved target never fails the whole traversal.
 *
 * Cycle-safe + deduplicated: BFS with a visited set keyed on the target
 * symbol id. A symbol already reached is never expanded again and its
 * shallowest-depth occurrence is the one reported, so repeated targets
 * collapse to a single edge carrying the first-seen relation metadata.
 *
 * @param root          the traced symbol (definition row).
 * @param repo          repo scope (may be undefined for unscoped traces).
 * @param symbols       ALL symbols loaded by the caller (repo-scoped when
 *                      `repo` is set) — provides id/name/file/kind lookups.
 * @param references    the repo's 'type' reference rows (caller filters by
 *                      kind for efficiency).
 * @param maxDepth      1..4 — BFS hop limit from the root.
 */
export function collectRelatedTypes(
	root: CodebaseSymbol,
	repo: string | undefined,
	symbols: CodebaseSymbol[],
	references: CodebaseReference[],
	maxDepth: number
): RelatedTypesResult {
	const edges: RelatedTypesResult["edges"] = [];
	let skippedUnresolved = 0;

	const symbolsById = new Map<string, CodebaseSymbol>();
	for (const s of symbols) symbolsById.set(s.id, s);

	// Root file index for the same-file name fallback; repo-wide fallback uses
	// the full `symbols` array. The file index is derived from the repo-scoped
	// `symbols`, so it never leaks cross-repo rows.
	const symbolsByFile = new Map<string, CodebaseSymbol[]>();
	for (const s of symbols) {
		const arr = symbolsByFile.get(s.file_path) ?? [];
		arr.push(s);
		symbolsByFile.set(s.file_path, arr);
	}

	// BFS bookkeeping. `reported` keys on the target symbol id — a symbol is
	// reported once, at its shallowest depth. `expanded` keys on the SOURCE
	// symbol id so a repeated source never re-walks its edges. The root is
	// pre-registered as reported so a cycle folding back to the root (A → B →
	// A) never re-emits the root as a related type.
	const reported = new Set<string>([root.id]);
	const expanded = new Set<string>();

	// Seed the frontier with the root's own type edges.
	const rootRefs = typeEdgesOf(root, references);
	let frontier: Array<{ symbolId: string; depth: number }> = [];
	for (const ref of rootRefs) {
		const resolved = resolveTypeTarget(ref, root, repo, symbols, symbolsById, symbolsByFile);
		if (!resolved) {
			skippedUnresolved++;
			continue;
		}
		const key = resolved.symbol.id;
		if (reported.has(key)) continue;
		reported.add(key);
		edges.push({
			targetSymbolId: key,
			targetName: resolved.symbol.name,
			targetFile: resolved.symbol.file_path,
			targetKind: resolved.symbol.kind,
			role: ref.role ?? null,
			depth: 1,
			fromName: root.name,
			fromSymbolId: root.id,
			line: ref.caller_line ?? null
		});
		frontier.push({ symbolId: key, depth: 1 });
	}
	expanded.add(root.id);

	// BFS through the related types. `depth` is the hop distance from the
	// root; level N expands the symbols first reached at depth N.
	for (let depth = 2; depth <= maxDepth; depth++) {
		const next: Array<{ symbolId: string; depth: number }> = [];
		let levelBreadth = 0;
		for (const current of frontier) {
			if (expanded.has(current.symbolId)) continue;
			expanded.add(current.symbolId);
			const symbol = symbolsById.get(current.symbolId);
			if (!symbol) continue;
			const refs = typeEdgesOf(symbol, references);
			for (const ref of refs) {
				if (levelBreadth >= MAX_TYPE_EDGES_PER_LEVEL) break;
				const resolved = resolveTypeTarget(ref, symbol, repo, symbols, symbolsById, symbolsByFile);
				if (!resolved) {
					skippedUnresolved++;
					continue;
				}
				const key = resolved.symbol.id;
				levelBreadth++;
				// Repeated target: already reported (or the root itself) — skip
				// without re-expanding; the shallowest-depth edge is the record.
				if (reported.has(key)) continue;
				reported.add(key);
				edges.push({
					targetSymbolId: key,
					targetName: resolved.symbol.name,
					targetFile: resolved.symbol.file_path,
					targetKind: resolved.symbol.kind,
					role: ref.role ?? null,
					depth,
					fromName: symbol.name,
					fromSymbolId: current.symbolId,
					line: ref.caller_line ?? null
				});
				next.push({ symbolId: key, depth });
			}
			if (levelBreadth >= MAX_TYPE_EDGES_PER_LEVEL) break;
		}
		frontier = next;
		if (frontier.length === 0) break;
	}

	return { edges, skippedUnresolved };
}

/**
 * All 'type' reference rows whose caller site is the given symbol: rows whose
 * `caller_file` is the symbol's definition file AND whose `caller_name` is the
 * symbol's name (the TS type-edge emitter tags function/method/field type
 * surfaces with the declaration's name; class/interface/alias type surfaces
 * emit `caller_name` null). Rows in the same file with a DIFFERENT
 * `caller_name` belong to sibling symbols and are excluded.
 */
function typeEdgesOf(symbol: CodebaseSymbol, references: CodebaseReference[]): CodebaseReference[] {
	return references.filter(
		(r) => r.kind === "type" && r.caller_file === symbol.file_path && (r.caller_name ?? null) === (symbol.name ?? null)
	);
}

/**
 * Resolve a 'type' reference row to its indexed target symbol.
 *
 * Preference order:
 *   1. `target_symbol_id` → direct id lookup (canonical, cross-file safe).
 *   2. Same-file exact-name match — the type is declared alongside the caller
 *      (the overwhelmingly common case for DTOs/interfaces in one module).
 *   3. Repo-wide exact-name match (first row in deterministic file/line
 *      order). Name-based per ADR-002; a same-name collision in another file
 *      may mis-resolve, exactly as reference aggregation does today.
 *
 * Returns null when none of the three resolve — the caller skips the hop
 * (unresolved targets never fail the traversal).
 */
function resolveTypeTarget(
	ref: CodebaseReference,
	caller: CodebaseSymbol,
	_repo: string | undefined,
	symbols: CodebaseSymbol[],
	symbolsById: Map<string, CodebaseSymbol>,
	symbolsByFile: Map<string, CodebaseSymbol[]>
): { symbol: CodebaseSymbol } | null {
	if (ref.target_symbol_id) {
		const byId = symbolsById.get(ref.target_symbol_id);
		if (byId) return { symbol: byId };
	}
	if (ref.target_file) {
		const sameFile = (symbolsByFile.get(ref.target_file) ?? []).find((s) => s.name === ref.symbol_name);
		if (sameFile) return { symbol: sameFile };
	}
	const byName = symbols.find((s) => s.name === ref.symbol_name);
	if (byName) return { symbol: byName };
	return null;
}

// ── Token-budgeted context packing (issue #85) ──────────────────────────

/**
 * Hop bound for a single BFS level during context packing.
 *
 * Mirrors the related-types traversal bound: each level multiplies the
 * frontier by the fan-out of the previous one, so an unbounded walk could blow
 * up on a wide graph. 400 per level keeps the packer deterministic in time and
 * memory even on dense graphs while staying far beyond realistic breadth.
 */
const MAX_PACK_EDGES_PER_LEVEL = 400;

/**
 * Edge kind → packing tier (issue #85). Type edges are always worth more than
 * call/instantiation edges, which in turn outrank import-only edges — the
 * tier ranking is graph-backed (the kind/role taxonomy is emitted at parse
 * time), never a regex/name heuristic.
 */
const EDGE_KIND_TIER: Record<string, 2 | 3 | 4 | 5> = {
	type: 2,
	extends: 4,
	implements: 4,
	call: 4,
	instantiation: 4,
	import: 5
};

/** Edge kinds that carry a high-confidence structural relationship. */
const STRUCTURAL_EDGE_KINDS = new Set(["type", "extends", "implements", "call", "instantiation"]);

/** Packing tier numeric order — ascending value, packed in this order. */
const TIER_ORDER = [1, 2, 3, 4, 5] as const;

type ContextPackTierLabel = "root" | "api" | "direct" | "calls" | "imports";

const TIER_LABELS: ContextPackTierLabel[] = ["root", "api", "direct", "calls", "imports"];

function emptyTierStats(): { includedSymbols: number; excludedSymbols: number; includedEdges: number } {
	return { includedSymbols: 0, excludedSymbols: 0, includedEdges: 0 };
}

/**
 * Estimate the token cost of rendering one symbol's pack entry.
 *
 * Count-based deterministic heuristic (documented tolerance: ±50% vs a real
 * tokenizer for typical identifiers — an average token is ~4 characters plus
 * one structural token per field). The estimate grows with the symbol's
 * signature/doc comment size, so larger declarations cost proportionally more.
 */
export function estimateSymbolTokens(symbol: CodebaseSymbol): number {
	const name = symbol.name ?? "";
	const signature = symbol.signature ?? "";
	const doc = symbol.doc_comment ?? "";
	// ~4 chars/token on average (GPT-style heuristic); 1 token of structural
	// overhead per field, plus the definition-location line.
	return Math.max(4, Math.round((name.length + signature.length + Math.min(doc.length, 400)) / 4) + 3);
}

/**
 * Pack a token-budgeted, tier-ranked context graph around a root symbol
 * (issue #85).
 *
 * Graph-backed ranking: every candidate symbol/edge is discovered through the
 * reference-edge graph (the same `codebase_references` rows #82/#84 consume),
 * never through name/regex heuristics. The traversal is a BFS whose priority
 * is the packing TIER of each candidate:
 *
 *   tier 1 (root)   — the traced symbol itself (always included).
 *   tier 2 (api)    — the root's OWN type surface: parameter / return /
 *                     property / alias / generic / constraint edges.
 *   tier 3 (direct) — transitive type-dependency closure of every packed
 *                     symbol (BFS hop order, shallowest first).
 *   tier 4 (calls)  — high-confidence call / instantiation / heritage
 *                     (extends/implements) relationships from packed symbols.
 *   tier 5 (imports)— lower-value import-only relationships.
 *
 * Within a tier, deterministic tiebreaks produce a stable order for the same
 * index state + inputs: structural edges first (then by kind, then by
 * caller_file, caller_line, symbol_name), and symbols by (depth, name, id).
 * Because a symbol's packed tier is its HIGHEST (numerically lowest) tier and
 * its depth is its SHALLOWEST hop, cycles and duplicate graph paths collapse
 * to one entry — they can never duplicate context.
 *
 * Token accounting is additive per symbol (see `estimateSymbolTokens`); when
 * the next candidate would exceed the budget, it and every remaining candidate
 * are excluded (a partially-packed tier is cut at a symbol boundary, so the
 * pack is always deterministic). The root is ALWAYS included even when its own
 * estimate exceeds the budget — bounded context is never an empty context.
 *
 * @param root          the traced symbol (definition row).
 * @param repo          repo scope (may be undefined for unscoped traces).
 * @param symbols       ALL symbols loaded by the caller (repo-scoped when
 *                      `repo` is set) — provides id/name/file/kind lookups.
 * @param references    the repo's reference rows (type + call/import/heritage)
 *                      for the pack; the caller preloads them scoped to repo.
 * @param budget        token budget (256..10000).
 * @param maxDepth      1..4 — BFS hop limit from the root for the whole pack
 *                      (mirrors `relationDepth`; default 1 = root + direct deps).
 */
export function packContext(
	root: CodebaseSymbol,
	repo: string | undefined,
	symbols: CodebaseSymbol[],
	references: CodebaseReference[],
	budget: number,
	maxDepth: number
): PackedContextResult {
	const items: PackedContextResult["items"] = [];
	const edges: PackedContextResult["edges"] = [];
	const tiers: Record<
		ContextPackTierLabel,
		{ includedSymbols: number; excludedSymbols: number; includedEdges: number }
	> = {
		root: emptyTierStats(),
		api: emptyTierStats(),
		direct: emptyTierStats(),
		calls: emptyTierStats(),
		imports: emptyTierStats()
	};
	let skippedUnresolved = 0;
	let totalEdges = 0;

	const symbolsById = new Map<string, CodebaseSymbol>();
	for (const s of symbols) symbolsById.set(s.id, s);

	const symbolsByFile = new Map<string, CodebaseSymbol[]>();
	for (const s of symbols) {
		const arr = symbolsByFile.get(s.file_path) ?? [];
		arr.push(s);
		symbolsByFile.set(s.file_path, arr);
	}

	// Outgoing edge index keyed on the SOURCE symbol id (per-row deterministic
	// order preserved: caller_file, caller_line, symbol_name).
	const outgoing = new Map<string, CodebaseReference[]>();
	for (const r of references) {
		const sourceId = r.caller_name ? sourceSymbolIdForCaller(r, symbolsById, symbolsByFile) : null;
		if (sourceId) {
			const arr = outgoing.get(sourceId) ?? [];
			arr.push(r);
			outgoing.set(sourceId, arr);
		}
		// Unresolvable sources (no caller name / no matching symbol) are
		// counted and skipped — they never fail the pack.
		skippedUnresolved++;
	}

	// Dedup keys. `packedSymbols` keys on the target symbol id — a symbol is
	// packed ONCE, at its highest tier and shallowest depth. `includedEdges`
	// keys on (kind, fromSymbolId, toSymbolId) so a duplicate graph path (same
	// relationship via a different route) is emitted once.
	const packedSymbols = new Set<string>([root.id]);
	const includedEdges = new Set<string>();

	let estimatedTokens = 0;
	let totalSymbols = 0;
	let capped = false;

	const packSymbol = (symbol: CodebaseSymbol, tier: ContextPackTierLabel, depth: number, edgeCount: number): void => {
		const cost = estimateSymbolTokens(symbol);
		estimatedTokens += cost;
		items.push({
			symbolId: symbol.id,
			name: symbol.name,
			kind: symbol.kind,
			file: symbol.file_path,
			line: symbol.start_line ?? null,
			tier,
			depth,
			edgeCount,
			estimatedTokens: cost
		});
		tiers[tier].includedSymbols++;
		packedSymbols.add(symbol.id);
	};

	// ── Tier 1: the root symbol (always included). ──
	packSymbol(root, "root", 0, 0);

	// ── Frontier: symbols discovered but not yet packed, grouped by the tier
	// ── that admits them. `tierBuckets[t]` holds {symbolId, fromId, depth}
	// ── candidates; admission happens tier-by-tier.
	const tierBuckets: Record<number, Array<{ symbolId: string; fromId: string; depth: number }>> = {
		2: [],
		3: [],
		4: [],
		5: []
	};

	const enqueueTarget = (targetId: string, fromId: string, depth: number, tier: number): void => {
		if (packedSymbols.has(targetId)) return;
		// Dedupe within the bucket on (targetId) keeping the first (highest
		// tier, shallowest depth) occurrence.
		const bucket = tierBuckets[tier];
		if (bucket.some((c) => c.symbolId === targetId)) return;
		bucket.push({ symbolId: targetId, fromId, depth });
	};

	// Walk one source symbol's outgoing edges: classify each edge by tier,
	// resolve its target, and enqueue it. Returns edges packed for the source.
	const expandSource = (source: CodebaseSymbol, depth: number): number => {
		const refs = outgoing.get(source.id) ?? [];
		const packed: Array<{
			kind: string;
			role: string | null;
			fromId: string;
			toId: string;
			line: number | null;
			file: string | null;
		}> = [];
		let levelBreadth = 0;

		// Deterministic edge order: structural kinds first, then by kind, then
		// by caller_file / caller_line / symbol_name (the row order already is
		// caller_file ASC, caller_line ASC, symbol_name ASC; a stable sort by
		// kind keeps structural edges ahead of imports without reordering ties).
		const ordered = refs
			.slice()
			.sort(
				(a, b) =>
					tierOfEdge(a) - tierOfEdge(b) ||
					(a.kind ?? "").localeCompare(b.kind ?? "") ||
					(a.caller_file ?? "").localeCompare(b.caller_file ?? "") ||
					(a.caller_line ?? 0) - (b.caller_line ?? 0) ||
					a.symbol_name.localeCompare(b.symbol_name)
			);

		for (const ref of ordered) {
			if (levelBreadth >= MAX_PACK_EDGES_PER_LEVEL) break;
			totalEdges++;
			const resolved = resolveTarget(ref, source, repo, symbols, symbolsById, symbolsByFile);
			if (!resolved) {
				skippedUnresolved++;
				continue;
			}
			levelBreadth++;
			const edgeKey = `${ref.kind}|${source.id}|${resolved.symbol.id}`;
			const includeEdge = !includedEdges.has(edgeKey) && !packedSymbols.has(resolved.symbol.id);
			if (includeEdge) {
				includedEdges.add(edgeKey);
				const edgeTier = tierOfEdge(ref);
				tiers[TIER_LABELS[edgeTier - 1]].includedEdges++;
				packed.push({
					kind: ref.kind,
					role: ref.role ?? null,
					fromId: source.id,
					toId: resolved.symbol.id,
					line: ref.caller_line ?? null,
					file: ref.caller_file ?? null
				});
			}

			if (packedSymbols.has(resolved.symbol.id)) continue;
			enqueueTarget(resolved.symbol.id, source.id, depth + 1, tierOfEdge(ref));
		}

		// Deduplicate the packed edge set (same edge key already deduped, but
		// keep this defensive pass for determinism).
		const unique: typeof packed = [];
		const seen = new Set<string>();
		for (const e of packed) {
			const key = `${e.kind}|${e.fromId}|${e.toId}`;
			if (seen.has(key)) continue;
			seen.add(key);
			unique.push(e);
		}
		return unique.length;
	};

	// ── Admission loop: expand sources BFS, tier by tier, until the budget ──
	// ── is exhausted or no candidates remain.                        ──
	const remaining = { budget };
	let frontier: Array<{ symbolId: string; depth: number }> = [{ symbolId: root.id, depth: 0 }];
	const expanded = new Set<string>();

	for (let depth = 1; depth <= maxDepth; depth++) {
		// First, admit the pending candidates of the current depth into the
		// buckets (each source expands into buckets while we walk it). To keep
		// tier ordering strict, we expand ALL sources at this depth, then
		// admit buckets tier by tier.
		const nextFrontier: Array<{ symbolId: string; depth: number }> = [];

		for (const current of frontier) {
			if (expanded.has(current.symbolId)) continue;
			expanded.add(current.symbolId);
			const symbol = symbolsById.get(current.symbolId);
			if (!symbol) continue;
			expandSource(symbol, current.depth);
		}

		// Admit candidates tier by tier (2 → 3 → 4 → 5), each tier fully
		// before the next; a candidate admitted here may itself expand at a
		// later depth, but never before its tier is reached.
		for (const tier of TIER_ORDER) {
			const bucket = tierBuckets[tier];
			if (bucket.length === 0) continue;
			const admitted = bucket.splice(0);
			admitted.sort((a, b) => a.depth - b.depth || a.symbolId.localeCompare(b.symbolId));
			for (const cand of admitted) {
				if (packedSymbols.has(cand.symbolId)) continue;
				totalSymbols++;
				const symbol = symbolsById.get(cand.symbolId);
				if (!symbol) {
					skippedUnresolved++;
					continue;
				}
				const cost = estimateSymbolTokens(symbol);
				if (remaining.budget > 0 && estimatedTokens + cost > remaining.budget) {
					// Budget cut at a symbol boundary: exclude this candidate
					// and everything after it (deterministic cutoff).
					tiers[TIER_LABELS[tier - 1]].excludedSymbols++;
					capped = true;
					continue;
				}
				const edgeCount = countEdgesFor(symbol.id, includedEdges);
				packSymbol(symbol, TIER_LABELS[tier - 1], cand.depth, edgeCount);
				nextFrontier.push({ symbolId: cand.symbolId, depth: cand.depth });
				if (remaining.budget > 0 && estimatedTokens >= remaining.budget) {
					capped = true;
				}
			}
			if (capped) break;
		}
		if (capped) break;
		frontier = nextFrontier;
		if (frontier.length === 0) break;
	}

	// Any candidates still queued in the buckets were never reached — count
	// them as excluded (they were deduped against packed symbols, so this is
	// the true remainder).
	for (const tier of TIER_ORDER) {
		const bucket = tierBuckets[tier];
		const still = bucket.filter((c) => !packedSymbols.has(c.symbolId));
		if (still.length > 0) tiers[TIER_LABELS[tier - 1]].excludedSymbols += still.length;
		if (still.length > 0) capped = true;
	}

	// ── Flatten edges into the result (deduped, deterministic order). ──
	edges.push(...flattenEdges(edgesFromPacked(items, outgoing, packedSymbols)));

	return {
		items,
		edges,
		estimatedTokens,
		tiers,
		skippedUnresolved,
		totalSymbols,
		totalEdges,
		capped
	};
}

/**
 * Numeric tier of a reference edge (2 = type/API, 4 = calls/instantiation/
 * heritage, 5 = imports). Unknown kinds are treated as import-tier (lowest
 * value) so an unexpected kind can never outrank a known structural edge.
 */
function tierOfEdge(ref: CodebaseReference): number {
	return EDGE_KIND_TIER[ref.kind] ?? 5;
}

/**
 * Resolve a reference row to its indexed target symbol for packing. Type
 * edges use the same preference order as `resolveTypeTarget`; other kinds use
 * the same id → same-file → repo-wide name fallback chain so calls/imports
 * resolve uniformly. Returns null when none resolve (skipped, never fatal).
 */
function resolveTarget(
	ref: CodebaseReference,
	caller: CodebaseSymbol,
	repo: string | undefined,
	symbols: CodebaseSymbol[],
	symbolsById: Map<string, CodebaseSymbol>,
	symbolsByFile: Map<string, CodebaseSymbol[]>
): { symbol: CodebaseSymbol } | null {
	return resolveTypeTarget(ref, caller, repo, symbols, symbolsById, symbolsByFile);
}

/**
 * Source symbol id for a reference row: `caller_name` + `caller_file` locate
 * the caller symbol (same-file name match). Rows with a null caller_name
 * (top-level heritage/import edges) or an unresolvable caller are skipped.
 */
function sourceSymbolIdForCaller(
	ref: CodebaseReference,
	symbolsById: Map<string, CodebaseSymbol>,
	symbolsByFile: Map<string, CodebaseSymbol[]>
): string | null {
	if (!ref.caller_name || !ref.caller_file) return null;
	const sameFile = (symbolsByFile.get(ref.caller_file) ?? []).find((s) => s.name === ref.caller_name);
	return sameFile?.id ?? null;
}

/**
 * Count the currently included edges whose source is `symbolId` — the
 * per-symbol edgeCount reported in PackedContextItem.
 */
function countEdgesFor(symbolId: string, includedEdges: Set<string>): number {
	let count = 0;
	for (const key of includedEdges) {
		if (key.startsWith(`${symbolId}|`) || key.endsWith(`|${symbolId}`)) count++;
	}
	return count;
}

/**
 * Rebuild the final edge list from the packed symbols: every outgoing edge of
 * every packed symbol whose target is also packed, deduplicated by
 * (kind, from, to) and sorted deterministically (structural kinds first, then
 * by kind / file / line / target name).
 */
function edgesFromPacked(
	items: PackedContextResult["items"],
	outgoing: Map<string, CodebaseReference[]>,
	packedSymbols: Set<string>
): Array<{
	kind: string;
	role: string | null;
	fromSymbolId: string;
	toSymbolId: string;
	line: number | null;
	file: string | null;
}> {
	const result: Array<{
		kind: string;
		role: string | null;
		fromSymbolId: string;
		toSymbolId: string;
		line: number | null;
		file: string | null;
	}> = [];
	const seen = new Set<string>();
	for (const item of items) {
		const refs = outgoing.get(item.symbolId) ?? [];
		for (const ref of refs) {
			if (STRUCTURAL_EDGE_KINDS.has(ref.kind)) continue;
			const targetId = ref.target_symbol_id;
			if (!targetId || !packedSymbols.has(targetId)) continue;
			const key = `${ref.kind}|${item.symbolId}|${targetId}`;
			if (seen.has(key)) continue;
			seen.add(key);
			result.push({
				kind: ref.kind,
				role: ref.role ?? null,
				fromSymbolId: item.symbolId,
				toSymbolId: targetId,
				line: ref.caller_line ?? null,
				file: ref.caller_file ?? null
			});
		}
	}
	// Sort: structural edges first (by kind), then by kind / file / line / target.
	return result.sort(
		(a, b) =>
			(STRUCTURAL_EDGE_KINDS.has(a.kind) ? 0 : 1) - (STRUCTURAL_EDGE_KINDS.has(b.kind) ? 0 : 1) ||
			a.kind.localeCompare(b.kind) ||
			(a.file ?? "").localeCompare(b.file ?? "") ||
			(a.line ?? 0) - (b.line ?? 0) ||
			a.toSymbolId.localeCompare(b.toSymbolId)
	);
}

/**
 * Deduplicate an edge list by (kind, from, to) preserving first occurrence.
 */
function flattenEdges(
	edges: Array<{
		kind: string;
		role: string | null;
		fromSymbolId: string;
		toSymbolId: string;
		line: number | null;
		file: string | null;
	}>
): PackedContextResult["edges"] {
	const seen = new Set<string>();
	const out: PackedContextResult["edges"] = [];
	for (const e of edges) {
		const key = `${e.kind}|${e.fromSymbolId}|${e.toSymbolId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(e);
	}
	return out;
}

// ── Errors ──────────────────────────────────────────────────────────────

export class SymbolNotFoundError extends Error {
	constructor(name: string, repo?: string) {
		const suffix = repo ? ` in repo "${repo}"` : "";
		super(`Symbol "${name}" not found${suffix}`);
		this.name = "SymbolNotFoundError";
	}
}

export class AmbiguousSymbolError extends Error {
	public readonly disambiguation: CodebaseSymbol[];

	constructor(name: string, disambiguation: CodebaseSymbol[], repo?: string) {
		const suffix = repo ? ` in repo "${repo}"` : "";
		super(`Ambiguous symbol "${name}" — ${disambiguation.length} matches found${suffix}`);
		this.name = "AmbiguousSymbolError";
		this.disambiguation = disambiguation;
	}
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Trace a symbol by exact name match.
 *
 * 1. Find symbols with exact name match in the provided array.
 * 2. If multiple matches, throw AmbiguousSymbolError with all candidates.
 * 3. If single match, find its definition location and export status.
 * 4. If includeReferences, search other symbols' doc_comments and signatures for the name.
 *
 * @throws {SymbolNotFoundError} if no symbol matches the given name.
 * @throws {AmbiguousSymbolError} if multiple symbols match (disambiguation required).
 */
export function traceSymbol(
	name: string,
	repo: string | undefined,
	symbols: CodebaseSymbol[],
	includeReferences: boolean,
	storedReferences?: TraceReference[]
): TraceResult {
	// Step 1: Find exact name matches
	const matches = symbols.filter((s) => s.name === name);

	if (matches.length === 0) {
		throw new SymbolNotFoundError(name, repo);
	}

	// Step 2: Disambiguation for multiple matches
	if (matches.length > 1) {
		throw new AmbiguousSymbolError(name, matches, repo);
	}

	// Step 3: Single match — build result
	const symbol = matches[0];

	// Step 3b: hierarchy (TASK-300) — the parent is the same-file container
	// whose id equals symbol.parent_symbol_id (set at index time by the parse
	// pipeline); children are the symbols whose parent_symbol_id points at this
	// symbol. Both are resolved in-memory from the provided array, which TRACE
	// mode already loads in full (getSymbolsByRepo), so no extra queries.
	const parentSymbol = symbol.parent_symbol_id ? (symbols.find((s) => s.id === symbol.parent_symbol_id) ?? null) : null;
	const children = symbols
		.filter((s) => s.parent_symbol_id === symbol.id)
		.sort((a, b) => (a.start_line ?? 0) - (b.start_line ?? 0));

	const result: TraceResult = {
		symbol,
		definition: {
			file: symbol.file_path,
			line: symbol.start_line ?? 0,
			column: symbol.start_col ?? 0,
			endLine: symbol.end_line ?? 0,
			endColumn: symbol.end_col ?? 0
		},
		references: [],
		exportChain: {
			exported: symbol.exported,
			defaultExport: symbol.default_export
		},
		parent: parentSymbol
			? {
					id: parentSymbol.id,
					name: parentSymbol.name,
					kind: parentSymbol.kind,
					filePath: parentSymbol.file_path,
					line: parentSymbol.start_line
				}
			: null,
		children,
		reexportChain: includeReferences ? buildReexportChain(symbol, storedReferences ?? []) : []
	};

	// Step 4: Find references if requested. The table-backed references
	// (emitted by the parse visitors, TASK-236) are the primary precise source;
	// the in-memory doc_comment/signature scan is kept as the safety net when
	// the table has no stored refs for the symbol (e.g. pre-v21 index data or a
	// language without a reference-emitting visitor). When both exist they are
	// merged and deduped by call-site line.
	if (includeReferences) {
		const inMemory = findReferences(name, symbols, symbol.id);
		const stored = storedReferences ?? [];
		if (stored.length === 0) {
			result.references = inMemory;
		} else {
			result.references = mergeStoredAndInMemory(stored, inMemory);
		}
	}

	return result;
}

/**
 * Merge table-backed references with in-memory substring matches, deduping by
 * call-site (filePath, startLine) so the same site is never reported twice.
 * Stored references win on conflict (precise line > symbol-anchored context).
 */
function mergeStoredAndInMemory(stored: TraceReference[], inMemory: TraceReference[]): TraceReference[] {
	const seen = new Set<string>();
	const merged: TraceReference[] = [];
	for (const ref of stored) {
		const key = `${ref.filePath}:${ref.startLine}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(ref);
	}
	for (const ref of inMemory) {
		const key = `${ref.filePath}:${ref.startLine}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(ref);
	}
	return merged;
}

// ── Internal helpers ────────────────────────────────────────────────────

/**
 * Build a symbol's public re-export chain (issue #87, TASK-013) from the
 * stored `reexport` reference edges.
 *
 * A re-export edge "points at" the traced symbol when its resolved target is
 * this symbol — keyed on `target_symbol_id` (the canonical parse-time
 * resolution), with a name+file fallback (`symbol_name` === symbol name AND
 * `target_file` === symbol's definition file) for edges whose target_symbol_id
 * was unresolved at parse time. Each matching edge becomes one
 * {@link ReexportChainEntry} describing WHO re-exports this symbol and under
 * which (aliased) name. De-duplicated by (filePath, startLine).
 */
export function buildReexportChain(symbol: CodebaseSymbol, storedReferences: TraceReference[]): ReexportChainEntry[] {
	const matches = storedReferences.filter(
		(r) => r.kind === "reexport" && (r.targetSymbolId === symbol.id || r.targetFile === symbol.file_path)
	);
	const seen = new Set<string>();
	const out: ReexportChainEntry[] = [];
	for (const r of matches) {
		const key = `${r.filePath}:${r.startLine}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			filePath: r.filePath,
			startLine: r.startLine,
			aliasName: r.localName ?? null,
			canonicalName: r.importedName ?? null,
			moduleSpecifier: r.moduleSpecifier ?? null,
			importKind: r.importKind ?? null
		});
	}
	return out;
}

/**
 * Search other symbols for references to the given name.
 * Checks doc_comments and signatures for the name string.
 * Excludes the definition symbol itself by ID.
 */
function findReferences(name: string, symbols: CodebaseSymbol[], excludeId: string): TraceReference[] {
	const refs: TraceReference[] = [];
	const searchName = name;

	for (const sym of symbols) {
		if (sym.id === excludeId) continue;

		const docComment = sym.doc_comment ?? "";
		const signature = sym.signature ?? "";

		// Check doc_comment for the name
		if (docComment.includes(searchName)) {
			refs.push({
				filePath: sym.file_path,
				startLine: sym.start_line ?? 0,
				startCol: sym.start_col ?? 0,
				endLine: sym.end_line ?? 0,
				endCol: sym.end_col ?? 0,
				context: extractContext(docComment, searchName)
			});
			continue; // Don't double-add if also in signature
		}

		// Check signature for the name
		if (signature.includes(searchName)) {
			refs.push({
				filePath: sym.file_path,
				startLine: sym.start_line ?? 0,
				startCol: sym.start_col ?? 0,
				endLine: sym.end_line ?? 0,
				endCol: sym.end_col ?? 0,
				context: signature
			});
		}
	}

	return refs;
}

/**
 * Extract the line containing the search text, with the match as context.
 */
function extractContext(text: string, search: string): string {
	const lines = text.split("\n");
	for (const line of lines) {
		if (line.includes(search)) {
			return line.trim();
		}
	}
	// Fallback to first line
	return lines[0]?.trim() ?? "";
}
