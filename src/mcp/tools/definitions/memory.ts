// Tool definitions for memory domain

export const MEMORY_TOOL_DEFINITIONS = [
	// ── Canonical tools ──────────────────────────────────────────────────
	{
		name: "memory-write",
		title: "Memory Write",
		description:
			"Create, update, or acknowledge memories. Single or bulk.\n\n" +
			"Auto-infer logic:\n" +
			"- `content` (no `id`/`code`) → CREATE single memory (was memory-store)\n" +
			"- `id`/`code` + fields → UPDATE (was memory-update)\n" +
			"- `id`/`code` + `acknowledge` → ACKNOWLEDGE (was memory-acknowledge)\n" +
			"- `memories[]` → BULK (mixed create/update/acknowledge items)",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username. Auto-inferred." },
				repo: { type: "string", description: "Repo name. Auto-inferred." },
				json: { type: "boolean", default: false, description: "Returns JSON if true." },

				// CREATE fields
				type: {
					type: "string",
					enum: ["code_fact", "decision", "mistake", "pattern", "task_archive"],
					description: "Knowledge type (required for CREATE)."
				},
				title: {
					type: "string",
					minLength: 3,
					maxLength: 255,
					description: "Short title for memory (required for CREATE)."
				},
				content: { type: "string", minLength: 10, description: "Memory content (required for CREATE)." },
				importance: {
					type: "number",
					minimum: 1,
					maximum: 5,
					description: "Importance score 1-5 (required for CREATE)."
				},
				code: { type: "string", maxLength: 20, description: "Optional custom code." },
				ttlDays: { type: "number", minimum: 1, description: "TTL in days." },
				supersedes: { type: "string", description: "UUID or code to supersede." },
				tags: { type: "array", items: { type: "string" }, description: "Tech stack tags." },
				metadata: { type: "object", description: "Structured metadata." },
				is_global: { type: "boolean", default: false, description: "Global if true." },
				scope: {
					type: "object",
					properties: {
						owner: { type: "string" },
						repo: { type: "string" },
						branch: { type: "string" },
						folder: { type: "string" },
						language: { type: "string" }
					},
					description: "Scope for owner/repo/branch/folder/language."
				},

				// UPDATE fields
				id: { type: "string", format: "uuid", description: "Memory UUID for UPDATE/ACKNOWLEDGE." },
				agent: { type: "string", description: "Agent name." },
				role: { type: "string", default: "unknown", description: "Agent role." },
				model: { type: "string", description: "AI model." },
				status: { type: "string", enum: ["active", "archived"], description: "Memory status (UPDATE only)." },
				completed_at: { type: "string", description: "Completion timestamp." },

				// ACKNOWLEDGE discriminator
				acknowledge: {
					type: "string",
					enum: ["used", "irrelevant", "contradictory"],
					description: "Acknowledge status — pass with id/code to ACKNOWLEDGE."
				},
				application_context: { type: "string", description: "Context for acknowledge." },

				// Decision fields — flat alternative to old decision-log tool
				context: {
					type: "string",
					minLength: 10,
					description: 'Context for type="decision". When present with type="decision", auto-formats content.'
				},
				rationale: {
					type: "string",
					minLength: 10,
					description: 'Rationale for type="decision". When present with type="decision", auto-formats content.'
				},
				alternatives: {
					type: "array",
					items: { type: "string" },
					description: 'Alternatives considered for type="decision". Displayed as a list in auto-formatted content.'
				},

				// Session fields — flat alternative to old session-summarize tool
				key_decisions: {
					type: "array",
					items: { type: "string" },
					description: 'Key decisions for type="task_archive". Displayed as a list in auto-formatted content.'
				},
				next_steps: {
					type: "array",
					items: { type: "string" },
					description: 'Next steps for type="task_archive". Displayed as a list in auto-formatted content.'
				},

				// BULK
				// BULK array items — supports flat decision fields (context/rationale/alternatives)
				// and session fields (key_decisions/next_steps)
				memories: {
					type: "array",
					items: {
						type: "object",
						properties: {
							type: { type: "string", enum: ["code_fact", "decision", "mistake", "pattern", "task_archive"] },
							title: { type: "string", minLength: 3, maxLength: 255 },
							content: { type: "string", minLength: 10 },
							importance: { type: "number", minimum: 1, maximum: 5 },
							code: { type: "string", maxLength: 20 },
							ttlDays: { type: "number", minimum: 1 },
							supersedes: { type: "string" },
							tags: { type: "array", items: { type: "string" } },
							metadata: { type: "object" },
							is_global: { type: "boolean" },
							scope: {
								type: "object",
								properties: {
									owner: { type: "string" },
									repo: { type: "string" },
									branch: { type: "string" },
									folder: { type: "string" },
									language: { type: "string" }
								}
							},
							id: { type: "string", format: "uuid" },
							agent: { type: "string" },
							role: { type: "string" },
							model: { type: "string" },
							status: { type: "string", enum: ["active", "archived"] },
							completed_at: { type: "string" },
							acknowledge: { type: "string", enum: ["used", "irrelevant", "contradictory"] },
							application_context: { type: "string" },
							context: { type: "string", minLength: 10 },
							rationale: { type: "string", minLength: 10 },
							alternatives: { type: "array", items: { type: "string" } },
							key_decisions: { type: "array", items: { type: "string" } },
							next_steps: { type: "array", items: { type: "string" } }
						}
					},
					description: "Bulk memories array — mixed create/update/acknowledge items."
				}
			},
			description:
				"Single memory or memories[] array. Auto-infers operation: content=create, id+fields=update, id+acknowledge=acknowledge."
		}
	},
	{
		name: "memory-delete",
		title: "Memory Delete",
		description: "Soft-delete memories. Single or bulk.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username. Auto-inferred." },
				repo: { type: "string", description: "Repo name. Auto-inferred." },
				id: { type: "string", description: "Single memory UUID or code to delete." },
				ids: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					description: "Array of memory UUIDs or codes to delete (bulk)."
				},
				code: { type: "string", maxLength: 20, description: "Single memory code to delete." },
				codes: {
					type: "array",
					items: { type: "string", maxLength: 20 },
					minItems: 1,
					description: "Array of memory codes to delete (bulk)."
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			description: "Provide id/ids or code/codes to soft-delete memories. At least one identifier field is required."
		}
	},
	{
		name: "memory-read",
		title: "Memory Read",
		description:
			"Unified memory read: searches, gets detail, or returns stats. Auto-infers mode from params — query→search, id/code/ids/codes→detail, none→recap.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search keyword for memory titles" },
				id: { type: "string", format: "uuid", description: "Memory UUID (detail mode)" },
				code: { type: "string", maxLength: 20, description: "Short memory code (detail mode)" },
				ids: {
					type: "array",
					items: { type: "string", format: "uuid" },
					description: "Array of memory UUIDs (bulk detail)"
				},
				codes: {
					type: "array",
					items: { type: "string", maxLength: 20 },
					description: "Array of memory codes (bulk detail)"
				},
				owner: { type: "string", description: "GitHub org or username. Auto-inferred." },
				repo: { type: "string", description: "Repo name. Auto-inferred." },
				current_tags: { type: "array", items: { type: "string" }, description: "Tech stack tags for filtering" },
				current_file_path: { type: "string", description: "File path for workspace grounding" },
				scope: {
					type: "object",
					properties: {
						owner: { type: "string", description: "GitHub org or username" },
						repo: { type: "string", description: "Repo name" },
						branch: { type: "string", description: "Git branch filter" },
						folder: { type: "string", description: "Subdirectory filter" },
						language: { type: "string", description: "Programming language filter" }
					},
					description: "Scope filter for search"
				},
				include_archived: { type: "boolean", default: false, description: "Include archived memories" },
				limit: { type: "number", minimum: 1, maximum: 100, default: 5, description: "Max results (1-100)" },
				offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			description:
				"Zero oneOf — auto-infers mode from field presence: query→search, id/code/ids/codes→detail, none→recap."
		}
	}
];
