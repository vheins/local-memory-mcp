import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { collectEntityIds } from "../utils/auto-infer";
import { purgeEntityAndCleanup } from "../utils/purge-entity-cleanup";
import { logger } from "../utils/logger";
import { StandardDeleteSchema } from "./schemas";

export async function handleStandardDelete(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardDeleteSchema.parse(params);
	const { id, ids, codes, owner, repo, json } = validated;

	// Resolve all identifiers (id/code/ids/codes — UUID or code, auto-inferred
	// per item) to UUIDs via the shared helper (OPT-DRY-06). Replaces the
	// hand-rolled resolveIdentifier closure and its `?? ""` sentinel.
	const resolvedIds = collectEntityIds(validated, "standard", db, { owner, repo });

	// Fetch standards to verify existence and collect metadata for response
	const existingStandards = db.standards.getByIds(resolvedIds);
	const standardMap = new Map(existingStandards.map((s) => [s.id, s]));
	const deletedTitles: string[] = [];
	const deletedCodes: string[] = [];
	const validIdsToDelete: string[] = [];

	let lastRepo = repo || "unknown";
	const deleteErrors: { identifier: string; error: string }[] = [];
	const isBulk = (ids && ids.length > 1) || (codes && codes.length > 1);

	for (const targetId of resolvedIds) {
		const existing = standardMap.get(targetId);
		if (existing) {
			lastRepo = existing.repo || (existing.is_global ? "global" : lastRepo);
			deletedTitles.push(existing.title);
			if (existing.code) deletedCodes.push(existing.code);
			validIdsToDelete.push(targetId);
		} else if (isBulk) {
			deleteErrors.push({ identifier: targetId, error: "Coding standard not found" });
		} else {
			throw new Error(`Coding standard not found: ${targetId}`);
		}
	}

	let deletedCount = 0;

	if (validIdsToDelete.length > 0) {
		// Shared purge + cleanup contract (OPT-DRY-03): hard delete + queue_jobs
		// purge + vector removal + repo-scoped KG cleanup, identical to the
		// memory/task delete tools.
		await purgeEntityAndCleanup(
			db,
			"standard",
			validIdsToDelete.map((id) => {
				const standard = standardMap.get(id);
				return standard ? { id, title: standard.title, repo: standard.repo ?? "" } : { id };
			})
		);
		deletedCount = validIdsToDelete.length;
	}

	const allOk = deleteErrors.length === 0;

	logger.info("[Tool] standard.delete", {
		repo: lastRepo,
		count: deletedCount,
		...(deleteErrors.length > 0 ? { errors: deleteErrors.length } : {})
	});

	const codeSample =
		deletedCodes.length <= 3
			? deletedCodes.join(", ")
			: `${deletedCodes.slice(0, 3).join(", ")}, ... (${deletedCodes.length} total)`;

	const responseData: Record<string, unknown> = {
		success: allOk,
		id: id || undefined,
		ids: ids || undefined,
		repo: lastRepo,
		deletedCount,
		deletedCodes: deletedCodes.length > 10 ? [...deletedCodes.slice(0, 10), "..."] : deletedCodes,
		deletedTitles: deletedTitles.length > 10 ? [...deletedTitles.slice(0, 10), "..."] : deletedTitles
	};

	if (deleteErrors.length > 0) {
		responseData.errors = deleteErrors;
		responseData.totalAttempted = resolvedIds.length;
	}

	return createMcpResponse(
		responseData,
		`Deleted ${deletedCount} ${deletedCount === 1 ? "standard" : "standards"} from "${lastRepo}"${deletedCodes.length > 0 ? `: ${codeSample}` : ""}${deleteErrors.length > 0 ? ` (${deleteErrors.length} failed)` : ""}.`,
		{
			includeJson: json
		}
	);
}
