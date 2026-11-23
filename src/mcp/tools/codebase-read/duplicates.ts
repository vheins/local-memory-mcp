/**
 * DUPLICATES mode handler for codebase-read (FEAT-001).
 *
 * Reads the repo's indexed `function`/`method` symbols (or the requested
 * `kind`s), loads each symbol's source range through the shared checksum-keyed
 * content cache, and runs the two-pass duplicate analysis:
 * exact-normalized duplicates first, near duplicates second with a
 * parameter-list merge hint (the DRY case: same body, different params).
 *
 * No schema change and no new dependency: symbols + `source_fingerprint` already
 * exist in the index; the fingerprint is the cache-validity key.
 */

import type { CodebaseReadInput } from "../schemas/codebase-read";
import { SQLiteStore } from "../../storage/sqlite";
import { createMcpResponse, type McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import { logger } from "../../utils/logger";
import { codeSearchCache } from "../../codebase-index/services/code-search-cache";
import {
	analyzeDuplicates,
	clearDuplicatesCaches,
	type DuplicateAnalysisResult,
	type DuplicateGroup
} from "../../codebase-index/services/duplicates";
import {
	DUPLICATES_DEFAULT_LIMIT,
	DUPLICATES_DEFAULT_MIN_LINES,
	DUPLICATES_DEFAULT_MIN_SIMILARITY
} from "../../utils/constants";
import { resolveRepoFilePath, resolveRepoRootScope } from "./repo-root";

/** Kinds compared by default: callable symbols, where body duplication matters. */
const DEFAULT_DUPLICATE_KINDS = ["function", "method"];

/**
 * Normalize the `kind` filter: absent/empty ⇒ the callable default; a
 * comma-separated string is split (matches the inline-tag convention used by
 * the other modes); duplicates are removed to keep the SQL `IN` clause tight.
 */
export function normalizeDuplicateKinds(kind: CodebaseReadInput["kind"]): string[] {
	if (!kind) return [...DEFAULT_DUPLICATE_KINDS];
	const values = Array.isArray(kind) ? kind : [kind];
	const kinds = new Set<string>();
	for (const value of values) {
		for (const part of String(value).split(",")) {
			const trimmed = part.trim();
			if (trimmed.length > 0) kinds.add(trimmed);
		}
	}
	return kinds.size > 0 ? [...kinds] : [...DEFAULT_DUPLICATE_KINDS];
}

/** One-line description of a duplicate group's members. */
function formatGroupHeader(group: DuplicateGroup): string {
	const names = group.symbols.map((symbol) => symbol.name).join(" ↔ ");
	return `- [${group.class} ${group.similarity.toFixed(2)}] \`${group.kind}\` ${names} — ${group.merge_hint}`;
}

/**
 * Render the compact text summary that every codebase-read response carries.
 * Deterministic: the analysis already sorted groups and members.
 */
export function renderDuplicatesText(
	result: DuplicateAnalysisResult,
	options: {
		repo: string;
		kinds: string[];
		minSimilarity: number;
		minLines: number;
		limit: number;
	}
): string {
	const { groups, summary, unreadable_files: unreadableFiles } = result;
	const thresholds = `min_similarity=${options.minSimilarity}, min_lines=${options.minLines}, kinds=${options.kinds.join(",")}, limit=${options.limit}`;
	let out = `### Duplicate groups: ${summary.groups_total} (exact ${summary.exact_groups} · near ${summary.near_groups})\n`;
	out +=
		`Scanned ${summary.symbols_scanned} symbols in "${options.repo}" (${summary.symbols_compared} compared, ` +
		`${summary.files_read} files read, ${summary.pairs_compared} near pairs scored; ${thresholds}).`;
	if (unreadableFiles.length > 0) {
		const sample = unreadableFiles.slice(0, 5).join(", ");
		const more = unreadableFiles.length > 5 ? ` and ${unreadableFiles.length - 5} more` : "";
		out += ` Skipped ${unreadableFiles.length} unreadable file(s): ${sample}${more}.`;
	}
	// State WHY near coverage is partial: a caller must never read a short
	// near-group list as proof that no near duplicates exist.
	if (summary.near_coverage === "partial") {
		const reasons: string[] = [];
		if (summary.pairs_truncated) reasons.push("the pair cap was reached");
		if (summary.postings_skipped > 0) {
			reasons.push(`${summary.postings_skipped} shingle posting(s) exceeded the selectivity cap`);
		}
		out += ` Near coverage is partial (${reasons.join("; ")}); near duplicates may be missing.`;
	}
	out += "\n";

	if (groups.length === 0) {
		out += "\nNo duplicate bodies found at these thresholds.\n";
		return out;
	}

	if (summary.groups_truncated) {
		out += `\nShowing ${groups.length} of ${summary.groups_total} groups (raise \`limit\` for more).\n`;
	}

	for (const group of groups) {
		out += `\n${formatGroupHeader(group)}\n`;
		for (const symbol of group.symbols) {
			out += `  - ${symbol.name} ${symbol.file_path} L${symbol.start_line}-${symbol.end_line}\n`;
		}
	}
	return out;
}

/**
 * DUPLICATES mode handler — find duplicated symbol bodies in one indexed repo.
 *
 * Exact-normalized matches are reported first; near matches second. Members
 * already reported as exact are not repeated in the near pass.
 */
export async function handleDuplicatesMode(validated: CodebaseReadInput, db: SQLiteStore): Promise<McpResponse> {
	const scope = resolveRepoRootScope(
		validated,
		"duplicates",
		"Duplicates analysis requires `repoPath`: pass the same absolute path used with index_repository, or run index_repository first."
	);
	if ("error" in scope) return scope.error;
	const { repo, repoPath } = scope;

	const kinds = normalizeDuplicateKinds(validated.kind);
	const minSimilarity = validated.min_similarity ?? DUPLICATES_DEFAULT_MIN_SIMILARITY;
	const minLines = validated.min_lines ?? DUPLICATES_DEFAULT_MIN_LINES;
	const limit = validated.limit ?? DUPLICATES_DEFAULT_LIMIT;

	const candidates = db.codebaseSymbols.getDuplicateCandidates(repo, kinds);

	// A repo that was never indexed is not an empty result — surface guidance,
	// mirroring the CODE mode contract.
	if (candidates.length === 0 && db.codebaseFiles.getFileCountByRepo(repo) === 0) {
		return createMcpErrorResponse({
			code: "REPO_NOT_INDEXED",
			message: `Repo "${repo}" has no indexed files. Run index_repository first.`,
			retryable: false
		});
	}

	// Language + checksum per file: language picks comment syntax, checksum is
	// the content-cache validity key (an unchanged file is never re-read).
	const files = db.codebaseFiles.getFilesByPaths(
		repo,
		candidates.map((candidate) => candidate.file_path)
	);
	const languageByPath = new Map<string, string | null>();
	const checksumByPath = new Map<string, string | null>();
	for (const file of files) {
		languageByPath.set(file.file_path, file.language);
		checksumByPath.set(file.file_path, file.checksum);
	}

	// A read failure is reported by the analysis itself (it owns the coverage
	// counters and caches them), so the handler only returns null here.
	const readFile = async (filePath: string): Promise<string | null> => {
		const absolutePath = resolveRepoFilePath(repoPath, filePath);
		if (!absolutePath) return null;
		try {
			return await codeSearchCache.getContent(repo, filePath, checksumByPath.get(filePath) ?? null, absolutePath);
		} catch (err) {
			logger.debug("[handleDuplicatesMode] file read failed", {
				repo,
				filePath,
				error: err instanceof Error ? err.message : String(err)
			});
			return null;
		}
	};

	let result: DuplicateAnalysisResult;
	try {
		result = await analyzeDuplicates({
			repo,
			repoRoot: repoPath,
			symbols: candidates,
			languageByFile: (filePath) => languageByPath.get(filePath) ?? null,
			readFile,
			minSimilarity,
			minLines,
			limit
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("[handleDuplicatesMode] analysis failed", { repo, error: message });
		return createMcpErrorResponse({
			code: "DUPLICATES_ANALYSIS_FAILED",
			message: "Duplicate analysis failed",
			retryable: true
		});
	}

	const unreadableFiles = result.unreadable_files;
	const contentSummary = renderDuplicatesText(result, {
		repo,
		kinds,
		minSimilarity,
		minLines,
		limit
	});

	return createMcpResponse(
		{
			schema: "codebase-read",
			mode: "duplicates",
			repo,
			thresholds: { min_similarity: minSimilarity, min_lines: minLines, kinds },
			limit,
			groups: result.groups,
			summary: result.summary,
			unreadable_files: unreadableFiles.slice(0, 20),
			unreadable_files_truncated: unreadableFiles.length > 20
		},
		`Found ${result.summary.groups_total} duplicate groups (exact ${result.summary.exact_groups}, near ${result.summary.near_groups}) among ${result.summary.symbols_scanned} ${kinds.join("/")} symbols.`,
		{ includeJson: validated.json, contentSummary }
	);
}

/** Test-only: clear the analysis + derived-body caches. */
export { clearDuplicatesCaches };
