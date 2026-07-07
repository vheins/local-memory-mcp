// Tool definitions for task domain

export const TASK_TOOL_DEFINITIONS = [
	{
		name: "task-create-interactive",
		title: "Interactive Task Create",
		description:
			"Create a task with MCP elicitation fallback for any missing required fields. Best when an agent knows a task is needed but still needs user confirmation for repo, title, or phase.",
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
					description: "Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
				},
				task_code: { type: "string" },
				phase: { type: "string" },
				title: { type: "string", minLength: 3, maxLength: 100 },
				description: {
					type: "string",
					minLength: 1,
					description:
						"Detailed description. MUST follow format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification"
				},
				status: { type: "string", enum: ["backlog", "pending"], default: "backlog" },
				priority: {
					type: "number",
					minimum: 1,
					maximum: 5,
					default: 3,
					description: "Task priority where 1=Low, 2=Normal, 3=Medium, 4=High, 5=Critical."
				},
				agent: { type: "string" },
				role: { type: "string" },
				doc_path: { type: "string" },
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
			},
			required: []
		},
		outputSchema: {
			type: "object",
			properties: {
				repo: { type: "string" },
				task_code: { type: "string" },
				phase: { type: "string" },
				title: { type: "string" },
				status: { type: "string" },
				priority: { type: "number" }
			},
			required: ["repo", "task_code", "phase", "title", "status", "priority"]
		}
	},
	{
		name: "task-detail",
		title: "Task Detail",
		description:
			"Fetch full details of a specific task by ID or task code. Use this when you have a task ID or code and need to read the full description and comments.",
		inputSchema: {
			type: "object",
			oneOf: [
				{
					title: "By ID",
					required: ["id"],
					properties: {
						owner: {
							type: "string",
							description:
								"Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
						},
						repo: {
							type: "string",
							description:
								"Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
						},
						id: { type: "string", format: "uuid", description: "Task ID" },
						structured: {
							type: "boolean",
							default: false,
							description: "If true, returns structured JSON without the text content details."
						}
					}
				},
				{
					title: "By task_code",
					required: ["task_code"],
					properties: {
						owner: {
							type: "string",
							description:
								"Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
						},
						repo: {
							type: "string",
							description:
								"Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
						},
						task_code: {
							type: "string",
							description: "Task code (e.g. PERF-1, TASK-001). Use instead of 'id' for string code lookup."
						},
						structured: {
							type: "boolean",
							default: false,
							description: "If true, returns structured JSON without the text content details."
						}
					}
				},
				{
					title: "By task_codes",
					required: ["task_codes"],
					properties: {
						owner: {
							type: "string",
							description:
								"Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
						},
						repo: {
							type: "string",
							description:
								"Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
						},
						task_codes: {
							type: "array",
							items: { type: "string" },
							minItems: 1,
							description:
								"Array of task codes (e.g. PERF-1, TASK-001). Use instead of 'ids' when identifying tasks by code rather than UUID."
						},
						structured: {
							type: "boolean",
							default: false,
							description: "If true, returns structured JSON without the text content details."
						}
					}
				}
			]
		}
	},
	{
		name: "task-create",
		title: "Task Create",
		description:
			"Register one or more new tasks in a repository. task_code must be unique within the repository. Supports single task object or an array of tasks for bulk creation.",
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
					description: "Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
				},
				task_code: { type: "string", description: "Unique task code (e.g. TASK-001) (Required for single task)" },
				phase: { type: "string", description: "Project phase (Required for single task)" },
				title: {
					type: "string",
					minLength: 3,
					maxLength: 100,
					description: "Task objective (Required for single task)"
				},
				description: {
					type: "string",
					description:
						"Detailed description. MUST follow format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification"
				},
				status: {
					type: "string",
					enum: ["backlog", "pending"],
					default: "backlog",
					description:
						"New tasks MUST start in 'backlog' if there are already 10 pending tasks. Otherwise can start in 'pending'."
				},
				priority: {
					type: "number",
					minimum: 1,
					maximum: 5,
					default: 3,
					description: "Task priority where 1=Low, 2=Normal, 3=Medium, 4=High, 5=Critical."
				},
				agent: { type: "string", description: "Agent assigned to this task" },
				role: { type: "string", description: "Role of the assigned agent" },
				doc_path: { type: "string", description: "Path to related documentation file" },
				tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
				metadata: { type: "object", description: "Structured metadata for additional context" },
				parent_id: {
					type: "string",
					description:
						"Optional parent task ID (UUID) or parent task code (e.g. TASK-001). Resolved to UUID before storing."
				},
				depends_on: {
					type: "string",
					description: "Optional task ID (UUID) or task code (e.g. TASK-001). Resolved to UUID before storing."
				},
				est_tokens: { type: "number", minimum: 0, description: "Estimated tokens budget for this task" },
				tasks: {
					type: "array",
					items: {
						type: "object",
						properties: {
							task_code: { type: "string", description: "Unique task code (e.g. TASK-001)" },
							phase: { type: "string", description: "Project phase" },
							title: { type: "string", minLength: 3, maxLength: 100, description: "Task objective" },
							description: {
								type: "string",
								description:
									"Detailed description. MUST follow format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification"
							},
							status: { type: "string", enum: ["backlog", "pending"], default: "backlog", description: "Task status" },
							priority: {
								type: "number",
								minimum: 1,
								maximum: 5,
								default: 3,
								description: "Task priority where 1=Low, 2=Normal, 3=Medium, 4=High, 5=Critical."
							},
							agent: { type: "string", description: "Agent assigned to this task" },
							role: { type: "string", description: "Role of the assigned agent" },
							doc_path: { type: "string", description: "Path to related documentation file" },
							tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
							metadata: { type: "object", description: "Structured metadata for additional context" },
							parent_id: {
								type: "string",
								description:
									"Optional parent task ID (UUID) or parent task code (e.g. TASK-001). Resolved to UUID before storing."
							},
							depends_on: {
								type: "string",
								description: "Optional task ID (UUID) or task code (e.g. TASK-001). Resolved to UUID before storing."
							},
							est_tokens: { type: "number", minimum: 0 }
						},
						required: ["task_code", "phase", "title", "description"]
					},
					description: "Array of tasks for bulk creation"
				},
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
			},
			required: []
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				task_code: { type: "string" },
				repo: { type: "string" },
				phase: { type: "string" },
				title: { type: "string" },
				status: { type: "string" },
				priority: { type: "number" },
				createdCount: { type: "number" },
				taskCodes: { type: "array", items: { type: "string" } }
			},
			required: ["success", "repo"]
		}
	},
	{
		name: "task-update",
		title: "Task Update",
		description:
			"Update one or more tasks. Supports single update via 'id' (UUID) or 'task_code' (e.g. PERF-1), bulk via 'ids' (UUID array) or 'task_codes' (string array). Use 'task_code'/'task_codes' for human-readable identifiers, 'id'/'ids' for UUID lookups. Provide only the fields that need to be changed. MANDATORY WORKFLOW: Cannot move 'pending'/'blocked' → 'completed' directly; MUST go through 'in_progress' first. Include 'est_tokens' when moving to 'completed'.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			oneOf: [
				{
					title: "By ID",
					required: ["id"],
					properties: {
						owner: {
							type: "string",
							description:
								"Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
						},
						repo: {
							type: "string",
							description:
								"Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
						},
						id: { type: "string", format: "uuid", description: "Task ID (for single update)" },
						phase: { type: "string" },
						title: { type: "string", minLength: 3, maxLength: 100 },
						description: {
							type: "string",
							description:
								"Detailed description. MUST follow format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification"
						},
						status: {
							type: "string",
							enum: ["backlog", "pending", "in_progress", "completed", "canceled", "blocked"],
							description:
								"New status. Transitions from 'backlog', 'pending' or 'blocked' to 'completed' are NOT allowed."
						},
						priority: {
							type: "number",
							minimum: 1,
							maximum: 5,
							description: "Task priority where 1=Low, 2=Normal, 3=Medium, 4=High, 5=Critical."
						},
						agent: { type: "string" },
						role: { type: "string" },
						model: { type: "string" },
						comment: {
							type: "string",
							description:
								"REQUIRED when changing task status. Explain WHY the status is changing (e.g., 'Starting implementation', 'Blocked by missing API docs', 'Verified fix')."
						},
						doc_path: { type: "string" },
						tags: { type: "array", items: { type: "string" } },
						metadata: { type: "object" },
						parent_id: {
							type: "string",
							description:
								"Optional parent task ID (UUID) or parent task code (e.g. TASK-001). Resolved to UUID before storing."
						},
						depends_on: {
							type: "string",
							description: "Optional task ID (UUID) or task code (e.g. TASK-001). Resolved to UUID before storing."
						},
						est_tokens: {
							type: "number",
							minimum: 0,
							description:
								"Estimated total tokens actually used for this task. Required when status changes to 'completed'."
						},
						commit_id: {
							type: "string",
							description: "Git commit hash. Recommended when status changes to 'completed' for traceability."
						},
						changed_files: {
							type: "array",
							items: { type: "string" },
							description: "List of files changed. Recommended when status changes to 'completed' for traceability."
						},
						force: {
							type: "boolean",
							description: "If true, bypasses status transition validation (e.g. pending -> completed)."
						},
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By IDs",
					required: ["ids"],
					properties: {
						owner: {
							type: "string",
							description:
								"Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
						},
						repo: {
							type: "string",
							description:
								"Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
						},
						ids: {
							type: "array",
							items: { type: "string", format: "uuid" },
							description:
								"Task UUIDs (for bulk update). NOT task codes — use 'task_codes' for PERF-1 style identifiers."
						},
						phase: { type: "string" },
						title: { type: "string", minLength: 3, maxLength: 100 },
						description: {
							type: "string",
							description:
								"Detailed description. MUST follow format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification"
						},
						status: {
							type: "string",
							enum: ["backlog", "pending", "in_progress", "completed", "canceled", "blocked"],
							description:
								"New status. Transitions from 'backlog', 'pending' or 'blocked' to 'completed' are NOT allowed."
						},
						priority: {
							type: "number",
							minimum: 1,
							maximum: 5,
							description: "Task priority where 1=Low, 2=Normal, 3=Medium, 4=High, 5=Critical."
						},
						agent: { type: "string" },
						role: { type: "string" },
						model: { type: "string" },
						comment: {
							type: "string",
							description:
								"REQUIRED when changing task status. Explain WHY the status is changing (e.g., 'Starting implementation', 'Blocked by missing API docs', 'Verified fix')."
						},
						doc_path: { type: "string" },
						tags: { type: "array", items: { type: "string" } },
						metadata: { type: "object" },
						parent_id: {
							type: "string",
							description:
								"Optional parent task ID (UUID) or parent task code (e.g. TASK-001). Resolved to UUID before storing."
						},
						depends_on: {
							type: "string",
							description: "Optional task ID (UUID) or task code (e.g. TASK-001). Resolved to UUID before storing."
						},
						est_tokens: {
							type: "number",
							minimum: 0,
							description:
								"Estimated total tokens actually used for this task. Required when status changes to 'completed'."
						},
						commit_id: {
							type: "string",
							description: "Git commit hash. Recommended when status changes to 'completed' for traceability."
						},
						changed_files: {
							type: "array",
							items: { type: "string" },
							description: "List of files changed. Recommended when status changes to 'completed' for traceability."
						},
						force: {
							type: "boolean",
							description: "If true, bypasses status transition validation (e.g. pending -> completed)."
						},
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By task_code",
					required: ["task_code"],
					properties: {
						owner: {
							type: "string",
							description:
								"Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
						},
						repo: {
							type: "string",
							description:
								"Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
						},
						task_code: { type: "string" },
						phase: { type: "string" },
						title: { type: "string", minLength: 3, maxLength: 100 },
						description: {
							type: "string",
							description:
								"Detailed description. MUST follow format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification"
						},
						status: {
							type: "string",
							enum: ["backlog", "pending", "in_progress", "completed", "canceled", "blocked"],
							description:
								"New status. Transitions from 'backlog', 'pending' or 'blocked' to 'completed' are NOT allowed."
						},
						priority: {
							type: "number",
							minimum: 1,
							maximum: 5,
							description: "Task priority where 1=Low, 2=Normal, 3=Medium, 4=High, 5=Critical."
						},
						agent: { type: "string" },
						role: { type: "string" },
						model: { type: "string" },
						comment: {
							type: "string",
							description:
								"REQUIRED when changing task status. Explain WHY the status is changing (e.g., 'Starting implementation', 'Blocked by missing API docs', 'Verified fix')."
						},
						doc_path: { type: "string" },
						tags: { type: "array", items: { type: "string" } },
						metadata: { type: "object" },
						parent_id: {
							type: "string",
							description:
								"Optional parent task ID (UUID) or parent task code (e.g. TASK-001). Resolved to UUID before storing."
						},
						depends_on: {
							type: "string",
							description: "Optional task ID (UUID) or task code (e.g. TASK-001). Resolved to UUID before storing."
						},
						est_tokens: {
							type: "number",
							minimum: 0,
							description:
								"Estimated total tokens actually used for this task. Required when status changes to 'completed'."
						},
						commit_id: {
							type: "string",
							description: "Git commit hash. Recommended when status changes to 'completed' for traceability."
						},
						changed_files: {
							type: "array",
							items: { type: "string" },
							description: "List of files changed. Recommended when status changes to 'completed' for traceability."
						},
						force: {
							type: "boolean",
							description: "If true, bypasses status transition validation (e.g. pending -> completed)."
						},
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By task_codes",
					required: ["task_codes"],
					properties: {
						owner: {
							type: "string",
							description:
								"Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
						},
						repo: {
							type: "string",
							description:
								"Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
						},
						task_codes: {
							type: "array",
							items: { type: "string" },
							minItems: 1,
							description:
								"Array of task codes (e.g. PERF-1, TASK-001). Use instead of 'ids' when identifying tasks by code rather than UUID."
						},
						phase: { type: "string" },
						title: { type: "string", minLength: 3, maxLength: 100 },
						description: {
							type: "string",
							description:
								"Detailed description. MUST follow format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification"
						},
						status: {
							type: "string",
							enum: ["backlog", "pending", "in_progress", "completed", "canceled", "blocked"],
							description:
								"New status. Transitions from 'backlog', 'pending' or 'blocked' to 'completed' are NOT allowed."
						},
						priority: {
							type: "number",
							minimum: 1,
							maximum: 5,
							description: "Task priority where 1=Low, 2=Normal, 3=Medium, 4=High, 5=Critical."
						},
						agent: { type: "string" },
						role: { type: "string" },
						model: { type: "string" },
						comment: {
							type: "string",
							description:
								"REQUIRED when changing task status. Explain WHY the status is changing (e.g., 'Starting implementation', 'Blocked by missing API docs', 'Verified fix')."
						},
						doc_path: { type: "string" },
						tags: { type: "array", items: { type: "string" } },
						metadata: { type: "object" },
						parent_id: {
							type: "string",
							description:
								"Optional parent task ID (UUID) or parent task code (e.g. TASK-001). Resolved to UUID before storing."
						},
						depends_on: {
							type: "string",
							description: "Optional task ID (UUID) or task code (e.g. TASK-001). Resolved to UUID before storing."
						},
						est_tokens: {
							type: "number",
							minimum: 0,
							description:
								"Estimated total tokens actually used for this task. Required when status changes to 'completed'."
						},
						commit_id: {
							type: "string",
							description: "Git commit hash. Recommended when status changes to 'completed' for traceability."
						},
						changed_files: {
							type: "array",
							items: { type: "string" },
							description: "List of files changed. Recommended when status changes to 'completed' for traceability."
						},
						force: {
							type: "boolean",
							description: "If true, bypasses status transition validation (e.g. pending -> completed)."
						},
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				}
			]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				ids: { type: "array", items: { type: "string" } },
				repo: { type: "string" },
				status: { type: "string" },
				archivedToMemory: { type: "boolean" },
				updatedFields: {
					type: "array",
					items: { type: "string" }
				},
				updatedCount: { type: "number" }
			},
			required: ["success", "repo"]
		}
	},
	{
		name: "task-delete",
		title: "Task Delete",
		description: "Delete one or more tasks from a repository. Supports single 'id' or bulk 'ids'.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			oneOf: [
				{
					title: "By ID",
					required: ["id"],
					properties: {
						owner: {
							type: "string",
							description:
								"Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
						},
						repo: {
							type: "string",
							description:
								"Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
						},
						id: { type: "string", format: "uuid", description: "Task ID (for single deletion)" },
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By IDs",
					required: ["ids"],
					properties: {
						owner: {
							type: "string",
							description:
								"Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
						},
						repo: {
							type: "string",
							description:
								"Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
						},
						ids: {
							type: "array",
							items: { type: "string", format: "uuid" },
							description:
								"Task UUIDs (for bulk deletion). NOT task codes — use 'task_codes' for PERF-1 style identifiers."
						},
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By task_code",
					required: ["task_code"],
					properties: {
						owner: {
							type: "string",
							description:
								"Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
						},
						repo: {
							type: "string",
							description:
								"Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
						},
						task_code: {
							type: "string",
							description: "Task code (e.g. PERF-1, TASK-001). Use instead of 'id' for string code lookup."
						},
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By task_codes",
					required: ["task_codes"],
					properties: {
						owner: {
							type: "string",
							description:
								"Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
						},
						repo: {
							type: "string",
							description:
								"Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
						},
						task_codes: {
							type: "array",
							items: { type: "string" },
							minItems: 1,
							description:
								"Array of task codes (e.g. PERF-1, TASK-001). Use instead of 'ids' when identifying tasks by code rather than UUID."
						},
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				}
			]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				task_code: { type: "string" },
				ids: { type: "array", items: { type: "string" } },
				repo: { type: "string" },
				deletedCount: { type: "number" }
			},
			required: ["success", "repo"]
		}
	},
	{
		name: "task-list",
		title: "Task List",
		description:
			"PRIMARY navigation and search tool for tasks. Returns a compact tabular list of tasks (id, task_code, title, status, priority, updated_at, comments_count). Defaults to backlog, pending, in_progress, and blocked tasks. Use 'status' (comma-separated) to override or 'all' for all statuses. AGENTS: call this once at start, pick ONE task, then call task-detail.",
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
					description: "Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
				},
				status: {
					type: "string",
					default: "backlog,pending,in_progress,blocked",
					description:
						"Comma-separated status filter (backlog, pending, in_progress, completed, canceled, blocked) or 'all' for all statuses. Defaults to 'backlog,pending,in_progress,blocked'."
				},
				phase: {
					type: "string",
					description: "Filter by phase (e.g., 'research', 'implementation')"
				},
				query: {
					type: "string",
					description: "Search keyword matching task code, title, or description"
				},
				limit: {
					type: "number",
					minimum: 1,
					maximum: 100,
					default: 5,
					description: "Maximum rows to return (default 5)"
				},
				offset: {
					type: "number",
					minimum: 0,
					default: 0,
					description: "Offset for pagination"
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON without the text content summary."
				}
			},
			required: []
		},
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "string", enum: ["task-list"] },
				tasks: {
					type: "object",
					properties: {
						columns: {
							type: "array",
							items: { type: "string" },
							description: "Column names in order: id, task_code, title, status, priority, updated_at, comments_count"
						},
						rows: {
							type: "array",
							items: { type: "array" },
							description:
								"Each row: [id, task_code, title, status, priority, updated_at, comments_count]. Use task-detail to fetch full task."
						}
					},
					required: ["columns", "rows"]
				},
				count: { type: "number" },
				offset: { type: "number" }
			},
			required: ["schema", "tasks", "count"]
		}
	},
	{
		name: "task-search",
		title: "Task Search",
		description:
			"Dedicated search tool for tasks. Returns a compact pointer table of matching tasks [id, task_code, title, status, priority, updated_at, phase]. Use task-detail for full task content.",
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
					description: "Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
				},
				query: {
					type: "string",
					minLength: 1,
					description: "Search keyword matching task code, title, or description"
				},
				status: { type: "string", description: "Optional status filter (single or comma-separated)" },
				phase: { type: "string", description: "Filter by phase (e.g., 'research', 'implementation')" },
				priority: { type: "number", minimum: 1, maximum: 5, description: "Filter by priority (1-5)" },
				limit: { type: "number", minimum: 1, maximum: 100, default: 10 },
				offset: { type: "number", minimum: 0, default: 0 },
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
			},
			required: ["query"]
		},
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "string", enum: ["task-search"] },
				query: { type: "string" },
				count: { type: "number", description: "Number of rows returned" },
				total: { type: "number", description: "Total matching tasks before pagination" },
				offset: { type: "number" },
				limit: { type: "number" },
				results: {
					type: "object",
					properties: {
						columns: {
							type: "array",
							items: { type: "string" },
							description: "Column names: [id, task_code, title, status, priority, updated_at, phase]"
						},
						rows: {
							type: "array",
							items: { type: "array" },
							description:
								"Each row: [id, task_code, title, status, priority, updated_at, phase]. Use task-detail to fetch full task."
						}
					},
					required: ["columns", "rows"]
				}
			},
			required: ["schema", "query", "count", "total", "offset", "limit", "results"]
		}
	}
];
