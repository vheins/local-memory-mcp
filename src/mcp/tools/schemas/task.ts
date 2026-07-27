import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";
import { TaskStatusSchema, TaskPrioritySchema, TaskStatusValues } from "./shared";

const TaskMetadataSchema = z
	.record(z.string(), z.unknown())
	.optional()
	.superRefine((metadata, ctx) => {
		if (!metadata) return;
		if (metadata.required_skills !== undefined) {
			if (!Array.isArray(metadata.required_skills)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "metadata.required_skills must be an array of strings",
					path: ["metadata", "required_skills"]
				});
			} else if (metadata.required_skills.length === 0) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "metadata.required_skills must not be empty when present",
					path: ["metadata", "required_skills"]
				});
			} else if (!metadata.required_skills.every((s: unknown) => typeof s === "string" && s.length > 0)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "metadata.required_skills must be an array of non-empty strings",
					path: ["metadata", "required_skills"]
				});
			}
		}
		if (metadata.fsm_gates !== undefined) {
			if (!Array.isArray(metadata.fsm_gates)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "metadata.fsm_gates must be an array of strings",
					path: ["metadata", "fsm_gates"]
				});
			} else if (metadata.fsm_gates.length === 0) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "metadata.fsm_gates must not be empty when present",
					path: ["metadata", "fsm_gates"]
				});
			} else if (!metadata.fsm_gates.every((s: unknown) => typeof s === "string" && s.length > 0)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "metadata.fsm_gates must be an array of non-empty strings",
					path: ["metadata", "fsm_gates"]
				});
			}
		}
	});

const SingleTaskCreateSchema = z.object({
	task_code: z.string().min(1).optional(),
	phase: z.string().min(1),
	title: z.string().min(3).max(100),
	description: z.string().min(1),
	status: TaskStatusSchema.default("backlog"),
	priority: TaskPrioritySchema.default(3),
	agent: z.string().optional(),
	role: z.string().optional(),
	doc_path: z.string().optional(),
	tags: z.array(z.string()).optional(),
	suggested_skills: z.array(z.string()).optional(),
	metadata: TaskMetadataSchema,
	parent_id: z.string().optional(),
	depends_on: z.string().optional(),
	est_tokens: z.coerce.number().int().min(0).optional()
});

const TaskStatusListSchema = z.string().refine(
	(val) => {
		if (val === "all") return true;
		const parts = val
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (parts.length === 0) return false;
		return parts.every((p) => TaskStatusValues.includes(p));
	},
	{ message: "status must be 'all' or a comma-separated list of valid TaskStatus values" }
);

export { TaskMetadataSchema, SingleTaskCreateSchema, TaskStatusListSchema };

export const TaskCreateSchema = z
	.object({
		owner: z.string().min(1),
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
		suggested_skills: z.array(z.string()).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		parent_id: z.string().optional(),
		depends_on: z.string().optional(),
		est_tokens: z.coerce.number().int().min(0).optional(),
		// Allow bulk tasks
		tasks: z.array(SingleTaskCreateSchema).min(1).optional(),
		json: z.boolean().default(false)
	})
	.refine(
		(data) => {
			if (data.tasks) return true;
			return !!(data.phase && data.title && data.description);
		},
		{ message: "Either 'tasks' array or single task fields (phase, title, description) must be provided" }
	);

export const TaskCreateInteractiveSchema = SingleTaskCreateSchema.partial().extend({
	owner: z.string().optional().default(""),
	repo: z.string().min(1).transform(normalizeRepo).optional(),
	json: z.boolean().default(false)
});

export const TaskUpdateSchema = z
	.object({
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		id: z.string().optional(),
		ids: z.array(z.string()).min(1).optional(),
		task_code: z.string().optional(),
		task_codes: z.array(z.string().min(1)).min(1).optional(),
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
		metadata: z.record(z.string(), z.unknown()).optional(),
		suggested_skills: z.array(z.string()).optional(),
		parent_id: z.string().optional(),
		depends_on: z.string().optional(),
		est_tokens: z.coerce.number().int().min(0).optional(),
		commit_id: z.string().optional(),
		changed_files: z.array(z.string()).optional(),
		force: z.boolean().optional(),
		json: z.boolean().default(false)
	})
	.refine(
		(data) =>
			data.id !== undefined || data.ids !== undefined || data.task_code !== undefined || data.task_codes !== undefined,
		{
			message:
				"Either 'id' (UUID), 'ids' (array of UUIDs or codes), 'task_code' (string code like PERF-1), or 'task_codes' (array of string codes) must be provided."
		}
	)
	.refine((data) => Object.keys(data).length > 2, {
		message: "At least one field besides repo and id/ids must be provided for update"
	});

export const TaskListSchema = z.object({
	owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots"),
	repo: z
		.string()
		.min(1, "repo is required — provide it explicitly or configure MCP workspace roots")
		.transform(normalizeRepo),
	status: TaskStatusListSchema.default("backlog,pending,in_progress,blocked"),
	phase: z.string().optional(),
	query: z.string().optional(),
	limit: z.coerce.number().min(1).max(100).default(15),
	offset: z.coerce.number().min(0).default(0),
	json: z.boolean().default(false)
});

export const TaskSearchSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	query: z.string().min(1),
	status: z.string().optional(),
	phase: z.string().optional(),
	priority: z.coerce.number().min(1).max(5).optional(),
	limit: z.coerce.number().min(1).max(100).default(10),
	offset: z.coerce.number().min(0).default(0),
	json: z.boolean().default(false)
});

// ── Task Delete Schema (flat, zero oneOf) ──
// All identifiers are optional at schema level; handler validates at least one provided.
// Canonical identifiers per ADR-002: id (UUID), code (string), ids (UUID array), codes (string array).
// Backward compat aliases: task_code → code, task_codes → codes.

export const TaskDeleteSchema = z
	.object({
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		id: z.string().optional(),
		code: z.string().optional(),
		task_code: z.string().optional(),
		ids: z.array(z.string()).optional(),
		codes: z.array(z.string().min(1)).optional(),
		task_codes: z.array(z.string().min(1)).optional(),
		json: z.boolean().default(false)
	})
	.refine(
		(data) =>
			data.id !== undefined ||
			data.code !== undefined ||
			data.task_code !== undefined ||
			data.ids !== undefined ||
			data.codes !== undefined ||
			data.task_codes !== undefined,
		{
			message: "At least one of 'id', 'code', 'task_code', 'ids', 'codes', or 'task_codes' must be provided."
		}
	);

export const TaskGetSchema = z
	.object({
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		id: z.string().optional(),
		task_code: z.string().optional(),
		task_codes: z.array(z.string().min(1)).min(1).optional(),
		json: z.boolean().default(false)
	})
	.refine((data) => data.id !== undefined || data.task_code !== undefined || data.task_codes !== undefined, {
		message: "Either 'id', 'task_code', or 'task_codes' must be provided"
	});

// ── Task Read Schema (replaces task-list, task-detail, task-search) ──
// Zero oneOf — auto-infers mode from field presence:
//   - query → SEARCH (hybrid vector + keyword)
//   - id/task_code/ids/task_codes → DETAIL (single or bulk)
//   - none → LIST (filtered by status/phase with pagination)

export const TaskReadSchema = z.object({
	owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots"),
	repo: z
		.string()
		.min(1, "repo is required — provide it explicitly or configure MCP workspace roots")
		.transform(normalizeRepo),

	// SEARCH mode
	query: z.string().optional(),

	// DETAIL mode — code/codes per ADR-002 (identifier seragam: semua domain pakai id/code)
	code: z.string().optional(),
	codes: z.array(z.string().min(1)).min(1).optional(),
	id: z.string().optional(),
	task_code: z.string().optional(),
	ids: z.array(z.string()).min(1).optional(),
	task_codes: z.array(z.string().min(1)).min(1).optional(),

	// LIST / SEARCH filters
	status: TaskStatusListSchema.optional(),
	phase: z.string().optional(),
	priority: z.coerce.number().min(1).max(5).optional(),

	// Pagination (defaults set per-mode in handler: 10 for SEARCH, 15 for LIST)
	limit: z.coerce.number().min(1).max(100).optional(),
	offset: z.coerce.number().min(0).default(0),

	json: z.boolean().default(false)
});

// ── Task Write Schema (replaces task-create, task-create-interactive, task-update) ──
// Single flat schema — no oneOf. The handler uses auto-infer logic to determine
// the operation (CREATE, UPDATE, STATUS UPDATE, BULK, or INTERACTIVE) from the field combination.
//
// Auto-infer rules (in order of precedence):
//   1. `tasks: [...]`                  → BULK  — each item infers independently
//   2. `interactive: true`             → INTERACTIVE — elicit missing fields from user
//   3. `id` or `code` present           → UPDATE (id=UUID, code=string)
//   4. `phase` + `title` + `description` → CREATE (optionally with `code` for custom code)

const TaskWriteFieldDefs = {
	// Mutable fields (used for both create and update)
	phase: z.string().min(1).optional(),
	title: z.string().min(3).max(100).optional(),
	description: z.string().optional(),
	status: TaskStatusSchema.optional(),
	priority: TaskPrioritySchema.optional(),
	agent: z.string().optional(),
	role: z.string().optional(),
	model: z.string().optional(),
	comment: z.string().optional(),
	doc_path: z.string().optional(),
	tags: z.array(z.string()).optional(),
	suggested_skills: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	decision_refs: z.array(z.string()).optional(),
	parent_id: z.string().optional(),
	depends_on: z.string().optional(),
	est_tokens: z.coerce.number().int().min(0).optional(),
	commit_id: z.string().optional(),
	changed_files: z.array(z.string()).optional(),
	force: z.boolean().optional()
} as const;

/** Schema for a single item in the tasks[] bulk array. All fields optional — handler infers create vs update per item. */
export const TaskWriteItemSchema = z
	.object({
		id: z.string().optional(),
		code: z.string().optional(),
		task_code: z.string().optional(),
		phase: z.string().optional(),
		title: z.string().min(3).max(100).optional(),
		description: z.string().optional(),
		status: TaskStatusSchema.optional(),
		priority: TaskPrioritySchema.optional(),
		agent: z.string().optional(),
		role: z.string().optional(),
		doc_path: z.string().optional(),
		tags: z.array(z.string()).optional(),
		suggested_skills: z.array(z.string()).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		decision_refs: z.array(z.string()).optional(),
		parent_id: z.string().optional(),
		depends_on: z.string().optional(),
		est_tokens: z.coerce.number().int().min(0).optional()
	})
	.transform((data) => {
		if (data.task_code !== undefined && data.code === undefined) {
			return { ...data, code: data.task_code };
		}
		return data;
	});

/** Schema for task-write: single CREATE/UPDATE/BULK or INTERACTIVE via auto-infer. */
export const TaskWriteSchema = z
	.object({
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),

		// Interactive elicitation mode
		interactive: z.boolean().optional(),

		// Identification (for update)
		id: z.string().optional(),
		ids: z.array(z.string()).min(1).optional(),
		code: z.string().optional(),
		task_code: z.string().optional(),

		// Mutable fields
		...TaskWriteFieldDefs,

		// Bulk
		tasks: z.array(TaskWriteItemSchema).optional(),

		json: z.boolean().default(false)
	})
	.transform((data) => {
		// Map task_code → code if present (so handler looks at code field)
		if (data.task_code !== undefined && data.code === undefined) {
			return { ...data, code: data.task_code };
		}
		return data;
	});
