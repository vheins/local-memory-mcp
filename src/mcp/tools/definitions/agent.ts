// Tool definitions for agent-context domain

export const AGENT_TOOL_DEFINITIONS = [
	// ── Agent Context tools ────────────────────────────────────────────────
	{
		name: "agent-context",
		title: "Agent Context Recall",
		description: "Agent context with memories and tasks.",
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
				query: {
					type: "string",
					description: "Natural language search query for context retrieval."
				},
				objective: {
					type: "string",
					description: "Deprecated: use query instead."
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
	// ── Agent Synthesis (moved from memory domain per ADR-001, ADR-007) ────

	// Canonical: synthesize (per ADR-001)
	{
		name: "synthesize",
		title: "Synthesize Context",
		description: "Synthesizes context from local memory and tasks using MCP sampling.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		execution: {
			taskSupport: "optional"
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username."
				},
				repo: {
					type: "string",
					description: "Repo name. Optional with active root."
				},
				objective: { type: "string", minLength: 5, description: "Question or synthesis objective." },
				current_file_path: {
					type: "string",
					description: "File path for workspace grounding."
				},
				include_summary: { type: "boolean", default: true },
				include_tasks: { type: "boolean", default: true },
				use_tools: {
					type: "boolean",
					default: true,
					description: "Allow tool calls during synthesis."
				},
				max_iterations: { type: "number", minimum: 1, maximum: 5, default: 3 },
				max_tokens: { type: "number", minimum: 128, maximum: 4000, default: 1200 },
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: ["owner", "objective"]
		}
	},

	// Backward-compat alias for synthesize
	{
		name: "agent-synthesize",
		title: "Agent Synthesize (Deprecated)",
		description: "DEPRECATED: Use synthesize instead. Synthesizes from local memory and tasks using MCP sampling.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		execution: {
			taskSupport: "optional"
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username."
				},
				repo: {
					type: "string",
					description: "Repo name. Optional with active root."
				},
				objective: { type: "string", minLength: 5, description: "Question or synthesis objective." },
				current_file_path: {
					type: "string",
					description: "File path for workspace grounding."
				},
				include_summary: { type: "boolean", default: true },
				include_tasks: { type: "boolean", default: true },
				use_tools: {
					type: "boolean",
					default: true,
					description: "Allow tool calls during synthesis."
				},
				max_iterations: { type: "number", minimum: 1, maximum: 5, default: 3 },
				max_tokens: { type: "number", minimum: 128, maximum: 4000, default: 1200 },
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: ["owner", "objective"]
		}
	},

	// Backward-compat alias for synthesize (old agent domain name)
	{
		name: "memory-synthesize",
		title: "Memory Synthesize (Deprecated)",
		description: "DEPRECATED: Use synthesize instead. Synthesizes from local memory and tasks.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		execution: {
			taskSupport: "optional"
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: {
					type: "string",
					description: "GitHub org or username."
				},
				repo: {
					type: "string",
					description: "Repo name. Optional with active root."
				},
				objective: { type: "string", minLength: 5, description: "Question or synthesis objective." },
				current_file_path: {
					type: "string",
					description: "File path for workspace grounding."
				},
				include_summary: { type: "boolean", default: true },
				include_tasks: { type: "boolean", default: true },
				use_tools: {
					type: "boolean",
					default: true,
					description: "Allow tool calls during synthesis."
				},
				max_iterations: { type: "number", minimum: 1, maximum: 5, default: 3 },
				max_tokens: { type: "number", minimum: 128, maximum: 4000, default: 1200 },
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: ["owner", "objective"]
		}
	},

	// Canonical: repo-summarize (per ADR-001)
	{
		name: "repo-summarize",
		title: "Repository Summarize",
		description: "Update the repository summary with signals.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name." },
				signals: {
					type: "array",
					items: { type: "string", maxLength: 200 },
					minItems: 1,
					description: "Signals to include in summary"
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: ["owner", "repo", "signals"]
		}
	},

	// Backward-compat alias for repo-summarize
	{
		name: "agent-summarize",
		title: "Agent Summarize (Deprecated)",
		description: "DEPRECATED: Use repo-summarize instead. Update the repository summary with signals.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name." },
				signals: {
					type: "array",
					items: { type: "string", maxLength: 200 },
					minItems: 1,
					description: "Signals to include in summary"
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: ["owner", "repo", "signals"]
		}
	},

	// Backward-compat alias for repo-summarize (old memory domain name)
	{
		name: "memory-summarize",
		title: "Memory Summarize (Deprecated)",
		description: "DEPRECATED: Use repo-summarize instead. Update the summary for a repository",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name." },
				signals: {
					type: "array",
					items: { type: "string", maxLength: 200 },
					minItems: 1,
					description: "Signals to include in summary"
				},
				json: { type: "boolean", default: false, description: "Returns JSON if true." }
			},
			required: ["owner", "repo", "signals"]
		}
	}
];
