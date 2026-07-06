// Tool definitions for agent-context domain

export const AGENT_TOOL_DEFINITIONS = [
	{
		name: "agent-context",
		title: "Agent Context Recall",
		description:
			"Returns relevant context for the current agent session. Auto-detects active repo, searches relevant memories, lists active tasks, and surfaces recent decisions formatted as a single context block ready for injection into agent prompts.",
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
					description: "Organization/namespace (e.g., GitHub org or username). Auto-detected from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name. Auto-detected from session when omitted."
				},
				objective: {
					type: "string",
					description: "Current agent objective to search relevant memories around."
				},
				type_filter: {
					type: "string",
					description: "Memory type to filter by (e.g., 'decision', 'code_fact', 'pattern', 'mistake'). Default: all."
				},
				limit: {
					type: "number",
					minimum: 1,
					maximum: 100,
					default: 5,
					description: "Maximum number of memories to return."
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON results."
				}
			}
		},
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "string", enum: ["agent-context"] },
				repo: { type: "string" },
				objective: { type: "string" },
				memories: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							code: { type: "string" },
							title: { type: "string" },
							type: { type: "string" },
							importance: { type: "number" }
						}
					}
				},
				decisions: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							code: { type: "string" },
							title: { type: "string" },
							importance: { type: "number" }
						}
					}
				},
				tasks: {
					type: "array",
					items: {
						type: "object",
						properties: {
							task_code: { type: "string" },
							title: { type: "string" },
							status: { type: "string" },
							priority: { type: "number" }
						}
					}
				}
			},
			required: ["schema", "repo", "memories", "decisions", "tasks"]
		}
	},
	{
		name: "decision-log",
		title: "Decision Logger",
		description:
			"Logs a structured decision as a memory entry. Accepts a summary of what was decided, the context/situation, the rationale, and optional alternatives considered. Internally reuses the memory-store handler with type='decision' and importance=4. Owner and repo are auto-inferred from session when omitted.",
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
					description: "What was decided (used as the memory title). Max 255 characters."
				},
				context: {
					type: "string",
					description: "The situation or context surrounding the decision. Min 10 characters."
				},
				rationale: {
					type: "string",
					description: "Why this decision was made. Min 10 characters."
				},
				alternatives: {
					type: "array",
					items: { type: "string" },
					description: "Alternatives that were considered (optional)."
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Additional tags to apply (auto-includes 'decision')."
				},
				owner: {
					type: "string",
					description: "Organization/namespace. Auto-detected from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name. Auto-detected from session when omitted."
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON results."
				}
			},
			required: ["summary", "context", "rationale"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				code: { type: "string" },
				repo: { type: "string" },
				type: { type: "string", enum: ["decision"] },
				title: { type: "string" }
			}
		}
	},
	{
		name: "session-summarize",
		title: "Session Summarizer",
		description:
			"Persists a session summary as a task_archive memory entry. Accepts a session summary, optional key decisions made, optional next steps, and optional tags. Internally reuses the memory-store handler with type='task_archive' and importance=3. Owner and repo are auto-inferred from session when omitted.",
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
					description: "Session summary text. Min 10 characters."
				},
				key_decisions: {
					type: "array",
					items: { type: "string" },
					description: "Key decisions made during this session (optional)."
				},
				next_steps: {
					type: "array",
					items: { type: "string" },
					description: "Next steps or follow-up actions (optional)."
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Additional tags to apply (auto-includes 'session-summary')."
				},
				owner: {
					type: "string",
					description: "Organization/namespace. Auto-detected from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name. Auto-detected from session when omitted."
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON results."
				}
			},
			required: ["summary"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				code: { type: "string" },
				repo: { type: "string" },
				type: { type: "string", enum: ["task_archive"] },
				title: { type: "string" }
			}
		}
	},
	// ── Upstream compatibility aliases ──────────────────────────────────────
	{
		name: "remember_fact",
		title: "Remember Fact (Upstream)",
		description:
			"Upstream-compatible alias for memory-store. Stores a single fact as a memory entry. Accepts the same arguments as memory-store. Owner and repo are auto-inferred from session when omitted.",
		annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Auto-detected from session." },
				repo: { type: "string", description: "Auto-detected from session." },
				title: { type: "string", description: "Title for the fact/memory." },
				content: { type: "string", description: "The fact content to store." },
				type: { type: "string", default: "code_fact" },
				importance: { type: "number", default: 3 },
				tags: { type: "array", items: { type: "string" } }
			},
			required: ["content"]
		},
		outputSchema: {
			type: "object",
			properties: { success: { type: "boolean" }, id: { type: "string" }, code: { type: "string" } }
		}
	},
	{
		name: "remember_facts",
		title: "Remember Facts (Upstream Bulk)",
		description: "Upstream-compatible alias for bulk memory-store. Stores multiple facts at once.",
		annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string" },
				repo: { type: "string" },
				facts: { type: "array", items: { type: "object" }, description: "Array of fact objects." }
			},
			required: ["facts"]
		},
		outputSchema: { type: "object", properties: { success: { type: "boolean" }, count: { type: "number" } } }
	},
	{
		name: "recall",
		title: "Recall (Upstream)",
		description: "Upstream-compatible alias for memory-search. Searches stored memories by query.",
		annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string" },
				repo: { type: "string" },
				query: { type: "string", description: "Search query." },
				type: { type: "string", description: "Filter by memory type." },
				limit: { type: "number", default: 10 }
			},
			required: ["query"]
		},
		outputSchema: { type: "object", properties: { memories: { type: "array", items: { type: "object" } } } }
	},
	{
		name: "forget",
		title: "Forget (Upstream)",
		description: "Upstream-compatible alias for memory-delete. Deletes a stored memory by id or code.",
		annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: true },
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string" },
				repo: { type: "string" },
				id: { type: "string", description: "Memory ID to delete." },
				code: { type: "string", description: "Memory code to delete." }
			},
			required: []
		},
		outputSchema: { type: "object", properties: { success: { type: "boolean" } } }
	}
];
