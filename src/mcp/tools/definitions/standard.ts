// Tool definitions for coding standard domain

export const STANDARD_TOOL_DEFINITIONS = [
	{
		name: "standard-detail",
		title: "Standard Detail",
		description:
			"Fetches details of a coding standard by ID or code.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", format: "uuid", description: "Standard ID." },
				code: { type: "string", description: "Short standard code." },
				owner: { type: "string", description: "GitHub org or username. Auto-inferred." },
				repo: { type: "string", description: "Repo name. Auto-inferred." },
				json: { type: "boolean", default: false, description: "Return JSON details." }
			},
			description: "Provide id or code to fetch a standard.",
			oneOf: [
				{
					title: "By ID",
					required: ["id"]
				},
				{
					title: "By code",
					required: ["code"]
				}
			]
		}
	},
	{
		name: "standard-delete",
		title: "Standard Delete",
		description: "Deletes coding standards by ID or code.",
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
				id: { type: "string", format: "uuid", description: "Standard ID to delete." },
				ids: {
					type: "array",
					items: { type: "string", format: "uuid" },
					minItems: 1,
					description: "Bulk standard IDs to delete."
				},
				code: { type: "string", maxLength: 20, description: "Standard code to delete." },
				codes: {
					type: "array",
					items: { type: "string", maxLength: 20 },
					minItems: 1,
					description: "Bulk standard codes to delete."
				},
				json: { type: "boolean", default: false, description: "Return JSON result." }
			},
			description: "Provide id/ids or code/codes to delete.",
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
			]
		}
	},
	{
		name: "standard-store",
		title: "Standard Store",
		description:
			"Stores a coding standard.",
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
				name: { type: "string", minLength: 3, maxLength: 255, description: "Standard name" },
				content: {
					type: "string",
					minLength: 10,
					description: "Atomic standard content in Markdown"
				},
				parent_id: {
					type: "string",
					description: "Parent standard ID or code."
				},
				context: { type: "string", description: "Context or category." },
				version: { type: "string", description: "Standard version." },
				language: { type: "string", description: "Programming language." },
				stack: {
					type: "array",
					items: { type: "string" },
					description: "Tech stack filters."
				},
				repo: {
					type: "string",
					description:
						"Repo name for repo-specific standards."
				},
				is_global: { type: "boolean", description: "Global or repo-specific flag." },
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Categorization tags."
				},
				metadata: {
					type: "object",
					description: "Additional metadata."
				},
				agent: { type: "string", description: "Agent creating standard." },
				model: { type: "string", description: "AI model used." },
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
				},
				json: { type: "boolean", default: false }
			},
			oneOf: [
				{
					title: "Single standard",
					required: ["owner", "name", "content"]
				},
				{
					title: "Bulk standards",
					required: ["standards"]
				}
			]
		}
	},
	{
		name: "standard-update",
		title: "Standard Update",
		description:
			"Updates an existing coding standard.",
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
				id: { type: "string", format: "uuid", description: "Standard ID." },
				code: { type: "string", maxLength: 20, description: "Short code." },
				name: { type: "string", minLength: 3, maxLength: 255 },
				content: { type: "string", minLength: 10 },
				parent_id: { type: "string" },
				context: { type: "string" },
				version: { type: "string" },
				language: { type: "string" },
				stack: { type: "array", items: { type: "string" } },
				is_global: { type: "boolean" },
				tags: { type: "array", items: { type: "string" } },
				metadata: { type: "object" },
				agent: { type: "string" },
				model: { type: "string" },
				json: { type: "boolean", default: false }
			},
			description: "Provide id or code to update standard.",
			oneOf: [
				{
					title: "By ID",
					required: ["id"]
				},
				{
					title: "By code",
					required: ["code"]
				}
			]
		}
	},
	{
		name: "standard-search",
		title: "Standard Search",
		description:
			"Finds applicable standards before code edit.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				query: { type: "string", description: "Search query." },
				stack: {
					type: "array",
					items: { type: "string" },
					description: "Tech stack filters."
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Tag filter."
				},
				language: { type: "string", description: "Language filter." },
				context: { type: "string", description: "Context filter." },
				version: { type: "string", description: "Version filter." },
				repo: { type: "string", description: "Repo name filter." },
				is_global: { type: "boolean", description: "Global flag filter." },
				limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
				offset: { type: "number", minimum: 0, default: 0 },
				json: { type: "boolean", default: false }
			},
			required: []
		}
	}
];
