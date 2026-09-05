import { SQLiteStore } from "../storage/sqlite";
import type { ExplorationObservationInput } from "../types";
import { createMcpResponse, type McpResponse, withEnvelope } from "../utils/mcp-response";
import { ExplorationObservationWriteSchema } from "./schemas";

export async function handleExplorationObservationWrite(
	args: Record<string, unknown>,
	storage: SQLiteStore
): Promise<McpResponse> {
	const validated = ExplorationObservationWriteSchema.parse(args);
	const inputs: ExplorationObservationInput[] = validated.observations ?? [
		{
			subject: validated.subject!,
			fact: validated.fact!,
			confidence: validated.confidence!,
			evidence: validated.evidence!,
			task_id: validated.task_id,
			agent: validated.agent
		}
	];
	const results = storage.explorationObservations.upsertMany(validated.owner, validated.repo, inputs, validated.id);
	const created = results.filter((result) => result.created).length;
	const deduplicated = results.length - created;
	const data = withEnvelope("observation-write", validated.observations ? "bulk" : validated.id ? "update" : "create", {
		success: true,
		created,
		deduplicated,
		results: results.map(({ observation, created: wasCreated }) => ({
			id: observation.id,
			subject: observation.subject,
			confidence: observation.confidence,
			evidence_count: observation.evidence_count,
			created: wasCreated
		}))
	});
	const summary = `Published ${results.length} observation${results.length === 1 ? "" : "s"}: ${created} created, ${deduplicated} deduplicated.`;
	return createMcpResponse(data, summary, { contentSummary: summary, includeJson: validated.json });
}
