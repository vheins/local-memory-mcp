import { z } from "zod";
import { normalizeRepo } from "../utils/normalize";

// Shared schema components
export const MemoryScopeSchema = z.object({
	repo: z.string().min(1).transform(normalizeRepo),
	branch: z.string().optional(),
	folder: z.string().optional(),
	language: z.string().optional()
});

export const MemoryTypeSchema = z.enum([
	"code_fact",
	"decision",
	"mistake",
	"pattern",
	"agent_handoff",
	"agent_registered",
	"file_claim",
	"task_archive"
]);

// Tool schemas
export const MemoryStoreSchema = z.object({
	code: z.string().max(20).optional(),
	type: MemoryTypeSchema,
	title: z.string().min(3).max(255),
	content: z.string().min(10),
	importance: z.number().min(1).max(5),
	agent: z.string().min(1),
	role: z.string().optional().default("unknown"),
	model: z.string().min(1),
	scope: MemoryScopeSchema,
	ttlDays: z.number().min(1).optional(),
	supersedes: z.string().uuid().optional(),
	tags: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.any()).optional(),
	is_global: z.boolean().default(false),
	structured: z.boolean().default(false)
});

export const MemoryUpdateSchema = z
	.object({
		id: z.string().uuid(),
		type: MemoryTypeSchema.optional(),
		title: z.string().min(3).max(255).optional(),
		content: z.string().min(10).optional(),
		importance: z.number().min(1).max(5).optional(),
		agent: z.string().optional(),
		role: z.string().optional(),
		status: z.enum(["active", "archived"]).optional(),
		supersedes: z.string().uuid().optional(),
		tags: z.array(z.string()).optional(),
		metadata: z.record(z.string(), z.any()).optional(),
		is_global: z.boolean().optional(),
		completed_at: z.string().optional(),
		structured: z.boolean().default(false)
	})
	.refine(
		(data) =>
			data.type !== undefined ||
			data.content !== undefined ||
			data.title !== undefined ||
			data.importance !== undefined ||
			data.status !== undefined ||
			data.supersedes !== undefined ||
			data.tags !== undefined ||
			data.metadata !== undefined ||
			data.is_global !== undefined ||
			data.agent !== undefined ||
			data.role !== undefined ||
			data.completed_at !== undefined,
		{ message: "At least one field must be provided for update" }
	);

export const MemorySearchSchema = z.object({
	query: z.string().min(3),
	prompt: z.string().optional(),
	repo: z.string().min(1).transform(normalizeRepo),
	types: z.array(MemoryTypeSchema).optional(),
	minImportance: z.number().min(1).max(5).optional(),
	limit: z.number().min(1).max(100).default(5),
	offset: z.number().min(0).default(0),
	includeRecap: z.boolean().default(false),
	current_file_path: z.string().optional(),
	include_archived: z.boolean().default(false),
	current_tags: z.array(z.string()).optional(),
	scope: MemoryScopeSchema.partial().optional(),
	structured: z.boolean().default(false)
});

export const MemoryAcknowledgeSchema = z.object({
	memory_id: z.string().uuid(),
	status: z.enum(["used", "irrelevant", "contradictory"]),
	application_context: z.string().min(10).optional(),
	structured: z.boolean().default(false)
});

export const MemoryRecapSchema = z.object({
	repo: z.string().min(1).transform(normalizeRepo),
	limit: z.number().min(1).max(50).default(20),
	offset: z.number().min(0).default(0),
	structured: z.boolean().default(false)
});

export const MemoryDeleteSchema = z
	.object({
		repo: z.string().min(1).transform(normalizeRepo).optional(),
		id: z.string().uuid().optional(),
		ids: z.array(z.string().uuid()).min(1).optional(),
		structured: z.boolean().default(false)
	})
	.refine((data) => data.id !== undefined || data.ids !== undefined, {
		message: "Either 'id' or 'ids' must be provided for deletion"
	});

export const MemorySummarizeSchema = z.object({
	repo: z.string().min(1).transform(normalizeRepo),
	signals: z.array(z.string().max(200)).min(1),
	structured: z.boolean().default(false)
});

export const MemorySynthesizeSchema = z.object({
	repo: z.string().min(1).transform(normalizeRepo).optional(),
	objective: z.string().min(5),
	current_file_path: z.string().optional(),
	include_summary: z.boolean().default(true),
	include_tasks: z.boolean().default(true),
	use_tools: z.boolean().default(true),
	max_iterations: z.number().int().min(1).max(5).default(3),
	max_tokens: z.number().int().min(128).max(4000).default(1200),
	structured: z.boolean().default(false)
});

export const TaskStatusSchema = z.enum(["backlog", "pending", "in_progress", "completed", "canceled", "blocked"]);
export const TaskPrioritySchema = z.number().min(1).max(5);

const SingleTaskCreateSchema = z.object({
	task_code: z.string().min(1),
	phase: z.string().min(1),
	title: z.string().min(3).max(100),
	description: z.string().min(1),
	status: TaskStatusSchema.default("backlog"),
	priority: TaskPrioritySchema.default(3),
	agent: z.string().optional(),
	role: z.string().optional(),
	doc_path: z.string().optional(),
	tags: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.any()).optional(),
	parent_id: z.string().uuid().optional(),
	depends_on: z.string().uuid().optional(),
	est_tokens: z.number().int().min(0).optional()
});

export const TaskCreateSchema = z
	.object({
		repo: z.string().min(1).transform(normalizeRepo),
		// Allow single task fields at top level (backward compatibility & single use)
		task_code: z.string().min(1).optional(),
		phase: z.string().min(1).optional(),
		title: z.string().min(3).max(100).optional(),
		description: z.string().min(1).optional(),
		status: TaskStatusSchema.optional(),
		priority: TaskPrioritySchema.optional(),
		agent: z.string().optional(),
		role: z.string().optional(),
		doc_path: z.string().optional(),
		tags: z.array(z.string()).optional(),
		metadata: z.record(z.string(), z.any()).optional(),
		parent_id: z.string().uuid().optional(),
		depends_on: z.string().uuid().optional(),
		est_tokens: z.number().int().min(0).optional(),
		// Allow bulk tasks
		tasks: z.array(SingleTaskCreateSchema).min(1).optional(),
		structured: z.boolean().default(false)
	})
	.refine(
		(data) => {
			if (data.tasks) return true;
			return !!(data.task_code && data.phase && data.title && data.description);
		},
		{ message: "Either 'tasks' array or single task fields (task_code, phase, title, description) must be provided" }
	);

export const TaskCreateInteractiveSchema = SingleTaskCreateSchema.partial().extend({
	repo: z.string().min(1).transform(normalizeRepo).optional(),
	structured: z.boolean().default(false)
});

export const TaskUpdateSchema = z
	.object({
		repo: z.string().min(1).transform(normalizeRepo),
		id: z.string().uuid().optional(),
		ids: z.array(z.string().uuid()).min(1).optional(),
		task_code: z.string().optional(),
		phase: z.string().optional(),
		title: z.string().min(3).max(100).optional(),
		description: z.string().optional(),
		status: TaskStatusSchema.optional(),
		priority: TaskPrioritySchema.optional(),
		agent: z.string().min(1, "agent name is required").optional(),
		role: z.string().min(1, "agent role is required").optional(),
		model: z.string().optional(),
		comment: z.string().min(1).optional(),
		doc_path: z.string().optional(),
		tags: z.array(z.string()).optional(),
		metadata: z.record(z.string(), z.any()).optional(),
		parent_id: z.string().uuid().optional(),
		depends_on: z.string().uuid().optional(),
		est_tokens: z.number().int().min(0).optional(),
		force: z.boolean().optional(),
		structured: z.boolean().default(false)
	})
	.refine((data) => data.id !== undefined || data.ids !== undefined, {
		message: "Either 'id' or 'ids' must be provided for update"
	})
	.refine((data) => Object.keys(data).length > 2, {
		message: "At least one field besides repo and id/ids must be provided for update"
	});

export const TaskListSchema = z.object({
	repo: z.string().min(1).transform(normalizeRepo),
	status: z.string().optional(),
	phase: z.string().optional(),
	query: z.string().optional(),
	limit: z.number().min(1).max(100).default(15),
	offset: z.number().min(0).default(0),
	structured: z.boolean().default(false)
});

export const TaskSearchSchema = z.object({
	repo: z.string().min(1).transform(normalizeRepo),
	query: z.string().min(1),
	status: z.string().optional(),
	limit: z.number().min(1).max(100).default(10),
	offset: z.number().min(0).default(0),
	structured: z.boolean().default(false)
});

export const TaskDeleteSchema = z
	.object({
		repo: z.string().min(1).transform(normalizeRepo),
		id: z.string().uuid().optional(),
		ids: z.array(z.string().uuid()).min(1).optional(),
		structured: z.boolean().default(false)
	})
	.refine((data) => data.id !== undefined || data.ids !== undefined, {
		message: "Either 'id' or 'ids' must be provided for deletion"
	});

export const MemoryDetailSchema = z
	.object({
		id: z.string().uuid().optional(),
		code: z.string().max(20).optional(),
		structured: z.boolean().default(false)
	})
	.refine((data) => data.id !== undefined || data.code !== undefined, {
		message: "Either id or code must be provided"
	});

export const TaskGetSchema = z
	.object({
		repo: z.string().min(1).transform(normalizeRepo),
		id: z.string().uuid().optional(),
		task_code: z.string().optional(),
		structured: z.boolean().default(false)
	})
	.refine((data) => data.id !== undefined || data.task_code !== undefined, {
		message: "Either id or task_code must be provided"
	});

// Tool definitions for MCP
export const TOOL_DEFINITIONS = [
	{
		name: "memory-synthesize",
		title: "Memory Synthesize",
		description:
			"Use client sampling to synthesize a grounded answer from local memory and tasks. Best for project briefings, tradeoff summaries, and context-aware answers.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		execution: {
			taskSupport: "optional"
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository name. Optional when a single MCP root is active." },
				objective: { type: "string", minLength: 5, description: "Question or synthesis objective." },
				current_file_path: {
					type: "string",
					description: "Optional absolute file path for workspace-local grounding."
				},
				include_summary: { type: "boolean", default: true },
				include_tasks: { type: "boolean", default: true },
				use_tools: {
					type: "boolean",
					default: true,
					description:
						"Allow the sampled model to call local memory/task tools during synthesis when the client supports sampling.tools."
				},
				max_iterations: { type: "number", minimum: 1, maximum: 5, default: 3 },
				max_tokens: { type: "number", minimum: 128, maximum: 4000, default: 1200 },
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON results." }
			},
			required: ["objective"]
		},
		outputSchema: {
			type: "object",
			properties: {
				repo: { type: "string" },
				objective: { type: "string" },
				answer: { type: "string" },
				model: { type: "string" },
				stopReason: { type: "string" },
				iterations: { type: "number" },
				toolCalls: { type: "number" }
			},
			required: ["repo", "objective", "answer", "iterations", "toolCalls"]
		}
	},
	{
		name: "task-create-interactive",
		title: "Interactive Task Create",
		description:
			"Create a task with MCP elicitation fallback for any missing required fields. Best when an agent knows a task is needed but still needs user confirmation for repo, title, or phase.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: {
					type: "string",
					description: "Repository name. Optional when it can be inferred from MCP roots or elicited from the user."
				},
				task_code: { type: "string" },
				phase: { type: "string" },
				title: { type: "string", minLength: 3, maxLength: 100 },
				description: { type: "string", minLength: 1 },
				status: { type: "string", enum: ["backlog", "pending"], default: "backlog" },
				priority: { type: "number", minimum: 1, maximum: 5, default: 3 },
				agent: { type: "string" },
				role: { type: "string" },
				doc_path: { type: "string" },
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
			}
		},
		outputSchema: {
			type: "object",
			properties: {
				repo: { type: "string" },
				task_code: { type: "string" },
				phase: { type: "string" },
				title: { type: "string" },
				status: { type: "string" },
				priority: { type: "number" }
			},
			required: ["repo", "task_code", "phase", "title", "status", "priority"]
		}
	},
	{
		name: "memory-detail",
		title: "Memory Detail",
		description:
			"Fetch full details of a specific memory by ID. Use this when you have a memory ID (e.g. from search results) and need to read the full content.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", format: "uuid", description: "Memory entry ID" },
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON details." }
			},
			required: ["id"]
		}
	},
	{
		name: "task-detail",
		title: "Task Detail",
		description:
			"Fetch full details of a specific task by ID or task code. Use this when you have a task ID or code and need to read the full description and comments.",
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository name" },
				id: { type: "string", format: "uuid", description: "Task ID (optional if task_code is provided)" },
				task_code: { type: "string", description: "Task code (e.g. TASK-001) (optional if id is provided)" },
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON without the text content details."
				}
			},
			required: ["repo"]
		}
	},
	{
		name: "memory-store",
		title: "Memory Store",
		description:
			"Store a new memory entry. Keep 'title' concise and human-readable; do not embed agent/role/date metadata in the title. Put auxiliary context into 'metadata'. Use 'tags' for tech-stack and 'is_global' for universal rules.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				type: {
					type: "string",
					enum: [
						"code_fact",
						"decision",
						"mistake",
						"pattern",
						"agent_handoff",
						"agent_registered",
						"file_claim",
						"task_archive"
					],
					description: "Type of memory being stored"
				},
				title: {
					type: "string",
					minLength: 3,
					maxLength: 100,
					description:
						"Short human-readable title for the memory. Do not embed bracketed metadata like agent/role/date prefixes here."
				},
				content: {
					type: "string",
					minLength: 10,
					description: "The memory content"
				},
				importance: {
					type: "number",
					minimum: 1,
					maximum: 5,
					description: "Importance score (1-5)"
				},
				agent: {
					type: "string",
					description: "Name of the agent creating this memory"
				},
				role: {
					type: "string",
					description: "Role of the agent creating this memory"
				},
				model: {
					type: "string",
					description: "AI model used by the agent"
				},
				scope: {
					type: "object",
					properties: {
						repo: { type: "string", description: "Repository name" },
						branch: { type: "string" },
						folder: { type: "string" },
						language: { type: "string" }
					},
					required: ["repo"]
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Technology stack tags (e.g., ['filament', 'laravel'])"
				},
				metadata: {
					type: "object",
					description: "Structured metadata for non-title context such as source agent, claim fields, or timestamps"
				},
				is_global: {
					type: "boolean",
					description: "If true, this memory is shared across all repositories"
				},
				ttlDays: { type: "number", minimum: 1 },
				supersedes: { type: "string", format: "uuid" },
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON of the stored memory." }
			},
			required: ["type", "title", "content", "importance", "scope", "agent", "model"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				code: { type: "string" },
				repo: { type: "string" },
				type: { type: "string" },
				title: { type: "string" },
				error: { type: "string" },
				message: { type: "string" }
			},
			required: ["success"]
		}
	},
	{
		name: "memory-acknowledge",
		title: "Memory Acknowledge",
		description:
			"Acknowledge the use of a memory or report its irrelevance/contradiction. Mandatory after using memory to generate code.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				memory_id: { type: "string", format: "uuid" },
				status: { type: "string", enum: ["used", "irrelevant", "contradictory"] },
				application_context: { type: "string", minLength: 10 },
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
			},
			required: ["memory_id", "status"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				status: { type: "string" }
			},
			required: ["success", "id", "status"]
		}
	},
	{
		name: "memory-update",
		title: "Memory Update",
		description:
			"Update an existing memory entry. Keep 'title' concise and move agent/role/date or claim context into 'metadata' instead of the title.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", format: "uuid" },
				type: {
					type: "string",
					enum: [
						"code_fact",
						"decision",
						"mistake",
						"pattern",
						"agent_handoff",
						"agent_registered",
						"file_claim",
						"task_archive"
					]
				},
				title: { type: "string", minLength: 3, maxLength: 100 },
				content: { type: "string", minLength: 10 },
				importance: { type: "number", minimum: 1, maximum: 5 },
				agent: { type: "string" },
				role: { type: "string" },
				status: { type: "string", enum: ["active", "archived"] },
				supersedes: { type: "string", format: "uuid" },
				tags: { type: "array", items: { type: "string" } },
				metadata: { type: "object" },
				is_global: { type: "boolean" },
				completed_at: { type: "string" },
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON of the updated memory." }
			},
			required: ["id"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				repo: { type: "string" },
				updatedFields: {
					type: "array",
					items: { type: "string" }
				}
			},
			required: ["success", "id", "repo", "updatedFields"]
		}
	},
	{
		name: "memory-search",
		title: "Memory Search",
		description:
			"NAVIGATION LAYER: Returns a pointer table of matching memory IDs only. Returns columns [id, title, type, importance] — NO content. Retrieve full memory via memory-detail. Use 'current_tags' to find tech-stack specific knowledge from other projects.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", minLength: 3 },
				prompt: { type: "string" },
				repo: { type: "string" },
				current_tags: {
					type: "array",
					items: { type: "string" },
					description: "Active tech stack tags (e.g., ['filament', 'react'])"
				},
				types: {
					type: "array",
					items: {
						type: "string",
						enum: [
							"code_fact",
							"decision",
							"mistake",
							"pattern",
							"agent_handoff",
							"agent_registered",
							"file_claim",
							"task_archive"
						]
					}
				},
				minImportance: { type: "number", minimum: 1, maximum: 5 },
				limit: { type: "number", minimum: 1, maximum: 100, default: 5 },
				offset: { type: "number", minimum: 0, default: 0 },
				includeRecap: { type: "boolean", default: false },
				current_file_path: { type: "string" },
				include_archived: { type: "boolean", default: false },
				scope: {
					type: "object",
					properties: {
						repo: { type: "string" },
						branch: { type: "string" },
						folder: { type: "string" },
						language: { type: "string" }
					}
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON without the text content summary."
				}
			},
			required: ["query", "repo"]
		},
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "string", enum: ["memory-search"] },
				query: { type: "string" },
				count: { type: "number", description: "Number of rows returned" },
				total: { type: "number", description: "Total matching memories" },
				offset: { type: "number" },
				limit: { type: "number" },
				results: {
					type: "object",
					properties: {
						columns: {
							type: "array",
							items: { type: "string" },
							description: "Column names: [id, title, type, importance]"
						},
						rows: {
							type: "array",
							items: { type: "array" },
							description: "Each row: [id, title, type, importance]. Fetch full content via memory-detail"
						}
					},
					required: ["columns", "rows"]
				}
			},
			required: ["schema", "query", "count", "total", "offset", "limit", "results"]
		}
	},
	{
		name: "memory-summarize",
		title: "Memory Summarize",
		description: "Update the summary for a repository",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository name" },
				signals: {
					type: "array",
					items: { type: "string", maxLength: 200 },
					minItems: 1,
					description: "High-level signals to include in summary"
				},
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON of the summary." }
			},
			required: ["repo", "signals"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				repo: { type: "string" },
				summary: { type: "string" },
				signalCount: { type: "number" }
			},
			required: ["success", "repo", "summary", "signalCount"]
		}
	},
	{
		name: "memory-delete",
		title: "Memory Delete",
		description: "Soft-delete one or more memory entries. Supports single 'id' or bulk 'ids'.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository name (optional for single id)" },
				id: { type: "string", format: "uuid", description: "Memory entry ID to delete" },
				ids: {
					type: "array",
					items: { type: "string", format: "uuid" },
					minItems: 1,
					description: "Array of memory IDs to delete"
				},
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
			}
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				ids: { type: "array", items: { type: "string" } },
				repo: { type: "string" },
				deletedCount: { type: "number" }
			},
			required: ["success"]
		}
	},
	{
		name: "memory-recap",
		title: "Memory Recap",
		description:
			"AGGREGATED OVERVIEW LAYER: Returns stats (counts by type) and a pointer table of top memories [id, title, type, importance]. NO content. Use for orientation only — retrieve full memory via memory-detail.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository name (required)" },
				limit: {
					type: "number",
					minimum: 1,
					maximum: 50,
					default: 20,
					description: "Maximum number of top memories to return in the pointer table"
				},
				offset: {
					type: "number",
					minimum: 0,
					default: 0,
					description: "Number of memories to skip for pagination (optional, default 0)"
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON without the text content summary."
				}
			},
			required: ["repo"]
		},
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "string", enum: ["memory-recap"] },
				repo: { type: "string" },
				count: { type: "number", description: "Number of rows in the top pointer table" },
				total: { type: "number", description: "Total active memories in repo" },
				offset: { type: "number" },
				limit: { type: "number" },
				stats: {
					type: "object",
					properties: {
						by_type: {
							type: "object",
							description: "Count of active memories per type (e.g. { decision: 3, code_fact: 7 })"
						}
					},
					required: ["by_type"]
				},
				top: {
					type: "object",
					properties: {
						columns: {
							type: "array",
							items: { type: "string" },
							description: "Column names: [id, title, type, importance]"
						},
						rows: {
							type: "array",
							items: { type: "array" },
							description: "Each row: [id, title, type, importance]. Fetch full content via memory-detail"
						}
					},
					required: ["columns", "rows"]
				}
			},
			required: ["schema", "repo", "count", "total", "offset", "limit", "stats", "top"]
		}
	},
	{
		name: "task-create",
		title: "Task Create",
		description:
			"Register one or more new tasks in a repository. task_code must be unique within the repository. Supports single task object or an array of tasks for bulk creation.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository name" },
				task_code: { type: "string", description: "Unique task code (e.g. TASK-001) (Required for single task)" },
				phase: { type: "string", description: "Project phase (Required for single task)" },
				title: {
					type: "string",
					minLength: 3,
					maxLength: 100,
					description: "Task objective (Required for single task)"
				},
				description: { type: "string", description: "Detailed description (Required for single task)" },
				status: {
					type: "string",
					enum: ["backlog", "pending"],
					default: "backlog",
					description:
						"New tasks MUST start in 'backlog' if there are already 10 pending tasks. Otherwise can start in 'pending'."
				},
				priority: { type: "number", minimum: 1, maximum: 5, default: 3 },
				agent: { type: "string" },
				role: { type: "string" },
				doc_path: { type: "string" },
				tags: { type: "array", items: { type: "string" } },
				metadata: { type: "object" },
				parent_id: { type: "string", format: "uuid" },
				depends_on: { type: "string", format: "uuid" },
				est_tokens: { type: "number", minimum: 0, description: "Estimated tokens budget for this task" },
				tasks: {
					type: "array",
					items: {
						type: "object",
						properties: {
							task_code: { type: "string" },
							phase: { type: "string" },
							title: { type: "string", minLength: 3, maxLength: 100 },
							description: { type: "string" },
							status: { type: "string", enum: ["backlog", "pending"], default: "backlog" },
							priority: { type: "number", minimum: 1, maximum: 5, default: 3 },
							agent: { type: "string" },
							role: { type: "string" },
							doc_path: { type: "string" },
							tags: { type: "array", items: { type: "string" } },
							metadata: { type: "object" },
							parent_id: { type: "string", format: "uuid" },
							depends_on: { type: "string", format: "uuid" },
							est_tokens: { type: "number", minimum: 0 }
						},
						required: ["task_code", "phase", "title", "description"]
					},
					description: "Array of tasks for bulk creation"
				},
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
			},
			required: ["repo"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				task_code: { type: "string" },
				repo: { type: "string" },
				phase: { type: "string" },
				title: { type: "string" },
				status: { type: "string" },
				priority: { type: "number" },
				createdCount: { type: "number" },
				taskCodes: { type: "array", items: { type: "string" } }
			},
			required: ["success", "repo"]
		}
	},
	{
		name: "task-update",
		title: "Task Update",
		description:
			"Update one or more tasks. Supports single update via 'id' or bulk update via 'ids'. Provide only the fields that need to be changed. MANDATORY WORKFLOW: You cannot move a task from 'pending' or 'blocked' directly to 'completed'. You MUST move it to 'in_progress' first. When changing status to 'completed', include 'est_tokens' with the estimated total tokens actually used for the task.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository name" },
				id: { type: "string", format: "uuid", description: "Task ID (for single update)" },
				ids: { type: "array", items: { type: "string", format: "uuid" }, description: "Task IDs (for bulk update)" },
				task_code: { type: "string" },
				phase: { type: "string" },
				title: { type: "string", minLength: 3, maxLength: 100 },
				description: { type: "string" },
				status: {
					type: "string",
					enum: ["backlog", "pending", "in_progress", "completed", "canceled", "blocked"],
					description: "New status. Transitions from 'backlog', 'pending' or 'blocked' to 'completed' are NOT allowed."
				},
				priority: { type: "number", minimum: 1, maximum: 5 },
				agent: { type: "string" },
				role: { type: "string" },
				model: { type: "string" },
				comment: {
					type: "string",
					description:
						"REQUIRED when changing task status. Explain WHY the status is changing (e.g., 'Starting implementation', 'Blocked by missing API docs', 'Verified fix')."
				},
				doc_path: { type: "string" },
				tags: { type: "array", items: { type: "string" } },
				metadata: { type: "object" },
				parent_id: { type: "string", format: "uuid" },
				depends_on: { type: "string", format: "uuid" },
				est_tokens: {
					type: "number",
					minimum: 0,
					description:
						"Estimated total tokens actually used for this task. Required when status changes to 'completed'."
				},
				force: {
					type: "boolean",
					description: "If true, bypasses status transition validation (e.g. pending -> completed)."
				},
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
			},
			required: ["repo"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				ids: { type: "array", items: { type: "string" } },
				repo: { type: "string" },
				status: { type: "string" },
				archivedToMemory: { type: "boolean" },
				updatedFields: {
					type: "array",
					items: { type: "string" }
				},
				updatedCount: { type: "number" }
			},
			required: ["success", "repo"]
		}
	},
	{
		name: "task-delete",
		title: "Task Delete",
		description: "Delete one or more tasks from a repository. Supports single 'id' or bulk 'ids'.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository name" },
				id: { type: "string", format: "uuid", description: "Task ID (for single deletion)" },
				ids: { type: "array", items: { type: "string", format: "uuid" }, description: "Task IDs (for bulk deletion)" },
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
			},
			required: ["repo"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				ids: { type: "array", items: { type: "string" } },
				repo: { type: "string" },
				deletedCount: { type: "number" }
			},
			required: ["success", "repo"]
		}
	},
	{
		name: "task-list",
		title: "Task List",
		description:
			"PRIMARY navigation and search tool for tasks. Returns a compact tabular list of tasks (id, task_code, title, status, priority). Defaults to in_progress and pending tasks. Use 'query' to filter by code, title, or description. Use 'status' (comma-separated) for specific filters. AGENTS: call this once at start, pick ONE task, then call task-detail.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: {
					type: "string",
					description: "Repository name"
				},
				status: {
					type: "string",
					default: "in_progress,pending",
					description:
						"Comma-separated status filter (backlog, pending, in_progress, completed, canceled, blocked). Defaults to 'in_progress,pending'."
				},
				phase: {
					type: "string",
					description: "Filter by phase (e.g., 'research', 'implementation')"
				},
				query: {
					type: "string",
					description: "Search keyword matching task code, title, or description"
				},
				limit: {
					type: "number",
					minimum: 1,
					maximum: 100,
					default: 5,
					description: "Maximum rows to return (default 5)"
				},
				offset: {
					type: "number",
					minimum: 0,
					default: 0,
					description: "Offset for pagination"
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON without the text content summary."
				}
			},
			required: ["repo"]
		},
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "string", enum: ["task-list"] },
				tasks: {
					type: "object",
					properties: {
						columns: {
							type: "array",
							items: { type: "string" },
							description: "Column names in order: id, task_code, title, status, priority, comments_count"
						},
						rows: {
							type: "array",
							items: { type: "array" },
							description:
								"Each row: [id, task_code, title, status, priority, comments_count]. Use task-detail to fetch full task."
						}
					},
					required: ["columns", "rows"]
				},
				count: { type: "number" },
				offset: { type: "number" }
			},
			required: ["schema", "tasks", "count"]
		}
	}
];
