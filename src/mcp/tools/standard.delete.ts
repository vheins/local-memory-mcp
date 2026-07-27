import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { UUID_REGEX } from "../utils/uuid";
import { StandardDeleteSchema } from "./schemas";

export async function handleStandardDelete(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardDeleteSchema.parse(params);
	const { id, ids, code, codes, owner, repo, json } = validated;

	// Resolve all identifiers to UUIDs
	const resolvedIds: string[] = [];

	// Helper: resolve a single identifier (UUID or code) to UUID
	function resolveIdentifier(identifier: string): string {
		if (UUID_REGEX.test(identifier)) return identifier;
		const entry = db.standards.getByCode(identifier, owner, repo);
		if (!entry) throw new Error(`Coding standard not found: ${identifier}`);
		return entry.id;
	}

	// Single identifier: id (UUID or code — auto-inferred)
	if (id) {
		resolvedIds.push(resolveIdentifier(id));
	}

	// Single code
	if (code) {
		resolvedIds.push(resolveIdentifier(code));
	}

	// Bulk identifiers: ids (array of UUIDs or codes — auto-inferred per item)
	if (ids) {
		for (const item of ids) {
			resolvedIds.push(resolveIdentifier(item));
		}
	}

	// Bulk codes
	if (codes) {
		for (const c of codes) {
			resolvedIds.push(resolveIdentifier(c));
		}
	}

	// Fetch standards to verify existence and collect metadata for response
	const existingStandards = db.standards.getByIds(resolvedIds);
	const standardMap = new Map(existingStandards.map((s) => [s.id, s]));
	const deletedTitles: string[] = [];
	const validIdsToDelete: string[] = [];

	let lastRepo = repo || "unknown";

	for (const targetId of resolvedIds) {
		const existing = standardMap.get(targetId);
		if (existing) {
			lastRepo = existing.repo || (existing.is_global ? "global" : lastRepo);
			deletedTitles.push(existing.title);
			validIdsToDelete.push(targetId);
		} else {
			throw new Error(`Coding standard not found: ${targetId}`);
		}
	}

	let deletedCount = 0;

	if (validIdsToDelete.length > 0) {
		for (const validId of validIdsToDelete) {
			// Hard-delete the standard
			db.standards.delete(validId);

			// Remove vector embedding
			await vectors.remove(validId, "standard");

			// KG cleanup: best-effort cascade delete (REFACTOR-KG-006)
			const standardEntry = standardMap.get(validId);
			if (standardEntry) {
				try {
					db.db
						.prepare(`DELETE FROM observations WHERE observation = ?`)
						.run(`Mentioned in memory: ${standardEntry.title}`);
					db.db.prepare(`DELETE FROM entities WHERE name NOT IN (SELECT DISTINCT entity_name FROM observations)`).run();
				} catch (kgError) {
					logger.warn("[KG-Cleanup] Failed to clean up KG entities for deleted standard", {
						standardId: validId,
						error: String(kgError)
					});
				}
			}
		}
		deletedCount = validIdsToDelete.length;
	}

	logger.info("[Tool] standard.delete", { repo: lastRepo, count: deletedCount });

	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
			ids: ids || undefined,
			repo: lastRepo,
			deletedCount,
			deletedTitles: deletedTitles.length > 10 ? [...deletedTitles.slice(0, 10), "..."] : deletedTitles
		},
		`Deleted ${deletedCount} ${deletedCount === 1 ? "standard" : "standards"} from repo "${lastRepo}".`,
		{
			structuredContentPathHint: "deletedCount",
			includeJson: json
		}
	);
}
