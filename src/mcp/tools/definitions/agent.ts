// Tool definitions for agent-context domain

export const AGENT_TOOL_DEFINITIONS = [
	{
		name: "agent-context",
		title: "Agent Context Recall",
		description:
			"Returns relevant agent session context with memories, tasks, and decisions.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				objective: {
					type: "string",
					description: "Agent objective for memory search."
				},
				type_filter: {
					type: "string",
					description: "Filter by memory type."
				},
				limit: {
					type: "number",
					minimum: 1,
					maximum: 100,
					default: 5,
					description: "Max memories to return."
				},
				json: {
					type: "boolean",
					default: false,
					description: "Return JSON results."
				}
			}
		}
	},
	{
		name: "decision-log",
		title: "Decision Logger",
		description:
			"Logs a structured decision.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				summary: {
					type: "string",
					description: "What was decided. Max 255 chars."
				},
				context: {
					type: "string",
					description: "Decision context. Min 10 chars."
				},
				rationale: {
					type: "string",
					description: "Why this decision was made. Min 10 chars."
				},
				alternatives: {
					type: "array",
					items: { type: "string" },
					description: "Alternatives considered."
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Tags (auto-includes 'decision')."
				},
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				json: {
					type: "boolean",
					default: false,
					description: "Return JSON results."
				}
			},
			required: ["summary", "context", "rationale"]
		}
	},
	{
		name: "session-summarize",
		title: "Session Summarizer",
		description:
			"Persists a session summary as task_archive.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				summary: {
					type: "string",
					description: "Session summary. Min 10 chars."
				},
				key_decisions: {
					type: "array",
					items: { type: "string" },
					description: "Key decisions made this session."
				},
				next_steps: {
					type: "array",
					items: { type: "string" },
					description: "Next steps or follow-up actions."
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Tags (auto-includes 'session-summary')."
				},
				owner: {
					type: "string",
					description: "GitHub org or username. Auto-inferred."
				},
				repo: {
					type: "string",
					description: "Repo name. Auto-inferred."
				},
				json: {
					type: "boolean",
					default: false,
					description: "Return JSON results."
				}
			},
			required: ["summary"]
		}
	}
];
