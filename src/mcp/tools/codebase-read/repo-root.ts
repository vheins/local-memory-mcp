/**
 * Shared repo-root resolution for codebase-read modes that read files from disk
 * (CODE content grep, DUPLICATES body analysis).
 *
 * The index stores no repo→path registry: `codebase_files.file_path` is relative
 * to the repo ROOT the caller passed to `index_repository`. Every disk-reading
 * mode therefore needs the same guard chain, and every failure must keep its
 * established error code so existing clients see no contract change:
 *
 *   REPO_REQUIRED → REPO_PATH_REQUIRED → REPO_PATH_NOT_FOUND →
 *   NOT_A_DIRECTORY → REPO_PATH_NOT_ROOT
 *
 * Extracted from the CODE handler (FIX-CODESEARCH-STORM logic) so DUPLICATES
 * cannot drift from it.
 */

import fs from "node:fs";
import path from "node:path";
import type { CodebaseReadInput } from "../schemas/codebase-read";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import type { McpResponse } from "../../utils/mcp-response";
import { listWatchedRepos } from "../../codebase-index/services/file-watcher";

/**
 * Best-effort path identity check: resolves symlinks when possible, otherwise
 * falls back to `path.resolve` (mirrors the watcher registry's own
 * `path.resolve(repoPath)` normalization). Used to tell a repo ROOT apart from
 * a subdirectory of it.
 */
export function samePath(a: string, b: string): boolean {
	try {
		return fs.realpathSync.native(a) === fs.realpathSync.native(b);
	} catch {
		return path.resolve(a) === path.resolve(b);
	}
}

/** Resolved repo scope, or the error envelope to return unchanged. */
export type RepoRootScope = { repo: string; repoPath: string } | { error: McpResponse };

/**
 * Resolve and validate `repo` + `repoPath` for a disk-reading mode.
 *
 * @param validated Parsed tool input.
 * @param mode Mode name used in the REPO_REQUIRED message.
 * @param missingRepoPathMessage Mode-specific REPO_PATH_REQUIRED guidance.
 * @returns The resolved absolute repo root, or an error envelope.
 */
export function resolveRepoRootScope(
	validated: CodebaseReadInput,
	mode: string,
	missingRepoPathMessage: string
): RepoRootScope {
	const repo = validated.repo;
	if (!repo) {
		return {
			error: createMcpErrorResponse({
				code: "REPO_REQUIRED",
				message: `Mode '${mode}' requires a concrete 'repo'.`,
				retryable: false
			})
		};
	}

	const repoPath = validated.repoPath?.trim();
	if (!repoPath) {
		return {
			error: createMcpErrorResponse({
				code: "REPO_PATH_REQUIRED",
				message: missingRepoPathMessage,
				retryable: false
			})
		};
	}

	const resolvedPath = path.resolve(repoPath);
	let stat: fs.Stats;
	try {
		stat = fs.statSync(resolvedPath);
	} catch {
		return {
			error: createMcpErrorResponse({
				code: "REPO_PATH_NOT_FOUND",
				message: `Repository path not found: ${resolvedPath}. Re-run index_repository or pass the correct repoPath.`,
				retryable: false
			})
		};
	}
	if (!stat.isDirectory()) {
		return {
			error: createMcpErrorResponse({
				code: "NOT_A_DIRECTORY",
				message: `Repository path is not a directory: ${resolvedPath}`,
				retryable: false
			})
		};
	}

	// Root-path guard (FIX-CODESEARCH-STORM): a subdirectory `repoPath` makes
	// every root-relative indexed file resolve outside it → ENOENT for the whole
	// repo. The watcher registry (populated by startup auto-index + every
	// index_repository call) knows the registered root; reject a mismatch up
	// front instead of emitting one warning per file. Absent registry entry
	// (e.g. dashboard process) ⇒ skip the guard — `statSync` already confirmed
	// the path exists.
	const registered = listWatchedRepos().get(repo);
	if (registered && !samePath(registered.repoPath, resolvedPath)) {
		return {
			error: createMcpErrorResponse({
				code: "REPO_PATH_NOT_ROOT",
				message:
					`repoPath must be the repository ROOT registered for "${repo}", not a subdirectory: got ${resolvedPath}, expected ${registered.repoPath}. ` +
					`Pass the same absolute path used with index_repository.`,
				retryable: false,
				details: { repo, supplied: resolvedPath, expected: registered.repoPath }
			})
		};
	}

	return { repo, repoPath: resolvedPath };
}

/**
 * Resolve one index-recorded file path against the repo root, refusing anything
 * outside it. `file_path` values come from the index (repo-relative), but the
 * containment check keeps a corrupted/hostile row from reading arbitrary files.
 *
 * @returns The absolute path, or null when the path escapes the root.
 */
export function resolveRepoFilePath(repoPath: string, filePath: string): string | null {
	if (!filePath || path.isAbsolute(filePath)) return null;
	const root = path.resolve(repoPath);
	const absolute = path.resolve(root, filePath);
	const relative = path.relative(root, absolute);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
	return absolute;
}
