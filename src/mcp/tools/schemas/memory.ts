import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";
import { MemoryScopeSchema, MemoryTypeSchema, SingleMemorySchema } from "./shared";

export const MemoryStoreSchema = z.object({
	code: z.string().max(20).optional(),
	type: MemoryTypeSchema,
	title: z.string().min(3).max(255),
	content: z.string().min(10),
	importance: z.coerce.number().min(1).max(5),
	agent: z.string().min(1),
	role: z.string().optional().default("unknown"),
	model: z.string().optional(),
	scope: MemoryScopeSchema.optional(),
	ttlDays: z.coerce.number().min(1).optional(),
	supersedes: z.string().optional(),
	tags: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	is_global: z.boolean().default(false),
	json: z.boolean().default(false),
	memories: z.array(SingleMemorySchema).min(1).optional()
});

export const MemoryUpdateSchema = z
	.object({
		id: z.string().optional(),
		code: z.string().max(20).optional(),
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		type: MemoryTypeSchema.optional(),
		title: z.string().min(3).max(255).optional(),
		content: z.string().min(10).optional(),
		importance: z.coerce.number().min(1).max(5).optional(),
		agent: z.string().optional(),
		role: z.string().optional(),
		status: z.enum(["active", "archived"]).optional(),
		supersedes: z.string().optional(),
		tags: z.array(z.string()).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		is_global: z.boolean().optional(),
		completed_at: z.string().optional(),
		json: z.boolean().default(false)
	})
	.refine((data) => data.id !== undefined || data.code !== undefined, {
		message: "Either id or code must be provided"
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
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	limit: z.coerce.number().min(1).max(100).default(5),
	offset: z.coerce.number().min(0).default(0),
	current_file_path: z.string().optional(),
	include_archived: z.boolean().default(false),
	current_tags: z.array(z.string()).optional(),
	scope: MemoryScopeSchema.partial().optional(),
	json: z.boolean().default(false)
});

export const MemoryAcknowledgeSchema = z
	.object({
		memory_id: z.string().optional(),
		code: z.string().max(20).optional(),
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		status: z
			.enum(["used", "irrelevant", "contradictory"])
			.describe(
				'Usage status. Use "used" after generating code from a memory, "irrelevant" if the memory didn\'t help, or "contradictory" if it conflicts with current understanding.'
			),
		application_context: z.string().min(10).optional(),
		json: z.boolean().default(false)
	})
	.refine((data) => data.memory_id !== undefined || data.code !== undefined, {
		message: "Either memory_id or code must be provided"
	});

export const MemoryRecapSchema = z.object({
	owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots"),
	repo: z
		.string()
		.min(1, "repo is required — provide it explicitly or configure MCP workspace roots")
		.transform(normalizeRepo),
	limit: z.coerce.number().min(1).max(50).default(20),
	offset: z.coerce.number().min(0).default(0),
	json: z.boolean().default(false)
});

export const MemoryDeleteSchema = z
	.object({
		owner: z.string().min(1).describe("GitHub org or username. Auto-inferred."),
		repo: z.string().min(1).transform(normalizeRepo).describe("Repo name. Auto-inferred."),
		id: z
			.string()
			.optional()
			.describe("Single memory UUID or code to delete (auto-inferred: UUID→direct, string→code lookup)."),
		ids: z.array(z.string()).min(1).optional().describe("Array of memory UUIDs or codes to delete (bulk)."),
		code: z.string().max(20).optional().describe("Single memory code to delete."),
		codes: z.array(z.string().max(20)).min(1).optional().describe("Array of memory codes to delete (bulk)."),
		json: z.boolean().default(false).describe("Returns JSON if true.")
	})
	.refine(
		(data) => data.id !== undefined || data.ids !== undefined || data.code !== undefined || data.codes !== undefined,
		{
			message: "Either 'id', 'ids', 'code', or 'codes' must be provided for deletion"
		}
	)
	.describe("Soft-delete memories. Single or bulk. Auto-infers: UUID→direct ID, non-UUID→code lookup.");

export const MemoryDetailSchema = z
	.object({
		id: z.string().optional(),
		code: z.string().max(20).optional(),
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		json: z.boolean().default(false)
	})
	.refine((data) => data.id !== undefined || data.code !== undefined, {
		message: "Either id or code must be provided"
	});

export const MemorySummarizeSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	signals: z.array(z.string().max(200)).min(1),
	json: z.boolean().default(false)
});

export const MemoryReadSchema = z
	.object({
		query: z.string().optional().describe("Search keyword for memory titles"),
		id: z.string().optional().describe("Memory UUID (detail mode)"),
		code: z.string().max(20).optional().describe("Short memory code (detail mode)"),
		ids: z.array(z.string()).optional().describe("Array of memory UUIDs (bulk detail)"),
		codes: z.array(z.string().max(20)).optional().describe("Array of memory codes (bulk detail)"),
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		current_tags: z.array(z.string()).optional().describe("Tech stack tags for filtering"),
		current_file_path: z.string().optional().describe("File path for workspace grounding"),
		scope: MemoryScopeSchema.partial().optional(),
		include_archived: z.boolean().default(false).describe("Include archived memories"),
		limit: z.coerce.number().min(1).max(100).default(5).describe("Max results (1-100)"),
		offset: z.coerce.number().min(0).default(0).describe("Pagination offset"),
		json: z.boolean().default(false).describe("Returns JSON if true.")
	})
	.describe("Auto-infers mode: search (query present), detail (id/code/ids/codes present), or recap (none)");

// ── Memory Write Schema (replaces memory-store, memory-update, memory-acknowledge) ──
// Single flat schema — no oneOf. The handler uses auto-infer logic to determine
// the operation (CREATE, UPDATE, ACKNOWLEDGE, or BULK) from the field combination.

const MemoryWriteFields = {
	// Create fields
	type: MemoryTypeSchema.optional(),
	title: z.string().min(3).max(255).optional(),
	content: z.string().min(10).optional(),
	importance: z.coerce.number().min(1).max(5).optional(),
	code: z.string().max(20).optional(),
	ttlDays: z.coerce.number().min(1).optional(),
	supersedes: z.string().optional(),
	tags: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	is_global: z.boolean().optional(),
	scope: MemoryScopeSchema.optional(),

	// Update fields
	id: z.string().optional(),
	agent: z.string().optional(),
	role: z.string().optional(),
	model: z.string().optional(),
	status: z.enum(["active", "archived"]).optional(),
	completed_at: z.string().optional(),

	// Acknowledge discriminator (separate from entity status)
	acknowledge: z.enum(["used", "irrelevant", "contradictory"]).optional(),
	application_context: z.string().optional(),

	// Decision log convenience — replaces decision-log tool
	decision_log: z
		.object({
			context: z.string().min(10, { message: "Decision context must be at least 10 characters" }),
			rationale: z.string().min(10, { message: "Rationale must be at least 10 characters" }),
			alternatives: z.array(z.string()).optional(),
			tags: z.array(z.string()).optional()
		})
		.optional()
		.describe(
			'Convenience: pass with type:"decision" to auto-format content and set importance=4. Equivalent to calling decision-log.'
		),

	// Session summary convenience — replaces session-summarize tool
	session_summary: z
		.object({
			summary: z.string().min(10, { message: "Session summary must be at least 10 characters" }),
			key_decisions: z.array(z.string()).optional(),
			next_steps: z.array(z.string()).optional(),
			tags: z.array(z.string()).optional()
		})
		.optional()
		.describe(
			'Convenience: pass with type:"task_archive" to auto-format title and content. Equivalent to calling session-summarize.'
		),

	// Standard
	owner: z.string().optional(),
	repo: z.string().optional(),
	json: z.boolean().default(false)
} as const;

/** Schema for a single item in the memories[] bulk array. */
export const MemoryWriteItemSchema = z.object({ ...MemoryWriteFields });

/** Schema for memory-write: single CREATE/UPDATE/ACKNOWLEDGE or BULK via memories[]. */
export const MemoryWriteSchema = z.object({
	...MemoryWriteFields,

	// Bulk: if present, switches to bulk mode
	memories: z.array(MemoryWriteItemSchema).optional()
});

export const MemorySynthesizeSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo).optional(),
	objective: z.string().min(5),
	current_file_path: z.string().optional(),
	include_summary: z.boolean().default(true),
	include_tasks: z.boolean().default(true),
	use_tools: z.boolean().default(true),
	max_iterations: z.coerce.number().int().min(1).max(5).default(3),
	max_tokens: z.coerce.number().int().min(128).max(4000).default(1200),
	json: z.boolean().default(false)
});
