/**
 * Architecture Service — builds a directory-tree view and summary from
 * indexed CodebaseFile and CodebaseSymbol records.
 *
 * Design:
 * - Pure functions — no DB access, no I/O. Data is passed in.
 * - Directory tree is built by splitting file paths and nesting nodes.
 * - At the configured depth, deeper subdirectories are collapsed into
 *   summary nodes with aggregated symbol counts and a `hasMoreFiles` flag.
 * - Language breakdown and top-level exports are computed from the raw
 *   file and symbol arrays.
 */

import type { CodebaseFile } from "../../types/codebase-file";
import type { CodebaseSymbol } from "../../types/codebase-symbol";

// ── Public types ─────────────────────────────────────────────────────────

export interface DirectoryNode {
	path: string;
	name: string;
	type: "file" | "directory";
	children?: DirectoryNode[];
	symbolCounts?: Record<string, number>;
	hasMoreFiles?: boolean;
}

export interface ArchitectureSummary {
	totalFiles: number;
	totalSymbols: number;
	languageBreakdown: Record<string, number>;
	topLevelExports: CodebaseSymbol[];
}

export interface ArchitectureResult {
	root: DirectoryNode;
	summary: ArchitectureSummary;
}

// ── Internal helpers ─────────────────────────────────────────────────────

interface DirTree {
	name: string;
	path: string;
	files: CodebaseFile[];
	subdirs: Map<string, DirTree>;
}

function createDirTree(name: string, path: string): DirTree {
	return { name, path, subdirs: new Map(), files: [] };
}

function normalizeFilePath(fp: string): string {
	// Strip leading slash so the root isn't empty-string
	return fp.replace(/^\//, "");
}

/**
 * Build a flat Map of file_path → CodebaseSymbol[] for quick lookup.
 */
function buildSymbolMap(symbols: CodebaseSymbol[]): Map<string, CodebaseSymbol[]> {
	const map = new Map<string, CodebaseSymbol[]>();
	for (const sym of symbols) {
		const list = map.get(sym.file_path);
		if (list) {
			list.push(sym);
		} else {
			map.set(sym.file_path, [sym]);
		}
	}
	return map;
}

/**
 * Recursively convert a DirTree to a flat DirectoryNode tree.
 *
 * At `depth` = 0 the caller controls: we stop recursing and emit
 * collapsed summary nodes for deeper subdirectories.
 */
function dirTreeToNode(
	tree: DirTree,
	currentDepth: number,
	maxDepth: number,
	symbolMap: Map<string, CodebaseSymbol[]>
): DirectoryNode {
	const children: DirectoryNode[] = [];

	if (currentDepth < maxDepth) {
		// Add file nodes
		for (const file of tree.files) {
			const fileSyms = symbolMap.get(file.file_path) ?? [];
			const symbolCounts: Record<string, number> = {};
			for (const sym of fileSyms) {
				symbolCounts[sym.kind] = (symbolCounts[sym.kind] ?? 0) + 1;
			}
			children.push({
				path: file.file_path,
				name: file.file_path.split("/").pop() ?? file.file_path,
				type: "file",
				symbolCounts: Object.keys(symbolCounts).length > 0 ? symbolCounts : undefined
			});
		}

		// Recursively process subdirectories
		for (const [, subdir] of tree.subdirs) {
			children.push(dirTreeToNode(subdir, currentDepth + 1, maxDepth, symbolMap));
		}
	} else {
		// At max depth: collapse everything below
		// First, add direct file children
		for (const file of tree.files) {
			const fileSyms = symbolMap.get(file.file_path) ?? [];
			const symbolCounts: Record<string, number> = {};
			for (const sym of fileSyms) {
				symbolCounts[sym.kind] = (symbolCounts[sym.kind] ?? 0) + 1;
			}
			children.push({
				path: file.file_path,
				name: file.file_path.split("/").pop() ?? file.file_path,
				type: "file",
				symbolCounts: Object.keys(symbolCounts).length > 0 ? symbolCounts : undefined
			});
		}

		// Collapse subdirectories into summary nodes
		for (const [, subdir] of tree.subdirs) {
			const { symbolCounts } = countFilesAndSymbols(subdir, symbolMap);
			children.push({
				path: subdir.path,
				name: subdir.name,
				type: "directory",
				hasMoreFiles: true,
				symbolCounts: Object.keys(symbolCounts).length > 0 ? symbolCounts : undefined
			});
		}
	}

	return {
		path: tree.path,
		name: tree.name,
		type: "directory",
		children
	};
}

/**
 * Recursively count files and aggregate symbol counts for a directory tree.
 */
function countFilesAndSymbols(
	tree: DirTree,
	symbolMap: Map<string, CodebaseSymbol[]>
): { fileCount: number; symbolCounts: Record<string, number> } {
	const symbolCounts: Record<string, number> = {};
	let fileCount = tree.files.length;

	for (const file of tree.files) {
		const syms = symbolMap.get(file.file_path) ?? [];
		for (const sym of syms) {
			symbolCounts[sym.kind] = (symbolCounts[sym.kind] ?? 0) + 1;
		}
	}

	for (const [, subdir] of tree.subdirs) {
		const sub = countFilesAndSymbols(subdir, symbolMap);
		fileCount += sub.fileCount;
		for (const [kind, count] of Object.entries(sub.symbolCounts)) {
			symbolCounts[kind] = (symbolCounts[kind] ?? 0) + count;
		}
	}

	return { fileCount, symbolCounts };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Build an architecture overview from indexed codebase data.
 *
 * @param files  - All CodebaseFile records for the repo.
 * @param symbols - All CodebaseSymbol records for the repo.
 * @param depth   - Maximum directory depth to expand before collapsing.
 * @param topLevelExportsLimit - Max number of top-level exports to return (default 50).
 */
export function buildArchitecture(
	files: CodebaseFile[],
	symbols: CodebaseSymbol[],
	depth: number,
	topLevelExportsLimit: number = 50
): ArchitectureResult {
	const symbolMap = buildSymbolMap(symbols);

	// ── Build directory tree ──────────────────────────────────────────
	const root: DirTree = createDirTree(".", ".");

	for (const file of files) {
		const normalized = normalizeFilePath(file.file_path);
		const parts = normalized.split("/");

		let current = root;
		for (let i = 0; i < parts.length - 1; i++) {
			const dirName = parts[i];
			const dirPath = parts.slice(0, i + 1).join("/");
			let subdir = current.subdirs.get(dirName);
			if (!subdir) {
				subdir = createDirTree(dirName, dirPath);
				current.subdirs.set(dirName, subdir);
			}
			current = subdir;
		}

		current.files.push(file);
	}

	// ── Convert tree to DirectoryNode ─────────────────────────────────
	const rootNode = dirTreeToNode(root, 0, depth, symbolMap);

	// ── Language breakdown ────────────────────────────────────────────
	const languageBreakdown: Record<string, number> = {};
	for (const file of files) {
		const lang = file.language ?? "unknown";
		languageBreakdown[lang] = (languageBreakdown[lang] ?? 0) + 1;
	}

	// ── Top-level exports ─────────────────────────────────────────────
	const topLevelExports = symbols
		.filter((s) => s.exported && s.parent_symbol_id === null)
		.slice(0, topLevelExportsLimit);

	// ── Summary ───────────────────────────────────────────────────────
	const summary: ArchitectureSummary = {
		totalFiles: files.length,
		totalSymbols: symbols.length,
		languageBreakdown,
		topLevelExports
	};

	return { root: rootNode, summary };
}
