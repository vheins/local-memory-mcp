// Tool definitions for task domain

export const TASK_TOOL_DEFINITIONS = [
	{
		name: "task-create-interactive",
		title: "Interactive Task Create",
		description:
			"Creates task with elicitation fallback.",
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
					description:
						"Format: Context, Implementation, Acceptance."
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
		description:
			"Fetches full task details by ID or task code.",
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
		description:
			"Registers tasks. Single or bulk.",
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
					description:
						"Format: Context, Implementation, Acceptance."
				},
				status: {
					type: "string",
					enum: ["backlog", "pending"],
					default: "backlog",
					description:
						"Backlog if >=10 pending, else pending."
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
					description:
						"Parent task ID or code. Resolved to UUID."
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
								description:
									"Format: Context, Implementation, Acceptance."
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
								description:
									"Parent task ID or code. Resolved to UUID."
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
		description:
			"Updates tasks with status transition rules.",
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
					description:
						"Array of task codes."
				},
				phase: { type: "string" },
				title: { type: "string", minLength: 3, maxLength: 100 },
				description: {
					type: "string",
					description:
						"Format: Context, Implementation, Acceptance."
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
			"Deletes tasks. Single or bulk.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
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
				id: { type: "string", format: "uuid", description: "Task ID to delete." },
				ids: {
					type: "array",
					items: { type: "string", format: "uuid" },
					minItems: 1,
					description: "Task IDs for bulk delete."
				},
				task_code: {
					type: "string",
					description: "Task code to delete."
				},
				task_codes: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					description: "Task codes for bulk delete."
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			description: "Provide id, task_code, or task_codes (array).",
			oneOf: [
				{
					title: "By single ID",
					required: ["id"]
				},
				{
					title: "By bulk IDs",
					required: ["ids"]
				},
				{
					title: "By single code",
					required: ["task_code"]
				},
				{
					title: "By bulk codes",
					required: ["task_codes"]
				}
			]
		}
	},
	{
		name: "task-list",
		title: "Task List",
		description:
			"Task navigation with status filter.",
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
					description:
						"Filter: backlog,pending,in_progress,completed"
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
		name: "task-search",
		title: "Task Search",
		description:
			"Searches tasks. Compact results table.",
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
	}
];
