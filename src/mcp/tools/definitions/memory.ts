// Tool definitions for memory domain

export const MEMORY_TOOL_DEFINITIONS = [
	{
		name: "memory-synthesize",
		title: "Memory Synthesize",
		description:
			"Synthesizes from local memory and tasks.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		execution: {
			taskSupport: "optional"
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username."
				},
				repo: {
					type: "string",
					description: "Repo name. Optional with active root."
				},
				objective: { type: "string", minLength: 5, description: "Question or synthesis objective." },
				current_file_path: {
					type: "string",
					description: "File path for workspace grounding."
				},
				include_summary: { type: "boolean", default: true },
				include_tasks: { type: "boolean", default: true },
				use_tools: {
					type: "boolean",
					default: true,
					description: "Allow tool calls during synthesis."
				},
				max_iterations: { type: "number", minimum: 1, maximum: 5, default: 3 },
				max_tokens: { type: "number", minimum: 128, maximum: 4000, default: 1200 },
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: ["owner", "objective"]
		},
		
	},
	{
		name: "memory-detail",
		title: "Memory Detail",
		description:
			"Fetches full memory by ID or code.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", format: "uuid", description: "Memory UUID." },
				code: { type: "string", description: "Short memory code." },
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			oneOf: [
				{
					title: "By ID",
					required: ["id"]
				},
				{
					title: "By code",
					required: ["code"]
				}
			],
			description: "Provide id (UUID) or code to fetch memory."
		}
	},
	{
		name: "memory-store",
		title: "Memory Store",
		description:
			"Stores durable knowledge.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				type: {
					type: "string",
					enum: ["code_fact", "decision", "mistake", "pattern", "task_archive"],
					description: "Knowledge type."
				},
				title: {
					type: "string",
					minLength: 3,
					maxLength: 255,
					description: "Short title for memory."
				},
				content: { type: "string", minLength: 10, description: "The memory content" },
				importance: { type: "number", minimum: 1, maximum: 5, description: "Importance score (1-5)" },
				agent: { type: "string", description: "Agent name" },
				role: { type: "string", default: "unknown", description: "Agent role" },
				model: { type: "string", description: "AI model" },
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
				code: { type: "string", maxLength: 20, description: "Optional custom code." },
				tags: { type: "array", items: { type: "string" }, description: "Tech stack tags" },
				metadata: { type: "object", description: "Structured metadata" },
				is_global: { type: "boolean", default: false, description: "Global if true." },
				ttlDays: { type: "number", minimum: 1, description: "TTL in days" },
				supersedes: { type: "string", description: "UUID or code to supersede." },
				memories: {
					type: "array",
					items: {
						type: "object",
						properties: {
							type: { type: "string", enum: ["code_fact", "decision", "mistake", "pattern", "task_archive"] },
							title: { type: "string", minLength: 3, maxLength: 255 },
							content: { type: "string", minLength: 10 },
							importance: { type: "number", minimum: 1, maximum: 5 },
							agent: { type: "string" },
							role: { type: "string", default: "unknown" },
							model: { type: "string" },
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
							code: { type: "string" },
							ttlDays: { type: "number", minimum: 1 },
							supersedes: { type: "string" },
							tags: { type: "array", items: { type: "string" } },
							metadata: { type: "object" },
							is_global: { type: "boolean", default: false }
						}
					},
					description: "Bulk memories array"
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			oneOf: [
				{
					title: "Single memory",
					required: ["type", "title", "content", "importance"]
				},
				{
					title: "Bulk memories",
					required: ["memories"]
				}
			],
			description: "Single storage or memories array for bulk."
		},
		
	},
	{
		name: "memory-acknowledge",
		title: "Memory Acknowledge",
		description:
			"Acknowledges memory or reports irrelevance.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				memory_id: { type: "string", format: "uuid", description: "Memory UUID; optional w/ code." },
				code: { type: "string", maxLength: 20, description: "Short code; optional w/ UUID." },
				status: { type: "string", enum: ["used", "irrelevant", "contradictory"] },
				application_context: { type: "string", minLength: 10 },
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: ["status"]
		},
		
	},
	{
		name: "memory-update",
		title: "Memory Update",
		description:
			"Updates memory entry.",
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
				id: { type: "string", format: "uuid", description: "Memory UUID." },
				code: { type: "string", maxLength: 20, description: "Short memory code." },
				type: { type: "string", enum: ["code_fact", "decision", "mistake", "pattern", "task_archive"] },
				title: { type: "string", minLength: 3, maxLength: 100 },
				content: { type: "string", minLength: 10 },
				importance: { type: "number", minimum: 1, maximum: 5 },
				agent: { type: "string" },
				role: { type: "string" },
				status: { type: "string", enum: ["active", "archived"] },
				supersedes: { type: "string" },
				tags: { type: "array", items: { type: "string" } },
				metadata: { type: "object" },
				is_global: { type: "boolean" },
				completed_at: { type: "string" },
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			oneOf: [
				{
					title: "By ID",
					required: ["id"]
				},
				{
					title: "By code",
					required: ["code"]
				}
			],
			description: "Provide id or code to identify memory."
		},
		
	},
	{
		name: "memory-search",
		title: "Memory Search",
		description:
			"Navigation: returns pointer table.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					minLength: 3,
					description: "Search keyword for memory titles"
				},
				prompt: { type: "string", description: "Semantic search prompt" },
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name." },
				current_tags: {
					type: "array",
					items: { type: "string" },
					description: "Tech stack tags for filtering"
				},
				types: {
					type: "array",
					items: {
						type: "string",
						enum: ["code_fact", "decision", "mistake", "pattern", "task_archive"]
					},
					description: "Filter by memory type(s)"
				},
				minImportance: { type: "number", minimum: 1, maximum: 5, description: "Min importance (1-5)" },
				limit: { type: "number", minimum: 1, maximum: 100, default: 5 },
				offset: { type: "number", minimum: 0, default: 0 },
				includeRecap: { type: "boolean", default: false },
				current_file_path: { type: "string", description: "File path for workspace grounding" },
				include_archived: {
					type: "boolean",
					default: false,
					description: "Include archived memories"
				},
				scope: {
					type: "object",
					properties: {
						owner: { type: "string", description: "GitHub org or username" },
						repo: { type: "string", description: "Repo name" },
						branch: { type: "string", description: "Git branch filter" },
						folder: { type: "string", description: "Subdirectory filter" },
						language: { type: "string", description: "Programming language filter" }
					}
				},
				json: {
					type: "boolean",
					default: false,
					description: "Returns JSON if true."
				}
			},
			required: ["owner", "query", "repo"]
		},
		
	},
	{
		name: "memory-summarize",
		title: "Memory Summarize",
		description: "Update the summary for a repository",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name." },
				signals: {
					type: "array",
					items: { type: "string", maxLength: 200 },
					minItems: 1,
					description: "Signals to include in summary"
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: ["owner", "repo", "signals"]
		},
		
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
				id: { type: "string", format: "uuid", description: "Single memory UUID to delete." },
				ids: {
					type: "array",
					items: { type: "string", format: "uuid" },
					minItems: 1,
					description: "Array of memory UUIDs to delete."
				},
				code: { type: "string", maxLength: 20, description: "Single memory code to delete." },
				codes: {
					type: "array",
					items: { type: "string", maxLength: 20 },
					minItems: 1,
					description: "Array of memory codes to delete."
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
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
					required: ["code"]
				},
				{
					title: "By bulk codes",
					required: ["codes"]
				}
			],
			description: "Provide id/ids or code/codes to delete."
		},
		
	},
	{
		name: "memory-recap",
		title: "Memory Recap",
		description:
			"Aggregated stats + top memories.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name." },
				limit: {
					type: "number",
					minimum: 1,
					maximum: 50,
					default: 20,
					description: "Max top memories to return"
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
					description: "Returns JSON if true."
				}
			},
			required: ["owner", "repo"]
		},
		
	}
];
