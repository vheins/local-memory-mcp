// Tool definitions for the codebase index domain
// Only 2 canonical tools: codebase-index (write) and codebase-read (read)
// All old tool names (index_repository, index_status, get_architecture, etc.)
// are registered as backward-compat aliases in the router/executor only.

export const CODEBASE_INDEX_TOOL_DEFINITIONS = [
	{
		name: "codebase-index",
		title: "Codebase Index",
		description:
			"Scans repo, extracts symbols via tree-sitter. Canonical write tool for codebase index (replaces index_repository).",
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
		name: "codebase-read",
		title: "Codebase Read",
		description:
			"Unified read-only access to the codebase index. " +
			"Auto-infers mode from params: " +
			"`action:status` or no params → index status (was index_status); " +
			"`action:trace` or `name` w/o `query` → trace symbol (was trace_symbol); " +
			"`action:file` or `filePath` → file symbols (was get_file_symbols); " +
			"`action:architecture` or `depth` → architecture tree (was get_architecture); " +
			"`query` with spaces → NL search (was codebase_search); " +
			"`query` single term → symbol search (was search_symbols).",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["status", "trace", "file", "architecture", "search_symbols", "nl_search"],
					description: "Explicit mode override. Auto-inferred if omitted."
				},
				owner: { type: "string", description: "Repo owner." },
				repo: { type: "string", description: "Repo name." },
				// TRACE
				name: { type: "string", description: "Symbol name to trace." },
				symbol: { type: "string", description: "Alias for name param." },
				includeReferences: { type: "boolean", description: "Include usage references.", default: true },
				// FILE
				filePath: { type: "string", description: "Relative file path for file symbols." },
				// ARCHITECTURE
				depth: { type: "number", description: "Tree depth limit (1-5)." },
				includeSymbolCounts: { type: "boolean", description: "Include symbol counts.", default: true },
				// SEARCH
				query: { type: "string", description: "Search query — single term or NL phrase." },
				kind: { type: "string", description: "Filter by symbol kind." },
				exportedOnly: { type: "boolean", description: "Only exported symbols." },
				// Pagination
				limit: { type: "number", default: 50, description: "Max results (200)." },
				offset: { type: "number", default: 0, description: "Pagination offset." },
				// STATUS
				repoPath: { type: "string", description: "Absolute path for staleness detection." }
			},
			required: ["repo"]
		}
	}
];
