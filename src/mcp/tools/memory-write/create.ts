import { MemoryWriteSchema } from "../schemas";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";
import { logger } from "../../utils/logger";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { saveExtractions } from "../kg-archivist";
import { hasMetadataLikeTitle, resolveMemorySupersedes } from "../../utils/memory-utils";
import { applyDecisionFields, applySessionFields, buildMemoryEntry, checkCreateConflict } from "./helpers";

// ── Single CREATE ────────────────────────────────────────────────────────

export async function handleCreate(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore,
	json: boolean
): Promise<McpResponse> {
	// Apply convenience helpers before validation
	applyDecisionFields(params);
	applySessionFields(params);

	const parsed = MemoryWriteSchema.parse(params) as Record<string, unknown>;

	// Title metadata check
	const title = (parsed.title ?? "") as string;
	if (hasMetadataLikeTitle(title)) {
		throw new Error(
			"Title appears to contain metadata. Keep title concise and move agent/role/date details into metadata or dedicated fields."
		);
	}

	const type = parsed.type as string;
	const isTaskArchive = type === "task_archive";
	const scope = (parsed.scope as Record<string, unknown>) ?? {};
	const owner = (parsed.owner as string) ?? (scope.owner as string) ?? "unknown";
	const repo = (parsed.repo as string) ?? (scope.repo as string) ?? "unknown";

	// Check for resolved supersedes to decide
	const resolvedSupersedes = resolveMemorySupersedes(parsed.supersedes as string | null | undefined, db, owner, repo);

	// Conflict check
	const { conflict, response: conflictResponse } = await checkCreateConflict(
		parsed as unknown as Record<string, unknown>,
		db,
		vectors,
		isTaskArchive,
		resolvedSupersedes,
		json
	);
	if (conflict) {
		return conflictResponse!;
	}

	// Archive the superseded memory
	if (resolvedSupersedes) {
		const oldMemory = db.memories.getById(resolvedSupersedes);
		if (oldMemory) {
			db.memories.update(oldMemory.id, { status: "archived" });
		}
	}

	const now = new Date().toISOString();
	const entry = buildMemoryEntry(parsed as unknown as Record<string, unknown>, db, vectors, now);

	db.memories.insert(entry);

	// Vector upsert (non-critical)
	try {
		await vectors.upsert(entry.id, entry.content);
	} catch (error) {
		logger.warn("Failed to generate vector embedding", { error: String(error) });
	}

	// NLP entity extraction (non-critical)
	try {
		await saveExtractions(entry.content, entry.title, entry.scope.owner, entry.scope.repo, db);
	} catch (error) {
		logger.warn("[KG-Archivist] NLP extraction failed, memory stored without KG enrichment", {
			error: String(error)
		});
	}

	return createMcpResponse(
		{
			success: true,
			id: entry.id,
			code: entry.code,
			repo: entry.scope.repo,
			type: entry.type,
			title: entry.title,
			importance: entry.importance
		},
		`Stored [${entry.code}] "${entry.title}" in repo "${entry.scope.repo}".`,
		{
			contentSummary: `Stored [${entry.code}] "${entry.title}" in repo "${entry.scope.repo}".`,
			structuredContentPathHint: "code",
			includeJson: json
		}
	);
}
