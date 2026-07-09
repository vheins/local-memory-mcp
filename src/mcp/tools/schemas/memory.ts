import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";
import { MemoryScopeSchema, MemoryTypeSchema, SingleMemorySchema } from "./shared";

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
	supersedes: z.string().optional(),
	tags: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	is_global: z.boolean().default(false),
	structured: z.boolean().default(false),
	memories: z.array(SingleMemorySchema).min(1).optional()
});

export const MemoryUpdateSchema = z
	.object({
		id: z.string().uuid().optional(),
		code: z.string().max(20).optional(),
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		type: MemoryTypeSchema.optional(),
		title: z.string().min(3).max(255).optional(),
		content: z.string().min(10).optional(),
		importance: z.number().min(1).max(5).optional(),
		agent: z.string().optional(),
		role: z.string().optional(),
		status: z.enum(["active", "archived"]).optional(),
		supersedes: z.string().optional(),
		tags: z.array(z.string()).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		is_global: z.boolean().optional(),
		completed_at: z.string().optional(),
		structured: z.boolean().default(false)
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

export const MemoryAcknowledgeSchema = z
	.object({
		memory_id: z.string().uuid().optional(),
		code: z.string().max(20).optional(),
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		status: z.enum(["used", "irrelevant", "contradictory"]),
		application_context: z.string().min(10).optional(),
		structured: z.boolean().default(false)
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
	limit: z.number().min(1).max(50).default(20),
	offset: z.number().min(0).default(0),
	structured: z.boolean().default(false)
});

export const MemoryDeleteSchema = z
	.object({
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		id: z.string().uuid().optional(),
		ids: z.array(z.string().uuid()).min(1).optional(),
		code: z.string().max(20).optional(),
		codes: z.array(z.string().max(20)).min(1).optional(),
		structured: z.boolean().default(false)
	})
	.refine(
		(data) => data.id !== undefined || data.ids !== undefined || data.code !== undefined || data.codes !== undefined,
		{
			message: "Either 'id', 'ids', 'code', or 'codes' must be provided for deletion"
		}
	);

export const MemoryDetailSchema = z
	.object({
		id: z.string().uuid().optional(),
		code: z.string().max(20).optional(),
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		structured: z.boolean().default(false)
	})
	.refine((data) => data.id !== undefined || data.code !== undefined, {
		message: "Either id or code must be provided"
	});

export const MemorySummarizeSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	signals: z.array(z.string().max(200)).min(1),
	structured: z.boolean().default(false)
});

export const MemorySynthesizeSchema = z.object({
	owner: z.string().min(1),
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
