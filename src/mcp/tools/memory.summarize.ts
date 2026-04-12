import { MemorySummarizeSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";

export async function handleMemorySummarize(params: Record<string, unknown>, db: SQLiteStore): Promise<McpResponse> {
	// Validate input
	const validated = MemorySummarizeSchema.parse(params);

	// Create summary from signals
	const summary = validated.signals.join("\n- ");
	const fullSummary = `Project summary:\n- ${summary}`;

	// Store summary
	db.summaries.upsertSummary(validated.repo, fullSummary);

	return createMcpResponse(
		{
			success: true,
			repo: validated.repo,
			summary: fullSummary,
			signalCount: validated.signals.length
		},
		`Updated summary for repo "${validated.repo}" with ${validated.signals.length} signals.`,
		{
			structuredContentPathHint: "summary",
			resourceLinks: [
				{
					uri: `repository://${encodeURIComponent(validated.repo)}/summary`,
					name: `Repository Summary (${validated.repo})`,
					description: "Repository summary resource",
					mimeType: "text/plain",
					annotations: {
						audience: ["assistant"],
						priority: 0.9
					}
				}
			]
		}
	);
}
