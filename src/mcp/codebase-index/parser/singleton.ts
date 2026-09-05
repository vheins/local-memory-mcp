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
