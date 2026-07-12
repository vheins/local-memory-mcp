import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";
import { SingleStandardSchema } from "./shared";

export const StandardStoreSchema = z
	.object({
		name: z.string().min(3).max(255).optional(),
		content: z.string().min(10).optional(),
		parent_id: z.string().optional(),
		context: z.string().optional(),
		version: z.string().optional(),
		language: z.string().optional(),
		stack: z.array(z.string()).optional(),
		owner: z.string().min(1),
		repo: z.string().transform(normalizeRepo).optional(),
		is_global: z.boolean().optional(),
		tags: z.array(z.string().min(1)).min(1).optional(),
		metadata: z
			.record(z.string(), z.unknown())
			.refine((value) => Object.keys(value).length > 0, { message: "metadata must contain at least one key" })
			.optional(),
		agent: z.string().optional(),
		model: z.string().optional(),
		structured: z.boolean().default(false),
		standards: z.array(SingleStandardSchema).min(1).optional()
	})
	.refine(
		(data) => {
			if (data.standards) return true;
			return !!(data.name && data.content && data.tags && data.metadata);
		},
		{ message: "Either 'standards' array or single standard fields (name, content, tags, metadata) must be provided" }
	)
	.refine((data) => data.is_global !== false || !!data.repo, {
		message: "repo is required for repo-specific standards"
	});

export const StandardUpdateSchema = z
	.object({
		id: z.string().optional(),
		code: z.string().max(20).optional(),
		name: z.string().min(3).max(255).optional(),
		content: z.string().min(10).optional(),
		parent_id: z.string().nullable().optional(),
		context: z.string().optional(),
		version: z.string().optional(),
		language: z.string().optional(),
		stack: z.array(z.string().min(1)).min(1).optional(),
		owner: z.string().min(1),
		repo: z.string().transform(normalizeRepo),
		is_global: z.boolean().optional(),
		tags: z.array(z.string().min(1)).min(1).optional(),
		metadata: z
			.record(z.string(), z.unknown())
			.refine((value) => Object.keys(value).length > 0, { message: "metadata must contain at least one key" })
			.optional(),
		agent: z.string().optional(),
		model: z.string().optional(),
		structured: z.boolean().default(false)
	})
	.refine((data) => data.id !== undefined || data.code !== undefined, {
		message: "Either id or code must be provided"
	})
	.refine(
		(data) =>
			data.name !== undefined ||
			data.content !== undefined ||
			data.parent_id !== undefined ||
			data.context !== undefined ||
			data.version !== undefined ||
			data.language !== undefined ||
			data.stack !== undefined ||
			data.repo !== undefined ||
			data.is_global !== undefined ||
			data.tags !== undefined ||
			data.metadata !== undefined ||
			data.agent !== undefined ||
			data.model !== undefined,
		{ message: "At least one field must be provided for update" }
	)
	.refine((data) => data.is_global !== false || !!data.repo, {
		message: "repo is required for repo-specific standards"
	});

export const StandardSearchSchema = z.object({
	query: z.string().optional(),
	stack: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	language: z.string().optional(),
	context: z.string().optional(),
	version: z.string().optional(),
	owner: z.string().optional().default(""),
	repo: z.string().transform(normalizeRepo).optional(),
	is_global: z.boolean().optional(),
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0),
	structured: z.boolean().default(false)
});

export const StandardDeleteSchema = z
	.object({
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		id: z.string().optional(),
		ids: z.array(z.string()).min(1).optional(),
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

export const StandardDetailSchema = z
	.object({
		id: z.string().optional(),
		code: z.string().max(20).optional(),
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		structured: z.boolean().default(false)
	})
	.refine((data) => data.id !== undefined || data.code !== undefined, {
		message: "Either id or code must be provided"
	});
