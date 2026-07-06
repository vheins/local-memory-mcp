import { z } from "zod";

export const CreateEntitySchema = z.object({
	name: z.string().min(1).max(255),
	type: z.string().default("unknown"),
	description: z.string().optional(),
	owner: z.string().optional(),
	repo: z.string().optional(),
	structured: z.boolean().default(false)
});

export const DeleteEntitySchema = z.object({
	name: z.string().min(1),
	owner: z.string().optional(),
	repo: z.string().optional(),
	structured: z.boolean().default(false)
});

export const CreateRelationSchema = z.object({
	from_entity: z.string().min(1),
	to_entity: z.string().min(1),
	relation_type: z.string().min(1),
	owner: z.string().optional(),
	repo: z.string().optional(),
	structured: z.boolean().default(false)
});

export const DeleteRelationSchema = z.object({
	from_entity: z.string().min(1),
	to_entity: z.string().min(1),
	relation_type: z.string().min(1),
	owner: z.string().optional(),
	repo: z.string().optional(),
	structured: z.boolean().default(false)
});

export const DeleteObservationSchema = z.object({
	id: z.string().min(1),
	owner: z.string().optional(),
	repo: z.string().optional(),
	structured: z.boolean().default(false)
});
