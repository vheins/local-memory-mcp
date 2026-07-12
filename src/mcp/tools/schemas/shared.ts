import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";

export const MemoryScopeSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	branch: z.string().optional(),
	folder: z.string().optional(),
	language: z.string().optional()
});

export const MemoryTypeSchema = z.enum(["code_fact", "decision", "mistake", "pattern", "task_archive"]);

export const TaskStatusSchema = z.enum(["backlog", "pending", "in_progress", "completed", "canceled", "blocked"]);

export const TaskPrioritySchema = z.coerce.number().min(1).max(5);

export const HandoffStatusSchema = z.enum(["pending", "accepted", "rejected", "expired"]);

export const SingleMemorySchema = z.object({
	code: z.string().max(20).optional(),
	type: MemoryTypeSchema,
	title: z.string().min(3).max(255),
	content: z.string().min(10),
	importance: z.coerce.number().min(1).max(5),
	agent: z.string().min(1),
	role: z.string().optional().default("unknown"),
	model: z.string().min(1),
	scope: MemoryScopeSchema,
	ttlDays: z.coerce.number().min(1).optional(),
	supersedes: z.string().optional(),
	tags: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	is_global: z.boolean().default(false)
});

export const SingleStandardSchema = z.object({
	name: z.string().min(3).max(255),
	content: z.string().min(10),
	parent_id: z.string().optional(),
	context: z.string().optional(),
	version: z.string().optional(),
	language: z.string().optional(),
	stack: z.array(z.string()).optional(),
	is_global: z.boolean().optional(),
	tags: z.array(z.string().min(1)).min(1),
	metadata: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
		message: "metadata must contain at least one key"
	}),
	agent: z.string().optional(),
	model: z.string().optional()
});

export const TaskStatusValues = TaskStatusSchema.options as readonly string[];

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function isJsonSerializable(val: unknown): boolean {
	try {
		JSON.stringify(val);
		return true;
	} catch {
		return false;
	}
}

export const StructuredDataValue: z.ZodType<unknown> = z.lazy(() =>
	z.union([
		z.string(),
		z.number().refine((v) => Number.isFinite(v), "Number must be finite"),
		z.boolean(),
		z.null(),
		z.array(StructuredDataValue),
		z.record(z.string(), StructuredDataValue).refine(isPlainObject, "Plain object required")
	])
);

export const StructuredDataSchema = z
	.unknown()
	.refine(isJsonSerializable, { message: "Value must be JSON-serializable" })
	.pipe(z.record(z.string(), StructuredDataValue));
