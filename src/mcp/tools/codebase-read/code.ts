import fs from "node:fs";
import path from "node:path";
import type { CodebaseReadInput } from "../schemas/codebase-read";
import { SQLiteStore } from "../../storage/sqlite";
import { createMcpResponse, type McpResponse } from "../../utils/mcp-response";
import {
	searchCodeInRepo,
	InvalidCodeSearchRegexError,
	type CodeSearchMatch
} from "../../codebase-index/services/code-search";
import { CODE_SEARCH_DEFAULT_LIMIT } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { parseTaggedQuery, CODEBASE_READ_TAG_KEYS } from "../../utils/query-tags";

// ── CODE (content grep) ─────────────────────────────────────────────────

/**
 * Build a grouped-by-file summary of code matches.
 *
 * Format:
 *   ### Matches: N for "content" (showing M)
 *
 *   **file/path.ts**
 *   - L12 (in `function foo` L10-L20): `…snippet…`
 */
function formatCodeMatchesGrouped(matches: CodeSearchMatch[], total: number, content: string): string {
	if (matches.length === 0) return `### Matches: ${total} for "${content}"`;

	let out = `### Matches: ${total} for "${content}" (showing ${matches.length})\n`;

	const groups = new Map<string, CodeSearchMatch[]>();
	const groupOrder: string[] = [];
	for (const m of matches) {
		if (!groups.has(m.filePath)) {
			groups.set(m.filePath, []);
			groupOrder.push(m.filePath);
		}
		groups.get(m.filePath)!.push(m);
	}

	for (const filePath of groupOrder) {
		out += `\n**${filePath}**\n`;
		for (const m of groups.get(filePath)!) {
			const sym = m.enclosingSymbol
				? ` (in \`${m.enclosingSymbol.kind} ${m.enclosingSymbol.name}\` L${m.enclosingSymbol.startLine}-${m.enclosingSymbol.endLine})`
				: "";
			out += `- L${m.line}${sym}: \`${m.snippet}\`\n`;
		}
	}

	return out;
}

/**
 * CODE mode handler — grep indexed file CONTENTS with symbol-context
 * enrichment (TASK-316).
 *
 * Disk grep over codebase_files scope only (never node_modules/.git — those
 * are excluded from the index by construction). `repoPath` is required
 * (caller-supplied, mirroring index_repository; the index stores no repo→path
 * registry). Content flows through the process-shared checksum-keyed LRU.
 *
 * Failure envelopes: REPO_PATH_REQUIRED / REPO_PATH_NOT_FOUND /
 * REPO_NOT_INDEXED / INVALID_REGEX. Empty `content` → no-op empty result
 * (never a full-file dump).
 */
async function handleCodeSearchMode(validated: CodebaseReadInput, db: SQLiteStore): Promise<McpResponse> {
	const content = (validated.content ?? "").trim();

	// Defensive inline tag extraction (TASK-443): `language:php` in the (optional)
	// free-text query is auto-extracted into the CODE-mode language filter. The
	// owner/repo scope tags are protected and ignored here — `validated.repo` /
	// `repoPath` drive scoping. Inline `language` wins if present, else the
	// structured `validated.language` is used.
	const tagged = parseTaggedQuery(validated.query ?? "", CODEBASE_READ_TAG_KEYS);
	const language = (tagged.filters as { language?: string }).language ?? validated.language;

	// Empty query → no-op: return an empty result, never a full-file dump.
	if (content.length === 0) {
		return createMcpResponse(
			{
				mode: "code",
				content: "",
				regex: validated.regex,
				language: language ?? null,
				matches: [],
				total: 0,
				hasMore: false,
				filesScanned: 0,
				fileCount: 0,
				offset: validated.offset,
				limit: validated.limit ?? CODE_SEARCH_DEFAULT_LIMIT
			},
			"Empty content query — nothing searched (pass `content` to grep indexed file contents)",
			{ includeJson: true }
		);
	}

	const repo = validated.repo;
	if (!repo) {
		return createMcpResponse(
			{ error: "Mode 'code' requires a concrete 'repo'", code: "REPO_REQUIRED" },
			"Mode 'code' requires a concrete 'repo'.",
			{ includeJson: true }
		);
	}

	const repoPath = validated.repoPath?.trim();
	if (!repoPath) {
		return createMcpResponse(
			{
				error: "Code search requires `repoPath` — the absolute path of the indexed repo on disk",
				code: "REPO_PATH_REQUIRED"
			},
			"Code search requires `repoPath`: pass the same absolute path used with index_repository, or run index_repository first.",
			{ includeJson: true }
		);
	}

	const resolvedPath = path.resolve(repoPath);
	let stat: fs.Stats;
	try {
		stat = fs.statSync(resolvedPath);
	} catch {
		return createMcpResponse(
			{
				error: `Repository path not found: ${resolvedPath}. Re-run index_repository or pass the correct repoPath.`,
				code: "REPO_PATH_NOT_FOUND"
			},
			`Repository path not found: ${resolvedPath}`,
			{ includeJson: true }
		);
	}
	if (!stat.isDirectory()) {
		return createMcpResponse(
			{
				error: `Repository path is not a directory: ${resolvedPath}`,
				code: "REPO_PATH_NOT_FOUND"
			},
			`Repository path is not a directory: ${resolvedPath}`,
			{ includeJson: true }
		);
	}

	const limit = validated.limit ?? CODE_SEARCH_DEFAULT_LIMIT;
	const offset = validated.offset;

	try {
		const result = await searchCodeInRepo(db, repo, resolvedPath, {
			needle: content,
			regex: validated.regex,
			language,
			limit,
			offset
		});

		// A repo with zero indexed files is not resolvable as a grep target —
		// surface guidance instead of a misleading "0 matches".
		if (result.indexedFiles === 0) {
			return createMcpResponse(
				{
					error: `Repo "${repo}" has no indexed files. Run index_repository first.`,
					code: "REPO_NOT_INDEXED"
				},
				`Repo "${repo}" has no indexed files. Run index_repository first.`,
				{ includeJson: true }
			);
		}

		// Every in-scope indexed file failed to read ⇒ the repoPath is almost
		// certainly wrong (or the checkout moved) — surface guidance rather
		// than "0 matches". (A language filter matching no files yields
		// fileCount 0, which falls through to the normal empty response.)
		if (result.fileCount > 0 && result.filesScanned === 0) {
			return createMcpResponse(
				{
					error: `None of the ${result.fileCount} indexed files could be read at ${resolvedPath}. Re-run index_repository or pass the correct repoPath.`,
					code: "REPO_FILES_MISSING"
				},
				`None of the ${result.fileCount} indexed files could be read at ${resolvedPath}.`,
				{ includeJson: true }
			);
		}

		const contentSummary = formatCodeMatchesGrouped(result.matches, result.total, content);

		return createMcpResponse(
			{
				mode: "code",
				content,
				regex: validated.regex,
				language: language ?? null,
				matches: result.matches,
				total: result.total,
				hasMore: result.hasMore,
				filesScanned: result.filesScanned,
				fileCount: result.fileCount,
				indexedFiles: result.indexedFiles,
				offset,
				limit
			},
			`Found ${result.total} content matches for "${content}" (showing ${result.matches.length}) across ${result.filesScanned} indexed files.`,
			{ includeJson: true, contentSummary }
		);
	} catch (err) {
		if (err instanceof InvalidCodeSearchRegexError) {
			return createMcpResponse({ error: err.message, code: "INVALID_REGEX" }, err.message, {
				includeJson: true
			});
		}
		const message = err instanceof Error ? err.message : String(err);
		logger.error("[handleCodebaseRead:code] Unexpected error", { repo, content, error: message });
		return createMcpResponse({ error: message, code: "CODE_SEARCH_FAILED" }, message, { includeJson: true });
	}
}

export { handleCodeSearchMode };
