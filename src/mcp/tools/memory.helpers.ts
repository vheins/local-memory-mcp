import { UUID_REGEX } from "../utils/uuid";
import { SQLiteStore } from "../storage/sqlite";

/**
 * Check if a title looks like it contains metadata rather than a concise summary.
 * Allowed patterns: [agent:...], [role:...], [model:...], [YYYY-MM-DD...], [source_...]
 * This prevents agents from stuffing structured data into the title field.
 */
export function hasMetadataLikeTitle(title: string): boolean {
	const normalized = title.trim();
	return /^\[[^\]]{0,200}(agent:|role:|model:|\d{4}-\d{2}-\d{2}|source_)[^\]]*\]/i.test(normalized);
}

/**
 * Resolve a supersedes value to a memory UUID.
 *
 * - If `value` is null/undefined → returns null
 * - If `value` is a valid UUID → returns it as-is
 * - If `value` is a code → looks up the memory by code in the given owner/repo
 * - If the code is not found → throws
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

/**
 * Resolve owner from params or scope, with fallback.
 */
export function resolveOwner(params: { owner?: string; scope?: { owner?: string } }): string {
	return params.owner || params.scope?.owner || "unknown";
}

/**
 * Resolve repo from params or scope, with fallback.
 */
export function resolveRepo(params: { repo?: string; scope?: { repo?: string } }): string {
	return params.repo || params.scope?.repo || "unknown";
}
