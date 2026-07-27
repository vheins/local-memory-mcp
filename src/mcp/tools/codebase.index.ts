/**
 * codebase-index — unified write + status for the codebase index.
 *
 * Per ADR-005: "Zero oneOf — auto-infer dari parameter mana yang diisi"
 *
 * Auto-infer rules:
 *   repoPath + repo → INDEX  (trigger tree-sitter scan)
 *   repo saja        → STATUS (check freshness + count)
 */

import { z } from "zod";
import type { McpResponse } from "../utils/mcp-response";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { normalizeRepo } from "../utils/normalize";
import { handleCodebaseIndexRepository, handleCodebaseIndexStatus } from "./codebase-index";
import { logger } from "../utils/logger";

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

export const CodebaseIndexSchema = z.object({
	owner: z.string().min(1).optional(),
	repo: z.string().min(1).transform(normalizeRepo),
	repoPath: z.string().optional(),
	force: z.boolean().optional(),
	includeGlobs: z.array(z.string()).optional(),
	excludeGlobs: z.array(z.string()).optional()
});

export type CodebaseIndexInput = z.infer<typeof CodebaseIndexSchema>;

type CodebaseIndexMode = "index" | "status";

// ═══════════════════════════════════════════════════════════════════════════
// MODE INFERENCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determine which mode to run based on the provided parameters.
 *
 * ADR-005 auto-infer rules:
 * 1. `repoPath` + `repo` → INDEX (trigger tree-sitter scan)
 * 2. `repo` saja          → STATUS (check freshness + count)
 */
function inferMode(params: CodebaseIndexInput): CodebaseIndexMode {
	if (params.repoPath) return "index";
	return "status";
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Unified codebase-index handler.
 *
 * Auto-infers the mode from the provided parameters per ADR-005 rules:
 * - `repoPath` + `repo` → INDEX (trigger tree-sitter scan)
 * - `repo` saja          → STATUS (check freshness + count)
 *
 * Old tool name `index_repository` routes here for backward compatibility.
 */
export async function handleCodebaseIndex(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = CodebaseIndexSchema.parse(params);
	const mode = inferMode(validated);

	logger.info("[Tool] codebase-index", {
		repo: validated.repo,
		mode
	});

	switch (mode) {
		case "index":
			return handleCodebaseIndexRepository(params, db, vectors);
		case "status":
			return handleCodebaseIndexStatus(params, db, vectors);
	}
}
