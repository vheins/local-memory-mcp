import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { Task, TaskStatus, TaskPriority, VectorStore } from "../../types";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { logger } from "../../utils/logger";
import { UUID_REGEX } from "../../utils/uuid";
import { resolveEntityCode } from "../../utils/code-generator";
import { resolveParentId, resolveDependsOn, deriveTaskStatusTimestamps, archiveTaskToMemory } from "../task.helpers";
import { saveExtractions, saveTaskRelations } from "../kg-archivist";
import { extractAcceptedElicitationContent, type ElicitationRequestHandler } from "../../elicitation";
import { applyDecisionRefs, tryVectorEmbedding } from "./effects";
import { validateStatusTransition, validateBulkStatus } from "./state-machine";
import { handleCreateSingle } from "./create";
import { ItemInfer, TaskWriteOptions, WriteParams } from "./types";

// ---------------------------------------------------------------------------
// Item mode inference
// ---------------------------------------------------------------------------

/**
 * Infers whether a bulk item is a CREATE or UPDATE.
 * - If the item has an `id` (UUID), it's always an UPDATE.
 * - If `code` is set but none of the required CREATE fields (phase, title, description) are present,
 *   it's an UPDATE (e.g., status-only update).
 * - Otherwise (has phase + title + description, with or without code), it's a CREATE.
 */
export function inferItemMode(item: Record<string, unknown>): ItemInfer {
	if (item.id) return "update";
	// If code is present but we lack the mandatory create fields → update
	if (item.code && !item.phase && !item.title && !item.description) return "update";
	return "create";
}

// ---------------------------------------------------------------------------
// Interactive (Elicitation) — build schema
// ---------------------------------------------------------------------------

function addRequiredStringField(
	properties: Record<string, unknown>,
	required: string[],
	task: Record<string, unknown>,
	field: string,
	schema: Record<string, unknown>
) {
	if (typeof task[field] === "string" && (task[field] as string).trim()) {
		return;
	}
	properties[field] = {
		type: "string",
		...schema
	};
	required.push(field);
}

function buildMissingTaskSchema(task: Record<string, unknown>) {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	addRequiredStringField(properties, required, task, "repo", {
		title: "Repository",
		description: "Name of the repository for this task.",
		minLength: 1
	});
	addRequiredStringField(properties, required, task, "phase", {
		title: "Phase",
		description: "Project phase or milestone for this task.",
		minLength: 1
	});
	addRequiredStringField(properties, required, task, "title", {
		title: "Title",
		description: "Short task title.",
		minLength: 3,
		maxLength: 100
	});
	addRequiredStringField(properties, required, task, "description", {
		title: "Description",
		description:
			"Detailed description. MUST follow format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification",
		minLength: 1
	});

	if (!task.status) {
		properties.status = {
			type: "string",
			title: "Status",
			description: "Initial task status.",
			enum: ["backlog", "pending"],
			default: "backlog"
		};
	}

	if (task.priority === undefined) {
		properties.priority = {
			type: "integer",
			title: "Priority",
			description: "Task priority from 1 to 5.",
			minimum: 1,
			maximum: 5,
			default: 3
		};
	}

	return {
		type: "object" as const,
		properties,
		required
	};
}

export async function handleInteractive(
	params: WriteParams,
	storage: SQLiteStore,
	vectors: VectorStore,
	options: TaskWriteOptions
): Promise<McpResponse> {
	if (!options.session?.supportsElicitationForm || !options.elicit) {
		throw new Error(
			"Client does not advertise MCP elicitation form support. Provide all required fields directly: phase, title, description."
		);
	}

	const draft: Record<string, unknown> = {
		...(params as unknown as Record<string, unknown>),
		repo: params.repo || options.session?.repo || ""
	};

	const requestedSchema = buildMissingTaskSchema(draft);
	let completedDraft = draft;

	if (Object.keys(requestedSchema.properties).length > 0) {
		const elicited = extractAcceptedElicitationContent(
			await options.elicit({
				mode: "form",
				message: "Please complete the missing task details to create a new task.",
				requestedSchema
			})
		);

		completedDraft = {
			...draft,
			...elicited
		};
	}

	// Now proceed with create using completed data
	const createParams: WriteParams = {
		...params,
		owner: params.owner || (completedDraft.owner as string) || "",
		repo: params.repo || (completedDraft.repo as string) || "",
		phase: completedDraft.phase as string,
		title: completedDraft.title as string,
		description: completedDraft.description as string,
		status: (completedDraft.status as TaskStatus) || "backlog",
		priority: (completedDraft.priority as number) || 3,
		json: true
	};

	return handleCreateSingle(createParams, storage, vectors);
}

// ---------------------------------------------------------------------------
// BULK — each item infers create vs update independently
// ---------------------------------------------------------------------------

export async function handleBulk(
	params: WriteParams,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const items = params.tasks ?? [];
	const results: Record<string, unknown>[] = [];
	const owner = params.owner;
	const repo = params.repo;

	const initialStats = storage.taskStats.getTaskStats(owner, repo);
	let pendingInRequestCount = 0;
	const codesInRequest = new Set<string>();
	const batchCodes = new Set<string>();

	// Pre-generate UUIDs and build local code→UUID map for cross-reference resolution
	const localCodeMap = new Map<string, string>();
	for (const taskData of items) {
		const tc = (taskData.code as string) || (taskData.id as string) || "";
		if (tc) localCodeMap.set(tc, randomUUID());
		if (!tc) localCodeMap.set("__create_" + Math.random().toString(36).slice(2, 8), randomUUID());
	}

	for (let i = 0; i < items.length; i++) {
		const raw = items[i];
		const mode = inferItemMode(raw);

		try {
			if (mode === "update") {
				// ── Update item ──
				const itemCode = raw.code as string | undefined;
				const itemId = raw.id as string | undefined;

				// Resolve to UUID
				let resolvedId: string | undefined;
				if (itemId && UUID_REGEX.test(itemId)) {
					resolvedId = itemId;
				} else if (itemCode) {
					const found = storage.tasks.getTaskByCode(owner, repo, itemCode);
					if (!found) throw new Error(`Task not found by code: ${itemCode}`);
					resolvedId = found.id;
				} else if (itemId) {
					const found = storage.tasks.getTaskByCode(owner, repo, itemId);
					if (!found) throw new Error(`Task not found by code: ${itemId}`);
					resolvedId = found.id;
				}

				if (!resolvedId) throw new Error("Cannot update: neither 'id' nor 'code' resolved to an existing task");

				const existing = storage.tasks.getTaskById(resolvedId);
				if (!existing) throw new Error(`Task not found: ${resolvedId}`);

				// Build updates
				const updatableFields = [
					"phase",
					"title",
					"description",
					"status",
					"priority",
					"agent",
					"role",
					"tags",
					"metadata",
					"parent_id",
					"depends_on",
					"est_tokens",
					"commit_id",
					"changed_files",
					"decision_refs"
				] as const;

				const itemUpdates: Record<string, unknown> = {};
				for (const field of updatableFields) {
					if (raw[field] !== undefined) {
						itemUpdates[field] = raw[field];
					}
				}

				if (Object.keys(itemUpdates).length === 0) {
					throw new Error("No updatable fields provided for update item");
				}

				// Handle status transition
				if (itemUpdates.status !== undefined && itemUpdates.status !== existing.status) {
					const err = validateStatusTransition(
						existing.status,
						itemUpdates.status as TaskStatus,
						raw.comment as string | undefined,
						raw.force as boolean | undefined,
						itemUpdates.est_tokens as number | undefined
					);
					if (err) throw new Error(err);

					// Children gate for completed
					if (itemUpdates.status === "completed") {
						const children = storage.tasks.getChildrenByParentId(resolvedId);
						const incomplete = children.filter((c) => c.status !== "completed");
						if (incomplete.length > 0) {
							throw new Error(
								`Cannot complete task [${existing.task_code}] — ${incomplete.length} incomplete child task(s)`
							);
						}
					}
				}

				// Phase tag sync
				if (itemUpdates.phase !== undefined || itemUpdates.tags !== undefined) {
					let currentTags = (itemUpdates.tags as string[]) || (existing.tags as string[]) || [];
					currentTags = currentTags.filter((t: string) => !t.startsWith("phase:"));
					const finalPhase = itemUpdates.phase !== undefined ? (itemUpdates.phase as string) : existing.phase;
					if (finalPhase) {
						const phaseTag = `phase:${finalPhase}`;
						if (!currentTags.includes(phaseTag)) currentTags.push(phaseTag);
					}
					itemUpdates.tags = currentTags;
				}

				// decision_refs
				if (raw.decision_refs !== undefined) {
					const meta = { ...(existing.metadata ?? {}) };
					meta.decision_refs = raw.decision_refs;
					itemUpdates.metadata = meta;
				}

				const now = new Date().toISOString();
				if (itemUpdates.status === "completed") {
					itemUpdates.finished_at = now;
				} else if (itemUpdates.status === "canceled") {
					itemUpdates.canceled_at = now;
				} else if (itemUpdates.status === "in_progress" && existing.status !== "in_progress") {
					itemUpdates.in_progress_at = now;
				}

				storage.tasks.updateTask(resolvedId, itemUpdates);

				// Comment insertion
				if (itemUpdates.status !== undefined && itemUpdates.status !== existing.status) {
					storage.taskComments.insertTaskComment({
						id: randomUUID(),
						task_id: resolvedId,
						owner,
						repo,
						comment: (raw.comment as string) || `Status updated to ${itemUpdates.status}`,
						agent: (raw.agent as string) || existing.agent || "unknown",
						role: (raw.role as string) || existing.role || "unknown",
						model: (raw.model as string) || "unknown",
						previous_status: existing.status as TaskStatus,
						next_status: itemUpdates.status as TaskStatus,
						created_at: now
					});
				}

				// Best-effort vector embedding + KG extraction if title/description changed
				if (itemUpdates.title !== undefined || itemUpdates.description !== undefined) {
					const updatedTask = storage.tasks.getTaskById(resolvedId);
					if (updatedTask) {
						await tryVectorEmbedding(resolvedId, updatedTask.title, updatedTask.description, vectors);
						try {
							await saveExtractions(
								`${updatedTask.title}\n${updatedTask.description ?? ""}`,
								updatedTask.title,
								owner,
								repo,
								storage
							);
						} catch (error) {
							logger.warn("[KG-Archivist] NLP extraction failed for updated task", { error: String(error) });
						}
						try {
							await saveTaskRelations(
								`${updatedTask.title}\n${updatedTask.description ?? ""}`,
								updatedTask.title,
								owner,
								repo,
								storage,
								{
									parentId: updatedTask.parent_id,
									decisionRefs: (updatedTask.metadata?.decision_refs as string[]) ?? undefined
								}
							);
						} catch (error) {
							logger.warn("[KG-Archivist] Task semantic relations failed for updated task", {
								error: String(error)
							});
						}
					}
				}

				// Claims/handoffs cleanup
				if (itemUpdates.status === "completed" || itemUpdates.status === "canceled") {
					storage.handoffs.releaseClaimsForTask(resolvedId);
					storage.handoffs.updatePendingHandoffsForTask(resolvedId, "expired");
				}

				// Async archive for completed
				if (itemUpdates.status === "completed" && existing.status !== "completed") {
					setImmediate(async () => {
						try {
							await archiveTaskToMemory(resolvedId, repo, storage, vectors);
						} catch (err) {
							logger.error("Failed to archive task to memory", { taskId: resolvedId, error: String(err) });
						}
					});
				}

				results.push({
					index: i,
					operation: "update",
					success: true,
					id: resolvedId,
					code: existing.task_code,
					updatedFields: Object.keys(itemUpdates)
				});
			} else {
				// ── Create item ──
				const preferredCode = (raw.code as string) || "";
				if (preferredCode && codesInRequest.has(preferredCode)) {
					throw new Error(`Duplicate task_code in request: '${preferredCode}'`);
				}

				const assignedCode = resolveEntityCode(preferredCode || null, owner ?? "", repo, "task", storage, {
					batchCodes
				});

				if (preferredCode && assignedCode !== preferredCode) {
					throw new Error(`Task code '${preferredCode}' already exists`);
				}

				codesInRequest.add(assignedCode);
				batchCodes.add(assignedCode);

				const phase = raw.phase as string;
				const title = raw.title as string;
				const description = raw.description as string;

				if (!phase || !title || !description) {
					throw new Error("Missing required fields for create (phase, title, description)");
				}

				let normalizedStatus = (raw.status as TaskStatus) || "backlog";
				const statusErr = validateBulkStatus(raw.status as string | undefined);
				if (statusErr) throw new Error(statusErr);

				if (normalizedStatus === "pending") {
					if (initialStats.todo + pendingInRequestCount > 10) {
						normalizedStatus = "backlog" as TaskStatus;
					}
				}

				const now = new Date().toISOString();
				const statusTimestamps = deriveTaskStatusTimestamps(normalizedStatus, now);
				const tags = [...((raw.tags as string[]) || [])];
				const phaseTag = `phase:${phase}`;
				if (!tags.includes(phaseTag)) {
					tags.push(phaseTag);
				}

				const taskId = localCodeMap.get(assignedCode) ?? randomUUID();
				localCodeMap.set(assignedCode, taskId);

				const finalMetadata = applyDecisionRefs(
					raw.decision_refs as string[] | undefined,
					raw.metadata as Record<string, unknown> | undefined
				);

				const task: Task = {
					id: taskId,
					owner,
					repo,
					task_code: assignedCode,
					phase,
					title,
					description,
					status: normalizedStatus,
					priority: (raw.priority as TaskPriority) || 3,
					agent: (raw.agent as string) || "unknown",
					role: (raw.role as string) || "unknown",
					doc_path: (raw.doc_path as string) || null,
					created_at: now,
					updated_at: now,
					in_progress_at: statusTimestamps.in_progress_at,
					finished_at: statusTimestamps.finished_at,
					canceled_at: statusTimestamps.canceled_at,
					est_tokens: (raw.est_tokens as number) ?? 0,
					tags,
					suggested_skills: (raw.suggested_skills as string[]) || [],
					commit_id: null,
					changed_files: [],
					metadata: finalMetadata,
					parent_id: resolveParentId(raw.parent_id as string | null | undefined, owner, repo, storage, localCodeMap),
					depends_on: resolveDependsOn(raw.depends_on as string | null | undefined, owner, repo, storage, localCodeMap)
				};

				storage.tasks.insertTask(task);

				// Best-effort vector embedding (fire-and-forget to avoid sequential hang)
				setImmediate(async () => {
					try {
						await tryVectorEmbedding(task.id, task.title, task.description, vectors);
					} catch (err) {
						logger.warn("Failed to generate vector embedding for bulk task", { taskId: task.id, error: String(err) });
					}
				});

				// Best-effort KG extraction (fire-and-forget to avoid sequential NLP overhead)
				setImmediate(async () => {
					try {
						await saveExtractions(
							`${task.title}\n${task.description ?? ""}`,
							task.title,
							task.owner,
							task.repo,
							storage
						);
					} catch (error) {
						logger.warn("[KG-Archivist] NLP extraction failed", { error: String(error) });
					}
					try {
						await saveTaskRelations(
							`${task.title}\n${task.description ?? ""}`,
							task.title,
							task.owner,
							task.repo,
							storage,
							{
								parentId: task.parent_id,
								decisionRefs: (task.metadata?.decision_refs as string[]) ?? undefined
							}
						);
					} catch (error) {
						logger.warn("[KG-Archivist] Task semantic relations failed for bulk task", {
							error: String(error)
						});
					}
				});

				results.push({
					index: i,
					operation: "create",
					success: true,
					id: task.id,
					code: assignedCode,
					title,
					repo
				});

				if (normalizedStatus === "pending") {
					pendingInRequestCount++;
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			results.push({
				index: i,
				operation: mode,
				success: false,
				error: msg
			});
		}
	}

	const succeeded = results.filter((r) => r.success);
	const failed = results.filter((r) => !r.success);
	const allOk = failed.length === 0;

	// If any item failed, the MCP response should indicate error
	// When something fails, return error response so MCP layer correctly signals isError
	if (!allOk) {
		if (items.length === failed.length) {
			// All items failed — throw the first error for clear signal
			throw new Error(failed[0].error as string);
		}
		// Partial failure — return error response with results
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: `Processed ${succeeded.length}/${items.length} in repo "${repo}" (${failed.length} failed). Errors: ${failed.map((r) => `[${r.index}] ${r.error}`).join("; ")}`
				}
			],
			structuredContent: {
				success: false,
				repo,
				total: items.length,
				createdCount: succeeded.length,
				errors: failed.map((r) => ({ index: r.index, error: r.error })),
				results: results.map((r) => {
					const res: Record<string, unknown> = { index: r.index, operation: r.operation, success: r.success };
					if (r.id) res.id = r.id;
					if (r.code) res.code = r.code;
					if (r.title) res.title = r.title;
					if (r.error) res.error = r.error;
					if (r.updatedFields) res.updatedFields = r.updatedFields;
					return res;
				})
			}
		};
	}

	// Build summary text matching test expectations
	const createCount = results.filter((r) => r.operation === "create" && r.success).length;
	const updateCount = results.filter((r) => r.operation === "update" && r.success).length;
	let summaryText: string;
	if (updateCount === 0) {
		summaryText = `Created ${createCount} ${createCount === 1 ? "task" : "tasks"} in repo "${repo}".`;
	} else if (createCount === 0) {
		summaryText = `Updated ${updateCount} ${updateCount === 1 ? "task" : "tasks"} in repo "${repo}".`;
	} else {
		summaryText = `Processed ${createCount} creates + ${updateCount} updates in repo "${repo}".`;
	}

	return createMcpResponse(
		{
			success: true,
			repo,
			total: items.length,
			createdCount: succeeded.length,
			results: results.map((r) => {
				const res: Record<string, unknown> = { index: r.index, operation: r.operation, success: r.success };
				if (r.id) res.id = r.id;
				if (r.code) res.code = r.code;
				if (r.title) res.title = r.title;
				if (r.error) res.error = r.error;
				if (r.updatedFields) res.updatedFields = r.updatedFields;
				return res;
			})
		},
		summaryText,
		{ includeJson: params.json }
	);
}
