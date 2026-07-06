import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";
import { HandoffStatusSchema } from "./shared";

export const HandoffCreateSchema = z
	.object({
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		from_agent: z.string().min(1),
		to_agent: z.string().min(1).optional(),
		task_id: z.string().uuid().optional(),
		task_code: z.string().optional(),
		summary: z.string().min(1),
		context: z.record(z.string(), z.unknown()).optional(),
		expires_at: z.string().optional(),
		structured: z.boolean().default(false)
	})
	.refine((data) => !(data.task_id && data.task_code), {
		message: "Provide either task_id or task_code, not both"
	})
	.refine(
		(data) =>
			data.to_agent ||
			data.task_id ||
			data.task_code ||
			data.context?.next_steps ||
			data.context?.blockers ||
			data.context?.remaining_work,
		{
			message:
				"Handoffs must identify a target agent, linked task, next_steps, blockers, or remaining_work. Do not create pending handoffs for completed-work summaries."
		}
	);

export const HandoffUpdateSchema = z.object({
	id: z.string().uuid(),
	status: HandoffStatusSchema,
	structured: z.boolean().default(false)
});

export const HandoffListSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	status: HandoffStatusSchema.optional(),
	from_agent: z.string().min(1).optional(),
	to_agent: z.string().min(1).optional(),
	limit: z.number().min(1).max(100).default(20),
	offset: z.number().min(0).default(0),
	structured: z.boolean().default(false)
});

export const TaskClaimSchema = z
	.object({
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		task_id: z.string().uuid().optional(),
		task_code: z.string().optional(),
		agent: z.string().min(1),
		role: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		structured: z.boolean().default(false)
	})
	.refine((data) => data.task_id !== undefined || data.task_code !== undefined, {
		message: "Either task_id or task_code must be provided"
	})
	.refine((data) => !(data.task_id && data.task_code), {
		message: "Provide either task_id or task_code, not both"
	});

export const ClaimListSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	agent: z.string().min(1).optional(),
	active_only: z.boolean().default(true),
	limit: z.number().min(1).max(100).default(20),
	offset: z.number().min(0).default(0),
	structured: z.boolean().default(false)
});

export const ClaimReleaseSchema = z
	.object({
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		task_id: z.string().uuid().optional(),
		task_code: z.string().optional(),
		agent: z.string().min(1).optional(),
		structured: z.boolean().default(false)
	})
	.refine((data) => data.task_id !== undefined || data.task_code !== undefined, {
		message: "Either task_id or task_code must be provided"
	})
	.refine((data) => !(data.task_id && data.task_code), {
		message: "Provide either task_id or task_code, not both"
	});
