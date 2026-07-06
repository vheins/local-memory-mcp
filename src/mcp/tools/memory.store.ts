import { randomUUID } from "crypto";
import { MemoryStoreSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore, MemoryEntry } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { generateNextCode } from "../utils/code-generator";
import { saveExtractions } from "./kg-archivist";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasMetadataLikeTitle(title: string): boolean {
	const normalized = title.trim();
	return /^\[[^\]]{0,200}(agent:|role:|model:|\d{4}-\d{2}-\d{2}|source_)[^\]]*\]/i.test(normalized);
}

function resolveMemorySupersedes(
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

async function storeSingleMemory(
	params: {
		code?: string;
		type: string;
		title: string;
		content: string;
		importance: number;
		agent: string;
		role: string;
		model: string;
		scope: { owner?: string; repo: string; branch?: string; folder?: string; language?: string };
		ttlDays?: number;
		supersedes?: string;
		tags?: string[];
		metadata?: Record<string, unknown>;
		is_global: boolean;
		structured: boolean;
	},
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	if (hasMetadataLikeTitle(params.title)) {
		throw new Error(
			"Title appears to contain metadata. Keep title concise and move agent/role/date details into metadata or dedicated fields."
		);
	}

	const now = new Date().toISOString();
	const createdAtTime = new Date(now).getTime();
	const expires_at = params.ttlDays != null ? new Date(createdAtTime + params.ttlDays * 86400000).toISOString() : null;

	const resolvedSupersedes = resolveMemorySupersedes(params.supersedes, db, params.scope.owner, params.scope.repo);

	if (!resolvedSupersedes && params.type !== "task_archive") {
		const conflict = await db.memoryVectors.checkConflicts(
			params.content,
			params.scope.owner!,
			params.scope.repo,
			params.type,
			vectors,
			0.55
		);
		if (conflict) {
			return createMcpResponse(
				{
					success: false,
					error: "MEMORY_CONFLICT",
					message: `This memory content overlaps significantly with an existing memory (ID: ${conflict.id}).`,
					conflicting_memory: { id: conflict.id, title: conflict.title, content: conflict.content },
					instruction:
						"Use 'memory-update' on the existing ID, or provide 'supersedes' if this new memory replaces it. If the old memory is no longer relevant, you can delete it first."
				},
				`Rejected due to conflict: "${conflict.title}" (${conflict.id.slice(0, 8)}...). Hint: Use 'supersedes' if this replaces the old memory, or 'memory-update' if updating. If no longer relevant, delete first.`
			);
		}
	}

	if (resolvedSupersedes) {
		const oldMemory = db.memories.getById(resolvedSupersedes);
		if (oldMemory) {
			db.memories.update(oldMemory.id, { status: "archived" });
		}
	}

	const tags = params.tags ?? [];
	if (params.scope.language && !tags.includes(params.scope.language.toLowerCase())) {
		tags.push(params.scope.language.toLowerCase());
	}

	const entry: MemoryEntry = {
		id: randomUUID(),
		code: params.code || generateNextCode(params.scope.owner ?? "", params.scope.repo, "memory", db),
		type: params.type as MemoryEntry["type"],
		title: params.title,
		content: params.content,
		importance: params.importance,
		agent: params.agent,
		role: params.role,
		model: params.model,
		scope: { ...params.scope, owner: params.scope.owner! },
		created_at: now,
		updated_at: now,
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at,
		supersedes: resolvedSupersedes,
		status: "active",
		tags,
		metadata: params.metadata ?? {},
		is_global: params.is_global
	};

	db.memories.insert(entry);

	try {
		await vectors.upsert(entry.id, entry.content);
	} catch (error) {
		logger.warn("Failed to generate vector embedding", { error: String(error) });
	}

	// Auto-extract entities and observations via NLP archivist
	try {
		saveExtractions(entry.content, entry.title, entry.scope.owner, entry.scope.repo, db);
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
			title: entry.title
		},
		`Stored [${entry.code}] "${entry.title}" in repo "${entry.scope.repo}".`,
		{
			contentSummary: `Stored [${entry.code}] "${entry.title}" in repo "${entry.scope.repo}".`,
			structuredContentPathHint: "code",
			includeSerializedStructuredContent: params.structured
		}
	);
}

export async function handleMemoryStore(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = MemoryStoreSchema.parse(params);

	// Bulk mode — collect entries first, then batch insert
	if (validated.memories) {
		const now = new Date().toISOString();
		const entries: MemoryEntry[] = [];
		const storedCodes: string[] = [];
		const batchCodes = new Set<string>();

		for (const mem of validated.memories) {
			if (hasMetadataLikeTitle(mem.title)) {
				throw new Error(
					"Title appears to contain metadata. Keep title concise and move agent/role/date details into metadata or dedicated fields."
				);
			}

			const createdAtTime = new Date(now).getTime();
			const expires_at = mem.ttlDays != null ? new Date(createdAtTime + mem.ttlDays * 86400000).toISOString() : null;

			const resolvedSupersedes = resolveMemorySupersedes(mem.supersedes, db, mem.scope.owner, mem.scope.repo);

			if (!resolvedSupersedes && mem.type !== "task_archive") {
				const conflict = await db.memoryVectors.checkConflicts(
					mem.content,
					mem.scope.owner!,
					mem.scope.repo,
					mem.type,
					vectors,
					0.55
				);
				if (conflict) {
					return createMcpResponse(
						{
							success: false,
							error: "MEMORY_CONFLICT",
							message: `This memory content overlaps significantly with an existing memory (ID: ${conflict.id}).`,
							conflicting_memory: { id: conflict.id, title: conflict.title, content: conflict.content },
							instruction:
								"Use 'memory-update' on the existing ID, or provide 'supersedes' if this new memory replaces it."
						},
						`Rejected due to conflict: "${conflict.title}" (${conflict.id.slice(0, 8)}...). Hint: Use 'supersedes' or 'memory-update'.`
					);
				}
			}

			if (resolvedSupersedes) {
				const oldMemory = db.memories.getById(resolvedSupersedes);
				if (oldMemory) {
					db.memories.update(oldMemory.id, { status: "archived" });
				}
			}

			const tags = mem.tags ?? [];
			if (mem.scope.language && !tags.includes(mem.scope.language.toLowerCase())) {
				tags.push(mem.scope.language.toLowerCase());
			}

			const code = mem.code || generateNextCode(mem.scope.owner ?? "", mem.scope.repo, "memory", db, batchCodes);
			batchCodes.add(code);
			entries.push({
				id: randomUUID(),
				code,
				type: mem.type as MemoryEntry["type"],
				title: mem.title,
				content: mem.content,
				importance: mem.importance,
				agent: mem.agent,
				role: mem.role as string,
				model: mem.model,
				scope: { ...mem.scope, owner: mem.scope.owner! },
				created_at: now,
				updated_at: now,
				completed_at: null,
				hit_count: 0,
				recall_count: 0,
				last_used_at: null,
				expires_at,
				supersedes: resolvedSupersedes,
				status: "active",
				tags,
				metadata: mem.metadata ?? {},
				is_global: mem.is_global
			});
			storedCodes.push(code);
		}

		// Batch insert: single transaction instead of N individual inserts
		db.memories.bulkInsertMemories(entries);

		// Vector upserts per-item (async, can't easily batch)
		for (const entry of entries) {
			try {
				await vectors.upsert(entry.id, entry.content);
			} catch (error) {
				logger.warn("Failed to generate vector embedding", { error: String(error) });
			}

			// Auto-extract entities and observations via NLP archivist
			try {
				saveExtractions(entry.content, entry.title, entry.scope.owner, entry.scope.repo, db);
			} catch (error) {
				logger.warn("[KG-Archivist] NLP extraction failed, memory stored without KG enrichment", {
					error: String(error)
				});
			}
		}

		const codesStr = storedCodes.length > 0 ? `: ${storedCodes.join(", ")}` : "";
		return createMcpResponse(
			{
				success: true,
				repo: validated.memories[0]?.scope.repo,
				createdCount: validated.memories.length,
				codes: storedCodes
			},
			`Stored ${validated.memories.length} memories${codesStr}.`,
			{ includeSerializedStructuredContent: validated.structured }
		);
	}

	// Single mode
	return storeSingleMemory(
		{
			code: validated.code,
			type: validated.type!,
			title: validated.title!,
			content: validated.content!,
			importance: validated.importance!,
			agent: validated.agent!,
			role: validated.role!,
			model: validated.model!,
			scope: validated.scope!,
			ttlDays: validated.ttlDays,
			supersedes: validated.supersedes,
			tags: validated.tags,
			metadata: validated.metadata,
			is_global: validated.is_global,
			structured: validated.structured
		},
		db,
		vectors
	);
}
