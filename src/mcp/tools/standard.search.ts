import { StandardSearchSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { CodingStandardEntry } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";

export async function handleStandardSearch(
	params: Record<string, unknown>,
	db: SQLiteStore
): Promise<McpResponse> {
	// Validate input
	const validated = StandardSearchSchema.parse(params);

	// Build search options
	const searchOptions: Record<string, unknown> = {
		limit: validated.limit || 20,
		offset: validated.offset || 0
	};

	if (validated.query) {
		searchOptions.query = validated.query;
	}

	if (validated.stack && validated.stack.length > 0) {
		searchOptions.stack = validated.stack[0]; // Search by first stack item
	}

	if (validated.language) {
		searchOptions.language = validated.language;
	}

	if (validated.version) {
		searchOptions.context = validated.version; // Use context field for version matching
	}

	if (validated.repo !== undefined) {
		searchOptions.repo = validated.repo;
	}

	if (validated.is_global !== undefined) {
		searchOptions.is_global = validated.is_global;
	}

	// Perform search
	const results: CodingStandardEntry[] = db.standards.search(searchOptions as Parameters<typeof db.standards.search>[0]);

	logger.info("[Tool] standard.search - searched coding standards", {
		resultCount: results.length,
		stack: validated.stack,
		language: validated.language,
		version: validated.version
	});

	// Return empty array for no results (not an error)
	return createMcpResponse(
		{
			success: true,
			standards: results,
			count: results.length,
			message: results.length === 0 ? "No matching coding standards found." : `Found ${results.length} matching standards.`
		},
		`Found ${results.length} coding standards matching your query`,
		{
			structuredContentPathHint: "standards",
			includeSerializedStructuredContent: true
		}
	);
}
