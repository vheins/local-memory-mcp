/**
 * indexing-planner — FilePlan generation and batch planning.
 *
 * Extracted from indexing-repository.ts COMPARE section.
 * Transforms discovered files into actionable plans (parse vs skip),
 * detects renames, and computes stale paths.
 */

import type { CodebaseFile } from "../../types/codebase-file.js";
import type { DiscoveredFile } from "../types/index.js";
import { FilePlan } from "./indexing-cache.js";

// ── Index plan result ────────────────────────────────────────────────────

export interface IndexPlan {
	plans: FilePlan[];
	fileMap: Map<string, DiscoveredFile>;
	existingMap: Map<string, { checksum: string | null }>;
	checksumToOldPaths: Map<string, string[]>;
	renameMap: Map<string, string>; // new path → old path
	stalePaths: Set<string>;
	totalFiles: number;
	staleCount: number;
}

// ── Plan builder ─────────────────────────────────────────────────────────

/**
 * Build an index plan from discovered and existing files.
 *
 * Categorizes each discovered file as "parse" (new or changed) or "skip"
 * (unchanged checksum), detects renames via checksum matching, and
 * identifies stale files that no longer exist on disk.
 */
export function createIndexPlan(
	discoveredFiles: DiscoveredFile[],
	existingFiles: CodebaseFile[],
	options: { force?: boolean }
): IndexPlan {
	const fileMap = new Map<string, DiscoveredFile>();
	const existingMap = new Map<string, { checksum: string | null }>();
	for (const f of existingFiles) {
		existingMap.set(f.file_path, { checksum: f.checksum });
	}

	// Build a map for rename detection: checksum → list of old file paths
	const checksumToOldPaths = new Map<string, string[]>();
	for (const f of existingFiles) {
		if (f.checksum) {
			const bucket = checksumToOldPaths.get(f.checksum) ?? [];
			bucket.push(f.file_path);
			checksumToOldPaths.set(f.checksum, bucket);
		}
	}

	const plans: FilePlan[] = [];
	const discoveredPaths = new Set<string>();
	const renameMap = new Map<string, string>(); // new path → old path

	for (const df of discoveredFiles) {
		discoveredPaths.add(df.path);
		fileMap.set(df.path, df);

		if (options.force) {
			plans.push({
				action: "parse",
				...df,
				filePath: df.path
			});
			continue;
		}

		const existing = existingMap.get(df.path);
		if (!existing) {
			// New file — could be genuinely new or a rename; detect later
			plans.push({
				action: "parse",
				...df,
				filePath: df.path
			});
		} else {
			// Exists in DB — compare checksum below at parse time
			plans.push({
				action: "parse",
				...df,
				filePath: df.path
			});
		}
	}

	const totalFiles = discoveredFiles.length;

	// Compute set of stale file paths (deleted from disk)
	const stalePaths = new Set<string>();
	for (const existing of existingFiles) {
		if (!discoveredPaths.has(existing.file_path)) {
			stalePaths.add(existing.file_path);
		}
	}
	const staleCount = stalePaths.size;

	return {
		plans,
		fileMap,
		existingMap,
		checksumToOldPaths,
		renameMap,
		stalePaths,
		totalFiles,
		staleCount
	};
}
