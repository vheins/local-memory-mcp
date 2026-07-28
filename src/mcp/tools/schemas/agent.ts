import { z } from "zod";

export const AgentContextSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1),
	query: z
		.string()
		.optional()
		.describe("Search query for vector/hybrid search. When absent, returns most recent memories."),
	type_filter: z.enum(["code_fact", "decision", "mistake", "pattern", "task_archive"]).optional(),
	limit: z.coerce.number().min(1).max(100).default(5),
	json: z.boolean().default(false)
});

// DecisionLogSchema and SessionSummarizeSchema removed per ADR-007.
// Use memory-write with flat fields instead:
//   - type:"decision" + context/rationale/alternatives
//   - type:"task_archive" + key_decisions/next_steps
