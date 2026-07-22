import { z } from "zod";

export const AgentContextSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1),
	objective: z.string().optional(),
	type_filter: z.enum(["code_fact", "decision", "mistake", "pattern", "task_archive"]).optional(),
	limit: z.coerce.number().min(1).max(100).default(5),
	json: z.boolean().default(false)
});

export const DecisionLogSchema = z.object({
	summary: z
		.string()
		.min(3, { message: "Summary must be at least 3 characters (this becomes the memory title)" })
		.max(255, { message: "Summary must be at most 255 characters (this becomes the memory title)" }),
	context: z.string().min(10, { message: "Context must be at least 10 characters describing the situation" }),
	rationale: z
		.string()
		.min(10, { message: "Rationale must be at least 10 characters explaining why the decision was made" }),
	alternatives: z
		.array(z.string(), { message: "Alternatives must be an array of strings, e.g. ['option A', 'option B']" })
		.optional(),
	tags: z.array(z.string()).optional(),
	owner: z.string().optional(),
	repo: z.string().optional(),
	json: z.boolean().default(false)
});

export const SessionSummarizeSchema = z.object({
	summary: z.string().min(10, { message: "Summary must be at least 10 characters" }),
	key_decisions: z.array(z.string()).optional(),
	next_steps: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	owner: z.string().optional(),
	repo: z.string().optional(),
	json: z.boolean().default(false)
});
