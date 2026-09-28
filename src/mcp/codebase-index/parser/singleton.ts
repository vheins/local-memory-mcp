import type { ParserPool } from "./language-visitor";
import { TreeSitterParserPool } from "./parser-pool";

let parserPool: ParserPool | null = null;

/** Process-wide parser pool shared by startup, watcher, tool, and dashboard calls. */
export function getCodebaseParserPool(): ParserPool {
	parserPool ??= new TreeSitterParserPool();
	return parserPool;
}

/** Test-only reset; production holds one pool for the process lifetime. */
export function resetCodebaseParserPool(): void {
	parserPool = null;
}

/**
 * Stop the process-wide parser pool and release its worker threads
 * (FEAT-DAEMON-002C). Idempotent and safe when no pool was ever created. The
 * daemon may call this during graceful shutdown; tests use it to avoid leaking
 * worker threads across files.
 */
export async function closeCodebaseParserPool(): Promise<void> {
	const pool = parserPool as (TreeSitterParserPool & { close?: () => Promise<void> }) | null;
	parserPool = null;
	if (pool && typeof pool.close === "function") {
		await pool.close();
	}
}
