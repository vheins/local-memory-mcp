import { SQLiteStore } from "../storage/sqlite";
import { VectorStore, MEMORY_STATUS_ARCHIVED } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { collectEntityIds } from "../utils/auto-infer";
import { logger } from "../utils/logger";
import { observationText } from "./kg-archivist";
import { MemoryDeleteSchema } from "./schemas";

export async function handleMemoryDelete(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore,
	onProgress?: (progress: number, total?: number) => void
): Promise<McpResponse> {
	const validated = MemoryDeleteSchema.parse(params);
	const { id, ids, owner, repo, json } = validated;

	// Resolve all identifiers (id/code/ids/codes — UUID or code, auto-inferred
	// per item) to UUIDs via the shared helper (OPT-DRY-06). Replaces the
	// hand-rolled resolveIdentifier closure and its `?? ""` sentinel.
	const resolvedIds = collectEntityIds(validated, "memory", db, { owner, repo });

	if (resolvedIds.length === 0) {
		throw new Error("At least one of 'id', 'code', 'ids', or 'codes' must be provided for deletion");
	}

	// Fetch memories to verify existence and collect metadata for response
	const existingMemories = db.memories.getByIds(resolvedIds);
	const memoryMap = new Map(existingMemories.map((m) => [m.id, m]));
	const deletedCodes: string[] = [];
	const validIdsToDelete: string[] = [];
	const skippedErrors: { identifier: string; error: string }[] = [];

	let lastRepo = repo || "unknown";

	for (const targetId of resolvedIds) {
		const existing = memoryMap.get(targetId);
		if (existing) {
			lastRepo = existing.scope.repo;
			deletedCodes.push(existing.code || existing.id);
			validIdsToDelete.push(targetId);
		} else {
			const msg = `Memory not found: ${targetId}`;
			// Partial execution for bulk — warn and skip instead of throw
			logger.warn("[Tool] memory.delete — skipping not found", { targetId });
			skippedErrors.push({ identifier: targetId, error: msg });
		}
	}

	let deletedCount = 0;
	const total = validIdsToDelete.length;
	let progress = 0;

	if (validIdsToDelete.length > 0) {
		// Archive + purge pending embedding-queue jobs in ONE transaction — a
		// stale queue_jobs row could otherwise re-embed the vector and re-run
		// KG extraction for an archived memory (TASK-042 / MEM-427).
		db.db
			.transaction(() => {
				db.memories.bulkUpdateMemories(validIdsToDelete, { status: MEMORY_STATUS_ARCHIVED });
				const placeholders = validIdsToDelete.map(() => "?").join(",");
				db.db
					.prepare(`DELETE FROM queue_jobs WHERE entity_kind = ? AND entity_id IN (${placeholders})`)
					.run("memory", ...validIdsToDelete);
			})
			.immediate();

		// Collect observation texts for batch KG cleanup (once per batch, not per
		// item) — each (text, repo) pair is scoped to the memory's own repo so
		// identical titles across repos never cross-delete (TASK-045/043).
		const observationTexts: { text: string; repo: string }[] = [];

		for (const validId of validIdsToDelete) {
			if (onProgress) {
				onProgress(progress, total);
			}
			await vectors.remove(validId, "memory");

			const memoryEntry = memoryMap.get(validId);
			if (memoryEntry) {
				observationTexts.push({
					text: observationText("memory", memoryEntry.title),
					repo: memoryEntry.scope.repo
				});
			}
			progress++;
		}

		// KG cleanup: best-effort, atomic (single transaction), orphans checked
		// via observations UNION relations so relation-referenced entities are
		// KEPT; observation deletes + orphan sweep scoped to the touched
		// repo(s) (TASK-043).
		try {
			db.knowledgeGraph.deleteObservationsAndOrphans(observationTexts);
		} catch (kgError) {
			logger.warn("[KG-Cleanup] Failed to clean up KG entities for deleted memories", {
				error: String(kgError)
			});
		}

		deletedCount = validIdsToDelete.length;
	}

	if (onProgress) {
		onProgress(progress, total);
	}

	logger.info("[Tool] memory.delete", { repo: lastRepo, count: deletedCount });

	const skippedCount = skippedErrors.length;
	// success is false only when nothing was deleted and there were errors
	const overallSuccess = deletedCount > 0 || skippedCount === 0;

	const codeSample =
		deletedCodes.length <= 5
			? deletedCodes.join(", ")
			: `${deletedCodes.slice(0, 3).join(", ")}, ... (${deletedCodes.length} total)`;

	return createMcpResponse(
		{
			success: overallSuccess,
			id: id || undefined,
			ids: ids || undefined,
			repo: lastRepo,
			deletedCount,
			deletedCodes: deletedCount > 10 ? [...deletedCodes.slice(0, 10), "..."] : deletedCodes,
			...(skippedCount > 0 ? { skippedCount, errors: skippedErrors } : {})
		},
		`Deleted ${deletedCount} ${deletedCount === 1 ? "memory" : "memories"} from "${lastRepo}"${deletedCount > 0 ? `: ${codeSample}` : ""}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}.`,
		{
			structuredContentPathHint: deletedCount > 0 ? "deletedCount" : "errors",
			includeJson: json
		}
	);
}
