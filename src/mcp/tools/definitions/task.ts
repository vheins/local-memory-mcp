// Tool definitions for task domain

export const TASK_TOOL_DEFINITIONS = [
	{
		name: "task-create-interactive",
		title: "Interactive Task Create",
		description: "Creates task with elicitation fallback.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				task_code: { type: "string" },
				phase: { type: "string" },
				title: { type: "string", minLength: 3, maxLength: 100 },
				description: {
					type: "string",
					minLength: 1,
					description: "Format: Context, Implementation, Acceptance."
				},
				status: { type: "string", enum: ["backlog", "pending"], default: "backlog" },
				priority: {
					type: "number",
					minimum: 1,
					maximum: 5,
					default: 3,
					description: "Task priority from 1 (Low) to 5 (Critical)."
				},
				agent: { type: "string" },
				role: { type: "string" },
				doc_path: { type: "string" },
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: []
		}
	},
	{
		name: "task-detail",
		title: "Task Detail",
		description: "Fetches full task details by ID or task code.",
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				id: { type: "string", format: "uuid", description: "Task ID (UUID)." },
				task_code: {
					type: "string",
					description: "Task code string identifier."
				},
				task_codes: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					description: "Array of task codes."
				},
				json: {
					type: "boolean",
					default: false,
					description: "Returns JSON without text details."
				}
			},
			description: "Provide id, task_code, or task_codes (array).",
			oneOf: [
				{
					title: "By ID",
					required: ["id"]
				},
				{
					title: "By task_code",
					required: ["task_code"]
				},
				{
					title: "By task_codes",
					required: ["task_codes"]
				}
			]
		}
	},
	{
		name: "task-create",
		title: "Task Create",
		description: "Registers tasks. Single or bulk.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				task_code: {
					type: "string",
					description: "Unique task code. Auto-generated if omitted."
				},
				phase: { type: "string", description: "Project phase (required for single)." },
				title: {
					type: "string",
					minLength: 3,
					maxLength: 100,
					description: "Task objective (required for single)."
				},
				description: {
					type: "string",
					description: "Format: Context, Implementation, Acceptance."
				},
				status: {
					type: "string",
					enum: ["backlog", "pending"],
					default: "backlog",
					description: "Backlog if >=10 pending, else pending."
				},
				priority: {
					type: "number",
					minimum: 1,
					maximum: 5,
					default: 3,
					description: "Task priority from 1 (Low) to 5 (Critical)."
				},
				agent: { type: "string", description: "Agent assigned to this task" },
				role: { type: "string", description: "Role of the assigned agent" },
				doc_path: { type: "string", description: "Path to related documentation file" },
				tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
				metadata: { type: "object", description: "Optional structured metadata." },
				parent_id: {
					type: "string",
					description: "Parent task ID or code. Resolved to UUID."
				},
				depends_on: {
					type: "string",
					description: "Depends-on task ID or code. Resolved to UUID."
				},
				est_tokens: { type: "number", minimum: 0, description: "Estimated token budget." },
				tasks: {
					type: "array",
					items: {
						type: "object",
						properties: {
							task_code: { type: "string", description: "Unique task code." },
							phase: { type: "string", description: "Project phase" },
							title: { type: "string", minLength: 3, maxLength: 100, description: "Task objective" },
							description: {
								type: "string",
								description: "Format: Context, Implementation, Acceptance."
							},
							status: { type: "string", enum: ["backlog", "pending"], default: "backlog", description: "Task status" },
							priority: {
								type: "number",
								minimum: 1,
								maximum: 5,
								default: 3,
								description: "Task priority from 1 (Low) to 5 (Critical)."
							},
							agent: { type: "string", description: "Agent assigned to this task" },
							role: { type: "string", description: "Role of the assigned agent" },
							doc_path: { type: "string", description: "Path to related documentation file" },
							tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
							metadata: { type: "object", description: "Optional structured metadata." },
							parent_id: {
								type: "string",
								description: "Parent task ID or code. Resolved to UUID."
							},
							depends_on: {
								type: "string",
								description: "Depends-on task ID or code. Resolved to UUID."
							},
							est_tokens: { type: "number", minimum: 0 }
						},
						required: ["task_code", "phase", "title", "description"]
					},
					description: "Array of tasks for bulk creation"
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			oneOf: [
				{
					title: "Single task",
					required: ["phase", "title", "description"]
				},
				{
					title: "Bulk tasks",
					required: ["tasks"]
				}
			]
		}
	},
	{
		name: "task-update",
		title: "Task Update",
		description: "Updates tasks with status transition rules.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				id: { type: "string", format: "uuid", description: "Task ID for single update." },
				ids: {
					type: "array",
					items: { type: "string", format: "uuid" },
					description: "Task UUIDs for bulk update."
				},
				task_code: {
					type: "string",
					description: "Task code string identifier."
				},
				task_codes: {
					type: "array",
					items: { type: "string" },
					description: "Array of task codes."
				},
				phase: { type: "string" },
				title: { type: "string", minLength: 3, maxLength: 100 },
				description: {
					type: "string",
					description: "Format: Context, Implementation, Acceptance."
				},
				status: {
					type: "string",
					enum: ["backlog", "pending", "in_progress", "completed", "canceled", "blocked"],
					description: "New status. Some transitions are blocked."
				},
				priority: {
					type: "number",
					minimum: 1,
					maximum: 5,
					description: "Task priority from 1 (Low) to 5 (Critical)."
				},
				agent: { type: "string" },
				role: { type: "string" },
				model: { type: "string" },
				comment: {
					type: "string",
					description: "Required when changing status."
				},
				doc_path: { type: "string" },
				tags: { type: "array", items: { type: "string" } },
				metadata: { type: "object" },
				parent_id: {
					type: "string",
					description: "Parent task ID or code."
				},
				depends_on: {
					type: "string",
					description: "Depends-on task ID or code."
				},
				est_tokens: {
					type: "number",
					minimum: 0,
					description: "Required when status is completed."
				},
				commit_id: {
					type: "string",
					description: "Git commit hash for completed tasks."
				},
				changed_files: {
					type: "array",
					items: { type: "string" },
					description: "Files changed for completed tasks."
				},
				force: {
					type: "boolean",
					description: "Bypasses status transition validation."
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			description: "Provide id, task_code, or task_codes.",
			oneOf: [
				{
					title: "By ID",
					required: ["id"]
				},
				{
					title: "By IDs",
					required: ["ids"]
				},
				{
					title: "By task_code",
					required: ["task_code"]
				},
				{
					title: "By task_codes",
					required: ["task_codes"]
				}
			]
		}
	},
	{
		name: "task-delete",
		title: "Task Delete",
		description:
			"Soft-deletes tasks (sets status to 'canceled'). Single or bulk. Remove task vectors, release claims, expire handoffs.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				id: { type: "string", description: "Task ID (UUID or task_code) to delete." },
				code: { type: "string", description: "Task code to delete (alias for task_code)." },
				task_code: { type: "string", description: "Task code to delete." },
				ids: {
					type: "array",
					items: { type: "string" },
					description: "Task IDs for bulk delete (UUIDs or task_codes)."
				},
				task_codes: {
					type: "array",
					items: { type: "string" },
					description: "Task codes for bulk delete."
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			description: "Zero oneOf — all optional; at least one identifier required."
		}
	},
	{
		name: "task-list",
		title: "Task List",
		description: "Task navigation with status filter.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				status: {
					type: "string",
					default: "backlog,pending,in_progress,blocked",
					description: "Filter: backlog,pending,in_progress,completed"
				},
				phase: {
					type: "string",
					description: "Filter by project phase."
				},
				query: {
					type: "string",
					description: "Search by code, title, or description."
				},
				limit: {
					type: "number",
					minimum: 1,
					maximum: 100,
					default: 5,
					description: "Max results (default 5)."
				},
				offset: {
					type: "number",
					minimum: 0,
					default: 0,
					description: "Offset for pagination"
				},
				json: {
					type: "boolean",
					default: false,
					description: "Returns JSON without text summary."
				}
			},
			required: []
		}
	},
	{
		name: "task-write",
		title: "Task Write",
		description:
			"Creates, updates, or performs status transitions on tasks. Zero oneOf — auto-infers mode from field combination:\n" +
			"  - `tasks[]` → BULK (each item infers independently: create if phase+title+desc, update if id/code)\n" +
			"  - `interactive: true` → INTERACTIVE (elicit missing fields via form, then create)\n" +
			"  - `id` or `code` → UPDATE (single by UUID or code)\n" +
			"  - `phase` + `title` + `description` → CREATE (optionally with `code` for custom code)",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				interactive: {
					type: "boolean",
					description:
						"Set to true to trigger interactive elicitation for missing fields (creates task after form completion)."
				},
				id: {
					type: "string",
					description: "Task UUID for single update. Provide to identify the task to update."
				},
				code: {
					type: "string",
					description:
						"Task code for update (when used without create fields) or custom code for create (when used with phase+title+desc). Auto-generated if omitted on create."
				},
				phase: {
					type: "string",
					description: "Project phase (required for single create or interactive)."
				},
				title: {
					type: "string",
					minLength: 3,
					maxLength: 100,
					description: "Task objective (required for single create or interactive)."
				},
				description: {
					type: "string",
					description: "Format: Context, Implementation, Acceptance. Required for create/interactive."
				},
				status: {
					type: "string",
					enum: ["backlog", "pending", "in_progress", "completed", "canceled", "blocked"],
					description:
						"New status. State machine rules: comment required, children gate for completed, claims auto-release."
				},
				priority: {
					type: "number",
					minimum: 1,
					maximum: 5,
					description: "Task priority from 1 (Low) to 5 (Critical)."
				},
				agent: { type: "string", description: "Agent assigned to this task" },
				role: { type: "string", description: "Role of the assigned agent" },
				model: { type: "string" },
				comment: {
					type: "string",
					description: "Required when changing status (unless force=true)."
				},
				doc_path: { type: "string", description: "Path to related documentation file" },
				tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
				suggested_skills: { type: "array", items: { type: "string" } },
				metadata: { type: "object", description: "Optional structured metadata." },
				decision_refs: {
					type: "array",
					items: { type: "string" },
					description: "Decision memory codes/IDs referenced by this task. Stored in metadata.decision_refs."
				},
				parent_id: {
					type: "string",
					description: "Parent task ID or code. Resolved to UUID."
				},
				depends_on: {
					type: "string",
					description: "Depends-on task ID or code. Resolved to UUID."
				},
				est_tokens: {
					type: "number",
					minimum: 0,
					description: "Estimated token budget. Required when completing a task."
				},
				commit_id: {
					type: "string",
					description: "Git commit hash for completed tasks."
				},
				changed_files: {
					type: "array",
					items: { type: "string" },
					description: "Files changed for completed tasks."
				},
				force: {
					type: "boolean",
					description: "Bypasses status transition validation."
				},
				tasks: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string", description: "Task UUID (for update items in bulk)." },
							code: { type: "string", description: "Task code (custom code for create, or identifier for update)." },
							phase: { type: "string", description: "Project phase (required for create items)." },
							title: {
								type: "string",
								minLength: 3,
								maxLength: 100,
								description: "Task objective (required for create items)."
							},
							description: { type: "string", description: "Task description (required for create items)." },
							status: {
								type: "string",
								enum: ["backlog", "pending", "in_progress", "completed", "canceled", "blocked"],
								description: "Task status"
							},
							priority: {
								type: "number",
								minimum: 1,
								maximum: 5,
								default: 3,
								description: "Task priority from 1 (Low) to 5 (Critical)."
							},
							agent: { type: "string", description: "Agent assigned to this task" },
							role: { type: "string", description: "Role of the assigned agent" },
							doc_path: { type: "string", description: "Path to related documentation file" },
							tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
							suggested_skills: { type: "array", items: { type: "string" } },
							metadata: { type: "object", description: "Optional structured metadata." },
							decision_refs: {
								type: "array",
								items: { type: "string" },
								description: "Decision memory codes referenced by this task."
							},
							parent_id: { type: "string", description: "Parent task ID or code. Resolved to UUID." },
							depends_on: { type: "string", description: "Depends-on task ID or code. Resolved to UUID." },
							est_tokens: { type: "number", minimum: 0, description: "Estimated token budget." }
						},
						description:
							"Each item can be a CREATE (has phase+title+desc) or UPDATE (has id/code). Handler infers intent."
					},
					description: "Array of tasks for bulk create/update. Each item infers independently."
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: []
		}
	},
	{
		name: "task-search",
		title: "Task Search",
		description: "Searches tasks. Compact results table.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				query: {
					type: "string",
					minLength: 1,
					description: "Search by code, title, or description."
				},
				status: { type: "string", description: "Status filter (single or comma-separated)." },
				phase: { type: "string", description: "Filter by project phase." },
				priority: { type: "number", minimum: 1, maximum: 5, description: "Filter by priority (1-5)" },
				limit: { type: "number", minimum: 1, maximum: 100, default: 10 },
				offset: { type: "number", minimum: 0, default: 0 },
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: ["query"]
		}
	},
	{
		name: "task-read",
		title: "Task Read",
		description:
			"Unified task read: search, detail, or list. Auto-infers mode from params — query→SEARCH, id/task_code/ids/task_codes→DETAIL, none→LIST.\n\n" +
			"SEARCH mode: hybrid keyword search across tasks with status/phase/priority filters.\n" +
			"DETAIL mode: full task object with comments, children, and depended_by (single or bulk via id/task_code or ids/task_codes).\n" +
			'LIST mode: paginated listing filtered by status (comma-separated or "all") and phase.',
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				// SEARCH mode
				query: {
					type: "string",
					description: "Search by code, title, or description (triggers SEARCH mode)."
				},
				// DETAIL mode — canonical fields per ADR-002
				code: {
					type: "string",
					description: "Task code for single detail lookup (canonical, replaces task_code)."
				},
				codes: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					description: "Array of task codes for bulk detail lookup (canonical, replaces task_codes)."
				},
				id: {
					type: "string",
					description: "Task ID (UUID) for single detail lookup."
				},
				task_code: {
					type: "string",
					description: "Task code for single detail lookup (legacy alias for code)."
				},
				ids: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					description: "Array of task IDs (UUIDs) for bulk detail lookup."
				},
				task_codes: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					description: "Array of task codes for bulk detail lookup (legacy alias for codes)."
				},
				// LIST / SEARCH filters
				status: {
					type: "string",
					description:
						'Status filter: comma-separated (e.g. "pending,in_progress") or "all". Default in LIST mode: backlog,pending,in_progress,blocked.'
				},
				phase: {
					type: "string",
					description: "Filter by project phase."
				},
				priority: {
					type: "number",
					minimum: 1,
					maximum: 5,
					description: "Filter by priority (1-5) — SEARCH mode only."
				},
				// Pagination
				limit: {
					type: "number",
					minimum: 1,
					maximum: 100,
					default: 15,
					description: "Max results (default 15 for LIST, 10 for SEARCH)."
				},
				offset: {
					type: "number",
					minimum: 0,
					default: 0,
					description: "Pagination offset"
				},
				json: {
					type: "boolean",
					default: false,
					description: "Returns JSON without text summary."
				}
			},
			description:
				"Zero oneOf — auto-infers mode from field presence: query→SEARCH, id/task_code/ids/task_codes/code/codes→DETAIL, none→LIST."
		}
	}
];
