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
	}
];
