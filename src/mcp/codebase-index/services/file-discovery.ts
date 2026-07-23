/**
 * FileDiscoveryService — walks a directory tree, discovers source files,
 * and filters according to gitignore rules and glob patterns.
 *
 * Pure-function style (matching soul-maintenance.ts pattern):
 * the `discoverFiles` function accepts options and returns a result.
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import fg from "fast-glob";
import ignoreLib from "ignore";
import { logger } from "../../utils/logger.js";
import type { DiscoveredFile, DiscoverFilesResult, DiscoveryError, FileDiscoveryOptions } from "../types/index.js";

// ── Language detection ────────────────────────────────────────────────

/** File extension → language identifier mapping. */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = Object.freeze({
	".ts": "typescript",
	".tsx": "typescriptreact",
	".js": "javascript",
	".jsx": "javascriptreact",
	".json": "json",
	".md": "markdown",
	".css": "css",
	".scss": "scss",
	".less": "less",
	".html": "html",
	".sql": "sql",
	".graphql": "graphql",
	".yaml": "yaml",
	".yml": "yaml",
	".xml": "xml",
	".sh": "shellscript",
	".bash": "shellscript",
	".py": "python",
	".rb": "ruby",
	".go": "go",
	".rs": "rust",
	".java": "java",
	".kt": "kotlin",
	".kts": "kotlin",
	".swift": "swift",
	".c": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	".h": "c",
	".hpp": "cpp",
	".hh": "cpp",
	".hxx": "cpp",
	".php": "php",
	".dart": "dart",
	".vue": "vue",
	".svelte": "svelte",
	".toml": "toml",
	".ini": "ini",
	".env": "env",
	".dockerfile": "dockerfile",
	".lock": "lockfile"
});

/**
 * Map a file extension to a language identifier.
 * Returns `null` for unsupported extensions (file should be skipped).
 */
function detectLanguage(filePath: string): string | null {
	const ext = path.extname(filePath).toLowerCase();
	if (!ext) {
		// Handle extensionless files like "Dockerfile", "Makefile"
		const basename = path.basename(filePath).toLowerCase();
		if (basename === "dockerfile") return "dockerfile";
		if (basename === "makefile") return "makefile";
		return null;
	}
	return EXTENSION_LANGUAGE_MAP[ext] ?? null;
}

// ── Default patterns ──────────────────────────────────────────────────

/** Directories / globs always excluded from discovery. */
const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = Object.freeze([
	"**/node_modules/**",
	"**/.git/**",
	"**/dist/**",
	"**/.next/**",
	"**/build/**",
	"**/coverage/**",
	"**/__pycache__/**",
	"**/.venv/**",
	"**/vendor/**",
	"**/target/**",
	"**/.DS_Store"
]);

// ── Service implementation ────────────────────────────────────────────

/**
 * Interface exposed by the file discovery service.
 * (Defined here for discoverability; consumers import the function directly.)
 */
export interface FileDiscoveryService {
	discoverFiles(options: FileDiscoveryOptions): Promise<DiscoverFilesResult>;
}

/**
 * Walk a directory tree, discover source files, and filter according to
 * gitignore rules and glob patterns.
 *
 * @returns Sorted, deterministic list of discovered files with metadata.
 */
export async function discoverFiles(options: FileDiscoveryOptions): Promise<DiscoverFilesResult> {
	const startTime = performance.now();
	const errors: DiscoveryError[] = [];
	const { projectPath, includeGlobs, excludeGlobs = [], respectGitignore = true, maxFiles } = options;

	// Resolve projectPath to an absolute, normalized path
	const root = path.resolve(projectPath);

	// ── Parse .gitignore ──────────────────────────────────────────
	let gitignoreFilter: ReturnType<typeof ignoreLib> | null = null;
	if (respectGitignore) {
		const gitignorePath = path.join(root, ".gitignore");
		try {
			const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
			gitignoreFilter = ignoreLib().add(gitignoreContent);
			logger.debug("[FileDiscovery] Parsed .gitignore", { path: gitignorePath });
		} catch {
			// No .gitignore present — that's fine; defaults handle common exclusions
			logger.debug("[FileDiscovery] No .gitignore found — using defaults only");
		}
	}

	// ── Build fast-glob patterns ──────────────────────────────────
	// fast-glob handles glob matching (include + exclude) natively.
	// We pass includeGlobs as patterns and excludeGlobs as ignore.
	// This avoids needing a secondary glob library.
	const globPatterns = includeGlobs && includeGlobs.length > 0 ? includeGlobs : ["**/*"];

	// Combine default + user-specified exclude patterns
	const allExcludeGlobs = [...DEFAULT_EXCLUDE_PATTERNS, ...excludeGlobs];

	const stream = fg.stream(globPatterns, {
		cwd: root,
		absolute: true,
		dot: false,
		onlyFiles: true,
		ignore: allExcludeGlobs
	});

	// ── Iterate stream ────────────────────────────────────────────
	const discovered: DiscoveredFile[] = [];
	let totalFiles = 0;
	let supportedFiles = 0;
	let skippedFiles = 0;
	let skippedByExtension = 0;
	let skippedByGitignore = 0;

	for await (const absolutePath of stream) {
		totalFiles++;
		const entryPath = absolutePath as string;

		try {
			// 1. Skip symlinks (fast-glob may follow them)
			const stat = fs.lstatSync(entryPath);
			if (stat.isSymbolicLink()) {
				skippedFiles++;
				continue;
			}

			const relativePath = path.relative(root, entryPath);

			// 2. Check gitignore rules
			if (gitignoreFilter && gitignoreFilter.ignores(relativePath)) {
				skippedFiles++;
				skippedByGitignore++;
				continue;
			}

			// 3. Detect language — skip unsupported extensions
			const language = detectLanguage(relativePath);
			if (language === null) {
				skippedFiles++;
				skippedByExtension++;
				continue;
			}

			discovered.push({
				path: relativePath,
				absolutePath: entryPath,
				language,
				sizeBytes: stat.size
			});
			supportedFiles++;

			// 4. Early exit if maxFiles limit reached
			if (maxFiles !== undefined && discovered.length >= maxFiles) {
				break;
			}
		} catch (err) {
			skippedFiles++;
			const message = err instanceof Error ? err.message : String(err);
			errors.push({
				path: entryPath,
				error: message
			});
		}
	}

	// ── Sort for deterministic output ─────────────────────────────
	discovered.sort((a, b) => a.path.localeCompare(b.path));

	const durationMs = Math.round(performance.now() - startTime);

	logger.info("[FileDiscovery] Discovery complete", {
		projectPath: root,
		totalFiles,
		supportedFiles,
		skippedFiles,
		skippedByExtension,
		skippedByGitignore,
		durationMs,
		errorCount: errors.length
	});

	return {
		files: discovered,
		totalFiles,
		supportedFiles,
		skippedFiles,
		skippedByExtension,
		skippedByGitignore,
		durationMs,
		errors
	};
}
