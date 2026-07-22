import { SessionSummarizeSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { handleMemoryStore } from "./memory.store";

export async function handleSessionSummarize(
	args: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = SessionSummarizeSchema.parse(args);

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
			"Failed to log session summary: owner and repo could not be determined."
		);
	}

	const decisionsStr =
		validated.key_decisions && validated.key_decisions.length > 0
			? validated.key_decisions.map((d: string) => `- ${d}`).join("\n")
			: "None";

	const nextStepsStr =
		validated.next_steps && validated.next_steps.length > 0
			? validated.next_steps.map((s: string) => `- ${s}`).join("\n")
			: "None";

	const formattedContent = [
		`Session Summary: ${validated.summary}`,
		``,
		`Key Decisions:`,
		decisionsStr,
		``,
		`Next Steps:`,
		nextStepsStr
	].join("\n");

	const tags = ["session-summary", ...(validated.tags ?? [])];

	const memoryStoreParams: Record<string, unknown> = {
		type: "task_archive",
		title: validated.summary.length > 100 ? validated.summary.slice(0, 97) + "..." : validated.summary,
		content: formattedContent,
		importance: 3,
		agent: "agent",
		role: "unknown",
		model: "unknown",
		scope: {
			owner,
			repo
		},
		tags,
		json: validated.json
	};

	return handleMemoryStore(memoryStoreParams, db, vectors);
}
