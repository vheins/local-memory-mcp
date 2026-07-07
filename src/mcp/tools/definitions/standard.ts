// Tool definitions for coding standard domain

export const STANDARD_TOOL_DEFINITIONS = [
	{
		name: "standard-detail",
		title: "Standard Detail",
		description:
			"Fetch full details of a specific coding standard by ID or short code. Use after standard-search when a result is relevant and full guidance is needed.",
		inputSchema: {
			type: "object",
			oneOf: [
				{
					title: "By ID",
					required: ["id"],
					properties: {
						id: { type: "string", format: "uuid", description: "Coding standard ID." },
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON details." }
					}
				},
				{
					title: "By code",
					required: ["code", "owner", "repo"],
					properties: {
						code: { type: "string", description: "Short standard code (e.g. 'A3KPQ2')." },
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON details." }
					}
				}
			]
		}
	},
	{
		name: "standard-delete",
		title: "Standard Delete",
		description: "Delete one or more coding standards. Supports single 'id' or bulk 'ids'.",
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
					title: "By single ID",
					required: ["owner", "repo", "id"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						id: { type: "string", format: "uuid", description: "Coding standard ID to delete." },
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By bulk IDs",
					required: ["owner", "repo", "ids"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						ids: {
							type: "array",
							items: { type: "string", format: "uuid" },
							minItems: 1,
							description: "Array of coding standard IDs to delete"
						},
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By single code",
					required: ["owner", "repo", "code"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						code: { type: "string", maxLength: 20, description: "Short standard code." },
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By bulk codes",
					required: ["owner", "repo", "codes"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						codes: {
							type: "array",
							items: { type: "string", maxLength: 20 },
							minItems: 1,
							description: "Array of standard codes to delete"
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
				code: { type: "string" },
				ids: { type: "array", items: { type: "string" } },
				codes: { type: "array", items: { type: "string" } },
				repo: { type: "string" },
				deletedCount: { type: "number" }
			},
			required: ["success"]
		}
	},
	{
		name: "standard-store",
		title: "Standard Store",
		description:
			"Store one atomic coding standard. Use for durable implementation rules with explicit context, stack/language filters, and repo/global scope.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
				name: { type: "string", minLength: 3, maxLength: 255, description: "Human-readable standard name" },
				content: {
					type: "string",
					minLength: 10,
					description: "One atomic, actionable standard written as concise Markdown"
				},
				parent_id: {
					type: "string",
					description: "Optional parent standard ID (UUID) or standard code. Resolved to UUID before storing."
				},
				context: { type: "string", description: "Context or category (e.g., 'error-handling', 'security')" },
				version: { type: "string", description: "Version of the standard (e.g., '1.0.0')" },
				language: { type: "string", description: "Programming language (e.g., 'typescript', 'python')" },
				stack: {
					type: "array",
					items: { type: "string" },
					description: "Technology stack (e.g., ['react', 'nextjs'])"
				},
				repo: {
					type: "string",
					description:
						"Repository/project name (e.g., 'local-memory-mcp'). Required for repo-specific standards. Omit only for global standards."
				},
				is_global: { type: "boolean", description: "Whether standard applies globally or repo-specific" },
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Tags for categorization"
				},
				metadata: {
					type: "object",
					description: "Additional metadata"
				},
				agent: { type: "string", description: "Agent creating the standard" },
				model: { type: "string", description: "AI model used" },
				standards: {
					type: "array",
					items: {
						type: "object",
						properties: {
							name: { type: "string" },
							content: { type: "string" },
							parent_id: { type: "string" },
							context: { type: "string" },
							version: { type: "string" },
							language: { type: "string" },
							stack: { type: "array", items: { type: "string" } },
							is_global: { type: "boolean" },
							tags: { type: "array", items: { type: "string" } },
							metadata: { type: "object" },
							agent: { type: "string" },
							model: { type: "string" }
						},
						required: ["name", "content", "tags", "metadata"]
					},
					description: "Array of standards for bulk creation"
				},
				structured: { type: "boolean", default: false }
			},
			required: ["owner"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				standard: {
					type: "object",
					properties: {
						id: { type: "string" },
						title: { type: "string" },
						content: { type: "string" },
						parent_id: { type: "string", nullable: true },
						context: { type: "string" },
						version: { type: "string" },
						language: { type: "string", nullable: true },
						stack: { type: "array", items: { type: "string" } },
						is_global: { type: "boolean" },
						repo: { type: "string", nullable: true },
						tags: { type: "array", items: { type: "string" } },
						metadata: { type: "object" },
						created_at: { type: "string" },
						updated_at: { type: "string" },
						agent: { type: "string" },
						model: { type: "string" }
					},
					required: [
						"id",
						"title",
						"content",
						"parent_id",
						"context",
						"version",
						"stack",
						"is_global",
						"tags",
						"metadata",
						"created_at",
						"updated_at",
						"agent",
						"model"
					]
				},
				message: { type: "string" }
			},
			required: ["success", "standard", "message"]
		}
	},
	{
		name: "standard-update",
		title: "Standard Update",
		description:
			"Update an existing coding standard. Use this when the rule changes, expands scope, or metadata/tags need correction.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			oneOf: [
				{
					title: "By ID",
					required: ["owner", "repo", "id"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						id: { type: "string", format: "uuid", description: "Standard ID to update." },
						code: { type: "string", maxLength: 20, description: "Short standard code." },
						name: { type: "string", minLength: 3, maxLength: 255 },
						content: { type: "string", minLength: 10 },
						parent_id: { type: "string", nullable: true },
						context: { type: "string" },
						version: { type: "string" },
						language: { type: "string" },
						stack: { type: "array", items: { type: "string" } },
						is_global: { type: "boolean" },
						tags: { type: "array", items: { type: "string" } },
						metadata: { type: "object" },
						agent: { type: "string" },
						model: { type: "string" },
						structured: { type: "boolean", default: false }
					}
				},
				{
					title: "By code",
					required: ["owner", "repo", "code"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						code: { type: "string", maxLength: 20, description: "Short standard code." },
						id: { type: "string", format: "uuid", description: "Standard ID." },
						name: { type: "string", minLength: 3, maxLength: 255 },
						content: { type: "string", minLength: 10 },
						parent_id: { type: "string", nullable: true },
						context: { type: "string" },
						version: { type: "string" },
						language: { type: "string" },
						stack: { type: "array", items: { type: "string" } },
						is_global: { type: "boolean" },
						tags: { type: "array", items: { type: "string" } },
						metadata: { type: "object" },
						agent: { type: "string" },
						model: { type: "string" },
						structured: { type: "boolean", default: false }
					}
				}
			]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				updatedFields: { type: "array", items: { type: "string" } }
			},
			required: ["success", "id", "updatedFields"]
		}
	},
	{
		name: "standard-search",
		title: "Standard Search",
		description:
			"MANDATORY PRE-IMPLEMENTATION CHECK: Call before any code edit, test edit, refactor, migration, or implementation decision to find applicable coding standards. Returns a compact pointer table; use `standard-detail` for relevant results. If no relevant standards are returned, continue and state that no applicable standards were found.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
				query: { type: "string", description: "Search query (optional, searches title/content)" },
				stack: {
					type: "array",
					items: { type: "string" },
					description: "Technology stack to filter by (e.g., ['react', 'nextjs'])"
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Tag filter"
				},
				language: { type: "string", description: "Programming language filter" },
				context: { type: "string", description: "Context/category filter" },
				version: { type: "string", description: "Version filter" },
				repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp'). Optional filter." },
				is_global: { type: "boolean", description: "Filter by global/repo-specific" },
				limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
				offset: { type: "number", minimum: 0, default: 0 },
				structured: { type: "boolean", default: false }
			},
			required: []
		},
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "string", enum: ["standard-search"] },
				query: { type: "string" },
				count: { type: "number", description: "Number of rows returned" },
				total: { type: "number", description: "Total number of matches before pagination" },
				offset: { type: "number" },
				limit: { type: "number" },
				results: {
					type: "object",
					properties: {
						columns: {
							type: "array",
							items: { type: "string" }
						},
						rows: {
							type: "array",
							items: { type: "array" },
							description: "Each row includes standard id and pointer metadata. Fetch full content via standard-detail."
						}
					},
					required: ["columns", "rows"]
				}
			},
			required: ["schema", "query", "count", "total", "offset", "limit", "results"]
		}
	}
];
