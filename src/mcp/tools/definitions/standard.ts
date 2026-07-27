// Tool definitions for coding standard domain

export const STANDARD_TOOL_DEFINITIONS = [
	{
		name: "standard-read",
		title: "Standard Read",
		description:
			"Unified handler for SEARCH, DETAIL, and LIST of coding standards. Auto-infers mode: 'query' → SEARCH (hybrid scoring per SPEC-001); 'id'/'code'/'ids'/'codes' → DETAIL (single or bulk); none → LIST (paginated).",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				// SEARCH
				query: { type: "string", description: "Search query (triggers SEARCH mode)." },
				// DETAIL
				id: { type: "string", format: "uuid", description: "Standard ID (triggers DETAIL mode)." },
				code: { type: "string", maxLength: 20, description: "Short standard code (triggers DETAIL mode)." },
				ids: {
					type: "array",
					items: { type: "string", format: "uuid" },
					minItems: 1,
					description: "Bulk standard IDs for DETAIL lookup."
				},
				codes: {
					type: "array",
					items: { type: "string", maxLength: 20 },
					minItems: 1,
					description: "Bulk standard codes for DETAIL lookup."
				},
				// Filters (SEARCH + LIST)
				owner: { type: "string", description: "GitHub org or username. Auto-inferred." },
				repo: { type: "string", description: "Repo name. Auto-inferred." },
				stack: { type: "array", items: { type: "string" }, description: "Tech stack filters." },
				tags: { type: "array", items: { type: "string" }, description: "Tag filter." },
				language: { type: "string", description: "Language filter." },
				context: { type: "string", description: "Context filter." },
				version: { type: "string", description: "Version filter." },
				is_global: { type: "boolean", description: "Global flag filter." },
				// Pagination
				limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
				offset: { type: "number", minimum: 0, default: 0 },
				json: { type: "boolean", default: false }
			}
		}
	},
	{
		name: "standard-write",
		title: "Standard Write",
		description:
			"Unified handler for single CREATE, UPDATE, or BULK CREATE of coding standards. Auto-infers operation: 'content' (no id/code) → CREATE; 'id'/'code' → UPDATE; 'standards[]' → BULK CREATE.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name. Auto-inferred." },
				json: { type: "boolean", default: false },

				// Create fields
				name: { type: "string", minLength: 3, maxLength: 255, description: "Standard name" },
				content: { type: "string", minLength: 10, description: "Atomic standard content in Markdown" },
				parent_id: { type: "string", description: "Parent standard ID or code." },
				context: { type: "string", description: "Context or category." },
				version: { type: "string", description: "Standard version." },
				language: { type: "string", description: "Programming language." },
				stack: { type: "array", items: { type: "string" }, description: "Tech stack filters." },
				is_global: { type: "boolean", description: "Global or repo-specific flag." },
				tags: { type: "array", items: { type: "string" }, description: "Categorization tags." },
				metadata: { type: "object", description: "Additional metadata." },
				agent: { type: "string", description: "Agent creating/updating standard." },
				model: { type: "string", description: "AI model used." },

				// Update fields
				id: { type: "string", format: "uuid", description: "Standard ID (for update)." },
				code: { type: "string", maxLength: 20, description: "Short standard code (for update)." },

				// Bulk
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
					description: "Bulk standards array."
				}
			}
		}
	},
	{
		name: "standard-delete",
		title: "Standard Delete",
		description: "Deletes coding standards. Single or bulk. Auto-infers: UUID→direct ID, non-UUID→code lookup.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Single standard UUID or code to delete (auto-inferred: UUID→direct, string→code lookup)."
				},
				code: { type: "string", maxLength: 20, description: "Single standard code to delete." },
				ids: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					description: "Array of standard UUIDs or codes to delete (bulk, auto-inferred per item)."
				},
				codes: {
					type: "array",
					items: { type: "string", maxLength: 20 },
					minItems: 1,
					description: "Array of standard codes to delete (bulk)."
				},
				owner: { type: "string", description: "GitHub org or username. Auto-inferred." },
				repo: { type: "string", description: "Repo name. Auto-inferred." },
				json: { type: "boolean", default: false, description: "Return JSON result." }
			}
		}
	}
];
