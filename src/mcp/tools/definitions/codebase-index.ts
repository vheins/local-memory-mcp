// Tool definitions for the codebase index domain

export const CODEBASE_INDEX_TOOL_DEFINITIONS = [
	{
		name: "index_repository",
		title: "Index Repository",
		description:
			"Scans repo, extracts symbols via tree-sitter.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Repo owner." },
				repo: { type: "string", description: "Repo name." },
				repoPath: { type: "string", description: "Absolute path to repo." },
				force: { type: "boolean", description: "Force full re-index." },
				includeGlobs: { type: "array", items: { type: "string" }, description: "Include glob patterns." },
				excludeGlobs: { type: "array", items: { type: "string" }, description: "Exclude glob patterns." }
			},
			required: ["repo", "repoPath"]
		}
	},
	{
		name: "index_status",
		title: "Index Status",
		description:
			"Returns indexing status for a repository.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Repo owner." },
				repo: { type: "string", description: "Repo name." },
				repoPath: {
					type: "string",
					description: "Absolute path for staleness detection."
				}
			},
			required: ["repo"]
		}
	},
	{
		name: "get_architecture",
		title: "Get Architecture",
		description:
			"Returns codebase structure overview.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Repo owner." },
				repo: { type: "string", description: "Repo name." },
				depth: { type: "number", description: "Tree depth limit (1-5).", default: 2 },
				includeSymbolCounts: {
					type: "boolean",
					description: "Include symbol counts.",
					default: true
				}
			},
			required: ["repo"]
		}
	},
	{
		name: "get_file_symbols",
		title: "Get File Symbols",
		description:
			"Returns indexed symbols in a file.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Repo owner." },
				repo: { type: "string", description: "Repo name." },
				filePath: { type: "string", description: "Relative file path." }
			},
			required: ["repo", "filePath"]
		}
	},
	{
		name: "search_symbols",
		title: "Search Symbols",
		description:
			"Searches indexed symbols with ranking.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Symbol name or partial name." },
				owner: { type: "string", description: "Repo owner." },
				repo: { type: "string", description: "Repo name to scope." },
				kind: {
					type: "string",
					description: "Filter by symbol kind."
				},
				filePath: { type: "string", description: "Filter by file path." },
				exportedOnly: { type: "boolean", description: "Only exported symbols." },
				limit: { type: "number", default: 50, description: "Max results (200)." },
				offset: { type: "number", default: 0, description: "Pagination offset." }
			},
			required: []
		}
	},
	{
		name: "codebase_search",
		title: "Codebase Search",
		description:
			"Searches codebase via NL queries.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "NL search query (min 2 chars)." },
				owner: { type: "string", description: "Repo owner." },
				repo: { type: "string", description: "Repo name to scope." },
				kind: {
					type: "string",
					description: "Filter by symbol kind."
				},
				filePath: { type: "string", description: "Filter by file path." },
				limit: { type: "number", default: 20, description: "Max results (100)." },
				offset: { type: "number", default: 0, description: "Pagination offset." }
			},
			required: ["query"]
		}
	},
	{
		name: "trace_symbol",
		title: "Trace Symbol",
		description:
			"Traces symbol definition and usage.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Symbol name to trace." },
				symbol: { type: "string", description: "Alias for name param." },
				owner: { type: "string", description: "Repo owner." },
				repo: { type: "string", description: "Repo name to scope." },
				includeReferences: {
					type: "boolean",
					description: "Include usage references.",
					default: true
				}
			},
			required: []
		}
	}
];
