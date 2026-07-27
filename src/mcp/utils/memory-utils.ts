import { UUID_REGEX } from "./uuid";
import { SQLiteStore } from "../storage/sqlite";

/**
 * Checks if a title appears to contain metadata (agent/role/model/date/source metadata patterns).
 * Returns true if the title starts with a bracket-enclosed metadata pattern.
 */
export function hasMetadataLikeTitle(title: string): boolean {
	const normalized = title.trim();
	return /^\[[^\]]{0,200}(agent:|role:|model:|\d{4}-\d{2}-\d{2}|source_)[^\]]*\]/i.test(normalized);
}

/**
 * Resolves a supersedes value to a memory UUID.
 *
 * - If the value is null/undefined → returns null
 * - If the value is already a UUID → returns it as-is
 * - If the value is a code → looks up the memory by code and returns its id
 *
 * @throws If the code does not resolve to an existing memory
 */
export function resolveMemorySupersedes(
	value: string | null | undefined,
	db: SQLiteStore,
	owner?: string,
	repo?: string
): string | null {
	if (!value) return null;
	if (UUID_REGEX.test(value)) return value;
	const memory = db.memories.getByCode(value, owner, repo);
	if (!memory) throw new Error(`supersedes: memory with code '${value}' not found`);
	return memory.id;
}
