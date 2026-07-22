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
			"Returns the current indexing status for a repository: whether it has been indexed, when it was last indexed, file/symbol counts, and any ongoing indexing progress.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: { type: "string", description: "Repository identifier (owner/repo)" }
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
	}
];
