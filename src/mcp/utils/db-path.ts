/**
 * Resolve the memory database path (single source of truth).
 *
 * `SQLiteStore` opens this file, and the daemon-start takeover probe
 * (`cli/dashboard-takeover.ts`, FIX-009) checks the matching `memory.db.lock`,
 * so both must resolve the path with the SAME rules. Lives in `utils/` (Node
 * built-ins only) so the takeover can resolve it without importing the SQLite
 * storage module.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Resolve the memory database path.
 *
 * Precedence: explicit `MEMORY_DB_PATH` → existing platform-standard
 * `<configDir>/memory.db` → legacy `~/.config/local-memory-mcp/memory.db` →
 * existing `./storage/memory.db` in the CWD → the platform-standard path
 * (created on first write).
 */
export function resolveDbPath(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform
): string {
	if (env.MEMORY_DB_PATH) return env.MEMORY_DB_PATH;

	const home = os.homedir();
	const standardConfigDir =
		platform === "win32"
			? path.join(home, ".local-memory-mcp")
			: platform === "darwin"
				? path.join(home, "Library", "Application Support", "local-memory-mcp")
				: path.join(home, ".config", "local-memory-mcp");

	const standardPath = path.join(standardConfigDir, "memory.db");
	if (fs.existsSync(standardPath)) return standardPath;

	const legacyPath = path.join(home, ".config", "local-memory-mcp", "memory.db");
	if (fs.existsSync(legacyPath)) return legacyPath;

	const localCwdFile = path.join(process.cwd(), "storage", "memory.db");
	if (fs.existsSync(localCwdFile)) return localCwdFile;

	return standardPath;
}
