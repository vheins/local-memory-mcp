/**
 * Duplicate-symbol analysis for the codebase-read DUPLICATES mode (FEAT-001).
 *
 * Two passes over the indexed symbols of ONE repo, both bounded:
 *
 * 1. EXACT pass — a hash map over the normalized body key
 *    (`kind + language + canonical tokens`, parameter list blanked). Cost is
 *    O(symbols); identical normalized bodies are reported first with
 *    similarity 1.0.
 * 2. NEAR pass — only for symbols that did not match exactly, and only inside
 *    candidate buckets (`kind` + `language` + comparable line-count band).
 *    Candidates come from an inverted index over every selective 3-token
 *    shingle (rare shingles first), so a pair is scored only when it shares
 *    structure; the total scored pairs are capped, keeping the pass bounded
 *    independent of repo size. Similarity is Jaccard over token-shingle sets.
 *
 * Caching (no schema change, no new dependency):
 * - Derived per-symbol bodies are cached by `symbol id + source_fingerprint`
 *   (the index's SHA-256 of the symbol's raw source range), so unchanged
 *   symbols are never re-tokenized.
 * - Whole-analysis results are cached by a key that includes a digest over
 *   every candidate's `id:source_fingerprint`. A re-indexed symbol changes its
 *   fingerprint, which changes the key — the cache can never serve a stale
 *   result for changed source. Both caches are bounded LRUs (see constants).
 *
 * Output is deterministic for the same index state: candidates are ordered by
 * (file_path, start_line), groups are sorted exact-first then by similarity,
 * kind, name, and file.
 */

import { createHash } from "node:crypto";
import type { DuplicateCandidateRow } from "../../types/codebase-symbol";
import {
	DUPLICATES_CACHE_MAX_ENTRIES,
	DUPLICATES_MAX_PAIRS,
	DUPLICATES_POSTING_CAP,
	DUPLICATES_SYMBOL_CACHE_MAX_ENTRIES
} from "../../utils/constants";
import { describeParamDiff, buildMergeHint, type ParamDiff } from "./duplicates-params";
import { normalizeSymbolBody, type NormalizedSymbolBody } from "./duplicates-normalize";

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** One member of a duplicate group, as returned to the caller. */
export interface DuplicateSymbolRef {
	name: string;
	file_path: string;
	start_line: number;
	end_line: number;
	signature: string | null;
	repo: string;
}

/** One duplicate group. `class` is `exact` (similarity 1) or `near`. */
export interface DuplicateGroup {
	kind: string;
	class: "exact" | "near";
	similarity: number;
	symbols: DuplicateSymbolRef[];
	params_diff: ParamDiff;
	merge_hint: string;
}

/** Counters describing what the analysis did (honesty + cache evidence). */
export interface DuplicateAnalysisSummary {
	/** Candidate symbols loaded from the index (after kind filtering). */
	symbols_scanned: number;
	/** Symbols whose body was long enough and readable (participated in comparison). */
	symbols_compared: number;
	/** Distinct files read from disk during this analysis (0 on a cache hit). */
	files_read: number;
	/** Near-pass pairs scored (Jaccard computed). */
	pairs_compared: number;
	/** Total groups found before the `limit` cut. */
	groups_total: number;
	exact_groups: number;
	near_groups: number;
	/** True when `limit` cut the returned group list. */
	groups_truncated: boolean;
	/** True when the near-pass pair cap was reached — near coverage is partial. */
	pairs_truncated: boolean;
	/** True when the whole-analysis result cache served this call. */
	cache_hit: boolean;
}

export interface DuplicateAnalysisResult {
	groups: DuplicateGroup[];
	summary: DuplicateAnalysisSummary;
}

export interface AnalyzeDuplicatesOptions {
	repo: string;
	/** Candidate rows (slim projection) ordered however the caller likes; output re-sorts. */
	symbols: DuplicateCandidateRow[];
	/** File language lookup (`codebase_files.language`); null when unknown. */
	languageByFile: (filePath: string) => string | null;
	/** Read one indexed file's content; null when unreadable (symbols are skipped). */
	readFile: (filePath: string) => Promise<string | null>;
	/** Near-pass minimum similarity in (0, 1]. */
	minSimilarity: number;
	/** Minimum symbol line span (`end_line - start_line + 1`) to participate. */
	minLines: number;
	/** Maximum groups returned. */
	limit: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHES (bounded, process-shared)
// ═══════════════════════════════════════════════════════════════════════════

interface DerivedSymbol extends NormalizedSymbolBody {
	symbol: DuplicateCandidateRow;
	language: string | null;
	lines: number;
}

/** Derived-body cache entry: keyed by symbol id + fingerprint (+ language). */
const derivedCache = new Map<string, DerivedSymbol>();
/** Whole-analysis result cache entry, keyed by repo + thresholds + fingerprint digest. */
const analysisCache = new Map<string, DuplicateAnalysisResult>();

function derivedCacheKey(symbol: DuplicateCandidateRow, language: string | null): string {
	return `${symbol.id}\u0000${symbol.source_fingerprint ?? ""}\u0000${language ?? ""}`;
}

/** Insert into a bounded LRU map, evicting the oldest entry past `cap`. */
function lruSet<V>(map: Map<string, V>, key: string, value: V, cap: number): void {
	map.delete(key);
	map.set(key, value);
	while (map.size > cap) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

/**
 * Digest over every candidate's `id:source_fingerprint` (sorted by id), so an
 * analysis cache key changes exactly when the indexed source of a candidate
 * changes.
 */
export function fingerprintDigest(symbols: DuplicateCandidateRow[]): string {
	const hash = createHash("sha256");
	const rows = [...symbols].sort((a, b) => a.id.localeCompare(b.id));
	for (const row of rows) hash.update(`${row.id}:${row.source_fingerprint ?? ""}\n`);
	return hash.digest("hex");
}

/** Build the whole-analysis cache key. */
export function buildAnalysisCacheKey(
	repo: string,
	symbols: DuplicateCandidateRow[],
	minSimilarity: number,
	minLines: number,
	limit: number
): string {
	return `${repo}|${minSimilarity}|${minLines}|${limit}|${fingerprintDigest(symbols)}`;
}

/** Clear both caches (tests / operations). */
export function clearDuplicatesCaches(): void {
	derivedCache.clear();
	analysisCache.clear();
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Jaccard similarity of two sorted unique shingle arrays. */
function jaccard(a: number[], b: number[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	let i = 0;
	let j = 0;
	let shared = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			shared++;
			i++;
			j++;
		} else if (a[i] < b[j]) {
			i++;
		} else {
			j++;
		}
	}
	return shared / (a.length + b.length - shared);
}

/** Line-count band: same band ⇒ comparable size. Keeps pairs within ~2x. */
function lineBand(lines: number): number {
	return Math.floor(Math.log2(Math.max(1, lines)));
}

/** Round to 4 decimals so the reported score is stable across float noise. */
function round4(value: number): number {
	return Math.round(value * 10000) / 10000;
}

function symbolRef(symbol: DuplicateCandidateRow, repo: string): DuplicateSymbolRef {
	return {
		name: symbol.name,
		file_path: symbol.file_path,
		start_line: symbol.start_line ?? 0,
		end_line: symbol.end_line ?? 0,
		signature: symbol.signature,
		repo
	};
}

/** Order symbol refs deterministically (file path, then start line, then name). */
function compareRefs(a: DuplicateSymbolRef, b: DuplicateSymbolRef): number {
	return a.file_path.localeCompare(b.file_path) || a.start_line - b.start_line || a.name.localeCompare(b.name);
}

/** Build a group from its members (sorted) + score. */
function buildGroup(
	members: DerivedSymbol[],
	groupClass: "exact" | "near",
	similarity: number,
	repo: string
): DuplicateGroup {
	// Sort members first so `params_diff.param_sets` stays aligned with `symbols`.
	const ordered = [...members].sort((a, b) => compareRefs(symbolRef(a.symbol, repo), symbolRef(b.symbol, repo)));
	const symbols = ordered.map((member) => symbolRef(member.symbol, repo));
	const paramsDiff = describeParamDiff(ordered.map((member) => member.paramNames));
	return {
		kind: ordered[0].symbol.kind,
		class: groupClass,
		similarity: round4(similarity),
		symbols,
		params_diff: paramsDiff,
		merge_hint: buildMergeHint(ordered[0].symbol.kind, groupClass, round4(similarity), paramsDiff)
	};
}

/** Compare groups for output: exact first, then similarity desc, then kind/name/file. */
function compareGroups(a: DuplicateGroup, b: DuplicateGroup): number {
	if (a.class !== b.class) return a.class === "exact" ? -1 : 1;
	if (a.similarity !== b.similarity) return b.similarity - a.similarity;
	const ak = `${a.kind}\u0000${a.symbols[0].name}\u0000${a.symbols[0].file_path}`;
	const bk = `${b.kind}\u0000${b.symbols[0].name}\u0000${b.symbols[0].file_path}`;
	return ak.localeCompare(bk);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze one repo's indexed symbols for duplicated bodies.
 *
 * Exact-normalized duplicates are always reported first (similarity 1.0).
 * Near duplicates are reported second, above `minSimilarity`, with a merge
 * hint derived from the parameter-list difference.
 *
 * @param options Candidate symbols, a file reader, and the analysis thresholds.
 */
export async function analyzeDuplicates(options: AnalyzeDuplicatesOptions): Promise<DuplicateAnalysisResult> {
	const { repo, symbols, languageByFile, readFile, minSimilarity, minLines, limit } = options;

	const candidates = symbols.filter(
		(symbol) =>
			typeof symbol.start_line === "number" &&
			typeof symbol.end_line === "number" &&
			symbol.end_line >= symbol.start_line &&
			symbol.end_line - symbol.start_line + 1 >= minLines
	);

	const cacheKey = buildAnalysisCacheKey(repo, candidates, minSimilarity, minLines, limit);
	const cached = analysisCache.get(cacheKey);
	if (cached) {
		lruSet(analysisCache, cacheKey, cached, DUPLICATES_CACHE_MAX_ENTRIES);
		// This call read no files; the cached counters describe the run that
		// produced the groups. `cache_hit` makes the distinction explicit.
		return { groups: cached.groups, summary: { ...cached.summary, files_read: 0, cache_hit: true } };
	}

	// ── Extract derived bodies, one file at a time (bounded peak memory) ──
	const byFile = new Map<string, DuplicateCandidateRow[]>();
	for (const symbol of candidates) {
		const list = byFile.get(symbol.file_path);
		if (list) list.push(symbol);
		else byFile.set(symbol.file_path, [symbol]);
	}

	const derived: DerivedSymbol[] = [];
	let filesRead = 0;
	for (const [filePath, fileSymbols] of byFile) {
		const language = languageByFile(filePath);
		const missing = fileSymbols.filter((symbol) => !derivedCache.has(derivedCacheKey(symbol, language)));
		if (missing.length > 0) {
			const content = await readFile(filePath);
			if (content === null) continue;
			filesRead++;
			const lines = content.split(/\r?\n/);
			for (const symbol of missing) {
				const startLine = symbol.start_line as number;
				const endLine = Math.min(symbol.end_line as number, lines.length);
				if (startLine > lines.length || endLine < startLine) continue;
				const source = lines.slice(startLine - 1, endLine).join("\n");
				const body = normalizeSymbolBody(source, language, symbol.signature);
				const entry: DerivedSymbol = {
					...body,
					symbol,
					language,
					lines: symbol.end_line! - symbol.start_line! + 1
				};
				lruSet(derivedCache, derivedCacheKey(symbol, language), entry, DUPLICATES_SYMBOL_CACHE_MAX_ENTRIES);
			}
		}
		for (const symbol of fileSymbols) {
			const entry = derivedCache.get(derivedCacheKey(symbol, language));
			if (entry) derived.push(entry);
		}
	}

	// ── Pass 1: exact-normalized grouping (O(n) hash map) ──
	const exactBuckets = new Map<string, DerivedSymbol[]>();
	for (const entry of derived) {
		if (entry.canonicalTokens.length < 4) continue;
		const key = `${entry.symbol.kind}\u0000${entry.language ?? ""}\u0000${entry.canonicalTokens.join(" ")}`;
		const bucket = exactBuckets.get(key);
		if (bucket) bucket.push(entry);
		else exactBuckets.set(key, [entry]);
	}

	const exactGroups: DuplicateGroup[] = [];
	const exactMemberIds = new Set<string>();
	for (const bucket of exactBuckets.values()) {
		if (bucket.length < 2) continue;
		for (const member of bucket) exactMemberIds.add(member.symbol.id);
		exactGroups.push(buildGroup(bucket, "exact", 1, repo));
	}

	// ── Pass 2: near grouping inside kind + language + line-band buckets ──
	const nearBuckets = new Map<string, DerivedSymbol[]>();
	for (const entry of derived) {
		if (exactMemberIds.has(entry.symbol.id)) continue;
		if (entry.shingles.length === 0) continue;
		const bucketKey = `${entry.symbol.kind}\u0000${entry.language ?? ""}\u0000${lineBand(entry.lines)}`;
		const bucket = nearBuckets.get(bucketKey);
		if (bucket) bucket.push(entry);
		else nearBuckets.set(bucketKey, [entry]);
	}

	const scoredPairs = new Set<string>();
	const nearGroups: DuplicateGroup[] = [];
	let pairsCompared = 0;
	let pairsTruncated = false;

	for (const bucket of nearBuckets.values()) {
		if (pairsCompared >= DUPLICATES_MAX_PAIRS) {
			pairsTruncated = true;
			break;
		}
		if (bucket.length < 2) continue;

		// Document frequency of each shingle inside the bucket.
		const df = new Map<number, number>();
		for (const entry of bucket) {
			for (const shingle of entry.shingles) df.set(shingle, (df.get(shingle) ?? 0) + 1);
		}

		// Inverted index over every shingle selective enough to be useful: a
		// shingle present in one symbol only cannot form a pair, and one present
		// in more than DUPLICATES_POSTING_CAP symbols would only produce
		// low-similarity pairs. Iterating ALL selective shingles (not just each
		// symbol's rarest) is what keeps recall: a near-duplicate pair differs
		// exactly at its rarest shingles, but shares the many common ones.
		const postings = new Map<number, number[]>();
		for (let index = 0; index < bucket.length; index++) {
			for (const shingle of bucket[index].shingles) {
				const frequency = df.get(shingle) ?? 0;
				if (frequency < 2 || frequency > DUPLICATES_POSTING_CAP) continue;
				const list = postings.get(shingle);
				if (list) list.push(index);
				else postings.set(shingle, [index]);
			}
		}

		// Rarest shingle first: pairs sharing a rare shingle are the likeliest
		// near-duplicates, so a pair-cap cut drops the least useful candidates.
		const orderedShingles = [...postings.keys()].sort((a, b) => (df.get(a) ?? 0) - (df.get(b) ?? 0) || a - b);

		for (const shingle of orderedShingles) {
			const list = postings.get(shingle) as number[];
			for (let x = 0; x < list.length; x++) {
				for (let y = x + 1; y < list.length; y++) {
					if (pairsCompared >= DUPLICATES_MAX_PAIRS) {
						pairsTruncated = true;
						break;
					}
					const left = bucket[list[x]];
					const right = bucket[list[y]];
					if (left.symbol.id === right.symbol.id) continue;
					const pairKey =
						left.symbol.id < right.symbol.id
							? `${left.symbol.id}\u0000${right.symbol.id}`
							: `${right.symbol.id}\u0000${left.symbol.id}`;
					if (scoredPairs.has(pairKey)) continue;
					scoredPairs.add(pairKey);
					pairsCompared++;
					const similarity = jaccard(left.shingles, right.shingles);
					if (similarity < minSimilarity || similarity >= 1) continue;
					nearGroups.push(buildGroup([left, right], "near", similarity, repo));
				}
				if (pairsTruncated) break;
			}
			if (pairsTruncated) break;
		}
		if (pairsTruncated) break;
	}

	// ── Rank, cut, cache ──
	const allGroups = [...exactGroups, ...nearGroups].sort(compareGroups);
	const groups = allGroups.slice(0, limit);
	const result: DuplicateAnalysisResult = {
		groups,
		summary: {
			symbols_scanned: symbols.length,
			symbols_compared: derived.length,
			files_read: filesRead,
			pairs_compared: pairsCompared,
			groups_total: allGroups.length,
			exact_groups: exactGroups.length,
			near_groups: nearGroups.length,
			groups_truncated: allGroups.length > groups.length,
			pairs_truncated: pairsTruncated,
			cache_hit: false
		}
	};

	lruSet(analysisCache, cacheKey, result, DUPLICATES_CACHE_MAX_ENTRIES);
	return result;
}
