/**
 * Unified write tool for codebase index.
 * Canonical name: `codebase-index`.
 * Delegates to the existing handleCodebaseIndexRepository.
 */
import type { McpResponse } from "../utils/mcp-response";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { handleCodebaseIndexRepository } from "./codebase-index";

export async function handleCodebaseIndex(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	return handleCodebaseIndexRepository(params, db, vectors);
}
