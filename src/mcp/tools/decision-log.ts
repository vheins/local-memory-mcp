import { DecisionLogSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { handleMemoryStore } from "./memory.store";

export async function handleDecisionLog(
	args: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = DecisionLogSchema.parse(args);

	const owner = validated.owner ?? "";
	const repo = validated.repo ?? "";

	if (!owner || !repo) {
		return createMcpResponse(
			{
				success: false,
				error: "MISSING_SCOPE",
				message:
					"Both owner and repo are required. They can be provided explicitly or auto-detected from the session context."
			},
			"Failed to log decision: owner and repo could not be determined."
		);
	}

	const alternativesStr =
		validated.alternatives && validated.alternatives.length > 0 ? validated.alternatives.join(", ") : "None";

	const formattedContent = [
		`Decision: ${validated.summary}`,
		`Context: ${validated.context}`,
		`Rationale: ${validated.rationale}`,
		`Alternatives considered: ${alternativesStr}`
	].join("\n");

	const tags = ["decision", ...(validated.tags ?? [])];

	const memoryStoreParams: Record<string, unknown> = {
		type: "decision",
		title: validated.summary,
		content: formattedContent,
		importance: 4,
		agent: "agent",
		role: "unknown",
		model: "unknown",
		scope: {
			owner,
			repo
		},
		tags,
		structured: validated.structured
	};

	return handleMemoryStore(memoryStoreParams, db, vectors);
}
