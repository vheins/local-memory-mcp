import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";
import { TaskStatusSchema, TaskPrioritySchema, TaskStatusValues } from "./shared";

// TaskStatusListSchema — retained (TASK-116): consumed by TaskReadSchema.
// No longer exported — zero external consumers; only used within this module.
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
