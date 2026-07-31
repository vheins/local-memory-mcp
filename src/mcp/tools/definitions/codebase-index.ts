// Tool definitions for the codebase index domain.
// Only 2 canonical tools: codebase-index (write) and codebase-read (read)
// All old tool names (index_repository, index_status, get_architecture, etc.)
// are registered as backward-compat aliases in the router/executor only.
//
// The `inputSchema` (JSON Schema) is DERIVED from the Zod schemas in
// `../schemas` via `inputSchemaFromSchema` (see `../schemas/json-schema.ts`
// for the generation + normalization rules). The Zod schemas are the single
// source of truth for tool input contracts — edit the Zod schema, never the
// derived `inputSchema` here.
//
// `required: ["repo"]` is declared explicitly (instead of being derived away)
// because these tools are repo-absolute: the contract intentionally requires
// `repo` even though it is session-injectable.

import { inputSchemaFromSchema } from "../schemas/json-schema";
import { CodebaseIndexSchema } from "../schemas/codebase-index";
import { CodebaseReadSchema } from "../schemas/codebase-read";

export const CODEBASE_INDEX_TOOL_DEFINITIONS = [
	{
		name: "codebase-index",
		title: "Codebase Index",
		description:
			"Unified tool for codebase index management. " +
			"Auto-infers mode from params: " +
			"`repoPath` + `repo` → index (tree-sitter scan, replaces index_repository); " +
			"`repo` saja (tanpa repoPath) → status (freshness + count, replaces index_status).",
		annotations: {
			readOnlyHint: false,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(CodebaseIndexSchema, { required: ["repo"] })
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
		inputSchema: inputSchemaFromSchema(CodebaseReadSchema, { required: ["repo"] })
	}
];
