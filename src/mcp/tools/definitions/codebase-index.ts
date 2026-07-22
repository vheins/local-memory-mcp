// Tool definitions for the codebase index domain

export const CODEBASE_INDEX_TOOL_DEFINITIONS = [
	{
		name: "index_repository",
		title: "Index Repository",
		description:
			"Scans a repository directory, parses source files (TypeScript/JavaScript) using tree-sitter, and stores extracted symbols (functions, classes, interfaces, types, enums) in a SQLite knowledge graph. Supports incremental indexing via checksum comparison.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository identifier (owner/repo)" },
				repoPath: { type: "string", description: "Absolute filesystem path to the repository" },
				force: { type: "boolean", description: "Force full re-index ignoring checksums" },
				includeGlobs: { type: "array", items: { type: "string" }, description: "Include glob patterns" },
				excludeGlobs: { type: "array", items: { type: "string" }, description: "Exclude glob patterns" }
			},
			required: ["repo", "repoPath"]
		}
	},
	{
		name: "index_status",
		title: "Index Status",
		description:
			"Returns the current indexing status for a repository: whether it has been indexed, when it was last indexed, file/symbol counts, any ongoing indexing progress, and optionally staleness detection. Pass repoPath to enable staleness checks (>= 5% stale files triggers stale flag).",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository identifier (owner/repo)" },
				repoPath: {
					type: "string",
					description: "Absolute filesystem path to the repository (optional — enables staleness detection)"
				}
			},
			required: ["repo"]
		}
	},
	{
		name: "get_architecture",
		title: "Get Architecture",
		description:
			"Returns a high-level overview of the indexed codebase structure: directory tree, language breakdown, file counts, and top-level exports.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository identifier (owner/repo)" },
				depth: { type: "number", description: "Directory tree depth limit (1-5, default 2)", default: 2 },
				includeSymbolCounts: {
					type: "boolean",
					description: "Include per-file symbol kind counts (default true)",
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
			"Returns all indexed symbols declared in a specific file. Symbols are returned in declaration order with their locations, signatures, and doc comments.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository identifier (owner/repo)" },
				filePath: { type: "string", description: "Relative file path from repo root" }
			},
			required: ["repo", "filePath"]
		}
	},
	{
		name: "search_symbols",
		title: "Search Symbols",
		description:
			"Searches indexed codebase symbols by name with ranked results. Supports filtering by kind, file path, and export status. Uses a 5-tier ranking algorithm: exact > camelCase > prefix > substring > FTS5.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Symbol name or partial name to search" },
				repo: { type: "string", description: "Repository identifier (owner/repo) to scope search" },
				kind: {
					type: "string",
					description: "Filter by symbol kind: function, class, interface, type, enum, variable"
				},
				filePath: { type: "string", description: "Filter results to a specific file path" },
				exportedOnly: { type: "boolean", description: "Only return exported symbols" },
				limit: { type: "number", default: 50, description: "Maximum results (max 200)" },
				offset: { type: "number", default: 0, description: "Results offset for pagination" }
			},
			required: []
		}
	},
	{
		name: "trace_symbol",
		title: "Trace Symbol",
		description:
			"Traces a symbol's definition and usage across the codebase. Returns the definition location, file references, and export status.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Symbol name to trace (exact match)" },
				repo: { type: "string", description: "Repository identifier (owner/repo) for scoped search" },
				includeReferences: {
					type: "boolean",
					description: "Include usage references from other symbols",
					default: true
				}
			},
			required: ["name"]
		}
	}
];
