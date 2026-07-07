// Tool definitions for memory domain

export const MEMORY_TOOL_DEFINITIONS = [
	{
		name: "memory-synthesize",
		title: "Memory Synthesize",
		description:
			"Use client sampling to synthesize a grounded answer from local memory and tasks. Best for project briefings, tradeoff summaries, and context-aware answers.",
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
					description: "Organization/namespace (e.g., GitHub org or username)."
				},
				repo: {
					type: "string",
					description: "Repository/project name (e.g., 'local-memory-mcp'). Optional when a single MCP root is active."
				},
				objective: { type: "string", minLength: 5, description: "Question or synthesis objective." },
				current_file_path: {
					type: "string",
					description: "Optional absolute file path for workspace-local grounding."
				},
				include_summary: { type: "boolean", default: true },
				include_tasks: { type: "boolean", default: true },
				use_tools: {
					type: "boolean",
					default: true,
					description:
						"Allow the sampled model to call local memory/task tools during synthesis when the client supports sampling.tools."
				},
				max_iterations: { type: "number", minimum: 1, maximum: 5, default: 3 },
				max_tokens: { type: "number", minimum: 128, maximum: 4000, default: 1200 },
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON results." }
			},
			required: ["owner", "objective"]
		},
		outputSchema: {
			type: "object",
			properties: {
				repo: { type: "string" },
				objective: { type: "string" },
				answer: { type: "string" },
				model: { type: "string" },
				stopReason: { type: "string" },
				iterations: { type: "number" },
				toolCalls: { type: "number" }
			},
			required: ["repo", "objective", "answer", "iterations", "toolCalls"]
		}
	},
	{
		name: "memory-detail",
		title: "Memory Detail",
		description:
			"Fetch full details of a specific memory by ID or short code. Use after memory-recap or memory-search when a pointer row is relevant and full content is needed.",
		inputSchema: {
			type: "object",
			oneOf: [
				{
					title: "By ID",
					required: ["id"],
					properties: {
						id: { type: "string", format: "uuid", description: "Memory entry ID." },
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON details." }
					}
				},
				{
					title: "By code",
					required: ["code", "owner", "repo"],
					properties: {
						code: { type: "string", description: "Short memory code." },
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON details." }
					}
				}
			]
		}
	},
	{
		name: "memory-store",
		title: "Memory Store",
		description:
			"Store a new durable knowledge entry. Do not store coordination state here: task claims, file claims, agent registration, and handoffs belong to task-claim, task-update, and handoff-* tools. Keep 'title' concise and human-readable; put auxiliary context into 'metadata'.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			oneOf: [
				{
					title: "Single memory",
					required: ["type", "title", "content", "importance", "agent", "model", "scope"],
					properties: {
						type: {
							type: "string",
							enum: ["code_fact", "decision", "mistake", "pattern", "task_archive"],
							description:
								"Type of durable knowledge being stored. Coordination types such as file_claim are intentionally unsupported."
						},
						title: {
							type: "string",
							minLength: 3,
							maxLength: 100,
							description:
								"Short human-readable title for the memory. Do not embed bracketed metadata like agent/role/date prefixes here."
						},
						content: {
							type: "string",
							minLength: 10,
							description: "The memory content"
						},
						importance: {
							type: "number",
							minimum: 1,
							maximum: 5,
							description: "Importance score (1-5)"
						},
						agent: {
							type: "string",
							description: "Name of the agent creating this memory"
						},
						role: {
							type: "string",
							description: "Role of the agent creating this memory"
						},
						model: {
							type: "string",
							description: "AI model used by the agent"
						},
						scope: {
							type: "object",
							properties: {
								owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)" },
								repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')" },
								branch: { type: "string", description: "Git branch this memory relates to" },
								folder: { type: "string", description: "Subdirectory within the repo" },
								language: { type: "string", description: "Programming language (e.g., 'typescript', 'python')" }
							},
							required: ["owner", "repo"]
						},
						code: { type: "string", maxLength: 20, description: "Optional custom code. Auto-generated if omitted." },
						tags: {
							type: "array",
							items: { type: "string" },
							description: "Technology stack tags (e.g., ['filament', 'laravel'])"
						},
						metadata: {
							type: "object",
							description: "Structured metadata for non-title context such as source agent, claim fields, or timestamps"
						},
						is_global: { type: "boolean", description: "If true, this memory is shared across all repositories" },
						ttlDays: {
							type: "number",
							minimum: 1,
							description: "Time-to-live in days. After this period, the memory expires."
						},
						supersedes: {
							type: "string",
							description: "Optional memory ID (UUID) or memory code to supersede. Resolved before storing."
						},
						structured: {
							type: "boolean",
							default: false,
							description: "If true, returns structured JSON of the stored memory."
						}
					}
				},
				{
					title: "Bulk memories",
					required: ["memories"],
					properties: {
						memories: {
							type: "array",
							items: {
								type: "object",
								properties: {
									type: {
										type: "string",
										enum: ["code_fact", "decision", "mistake", "pattern", "task_archive"],
										description: "Type of durable knowledge being stored"
									},
									title: { type: "string", minLength: 3, maxLength: 100, description: "Short human-readable title" },
									content: { type: "string", minLength: 10, description: "The memory content" },
									importance: { type: "number", minimum: 1, maximum: 5, description: "Importance score (1-5)" },
									agent: { type: "string", description: "Name of the agent creating this memory" },
									role: { type: "string", default: "unknown", description: "Role of the agent creating this memory" },
									model: { type: "string", description: "AI model used by the agent" },
									scope: {
										type: "object",
										properties: {
											owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)" },
											repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')" },
											branch: { type: "string", description: "Git branch this memory relates to" },
											folder: { type: "string", description: "Subdirectory within the repo" },
											language: { type: "string", description: "Programming language" }
										},
										required: ["owner", "repo"]
									},
									code: { type: "string", description: "Optional custom code. Auto-generated if omitted." },
									ttlDays: { type: "number", minimum: 1, description: "Time-to-live in days" },
									supersedes: { type: "string", description: "UUID or code of a memory this entry replaces" },
									tags: { type: "array", items: { type: "string" }, description: "Technology stack tags" },
									metadata: { type: "object", description: "Structured metadata for non-title context" },
									is_global: { type: "boolean", default: false, description: "If true, shared across all repositories" }
								},
								required: ["type", "title", "content", "importance", "agent", "model", "scope"]
							},
							description: "Array of memories for bulk creation"
						},
						structured: {
							type: "boolean",
							default: false,
							description: "If true, returns structured JSON of the stored memory."
						}
					}
				}
			]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				code: { type: "string" },
				repo: { type: "string" },
				type: { type: "string" },
				title: { type: "string" },
				error: { type: "string" },
				message: { type: "string" }
			},
			required: ["success"]
		}
	},
	{
		name: "memory-acknowledge",
		title: "Memory Acknowledge",
		description:
			"Acknowledge the use of a memory or report its irrelevance/contradiction. Mandatory after using memory to generate code.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				memory_id: { type: "string", format: "uuid", description: "Memory entry ID. Optional if code is provided." },
				code: { type: "string", maxLength: 20, description: "Short memory code. Optional if memory_id is provided." },
				status: { type: "string", enum: ["used", "irrelevant", "contradictory"] },
				application_context: { type: "string", minLength: 10 },
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
			},
			required: ["status"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				status: { type: "string" }
			},
			required: ["success", "id", "status"]
		}
	},
	{
		name: "memory-update",
		title: "Memory Update",
		description:
			"Update an existing memory entry. Keep 'title' concise and move agent/role/date or claim context into 'metadata' instead of the title.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			oneOf: [
				{
					title: "By ID",
					required: ["owner", "repo", "id"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						id: { type: "string", format: "uuid", description: "Memory entry ID." },
						type: { type: "string", enum: ["code_fact", "decision", "mistake", "pattern", "task_archive"] },
						title: { type: "string", minLength: 3, maxLength: 100 },
						content: { type: "string", minLength: 10 },
						importance: { type: "number", minimum: 1, maximum: 5 },
						agent: { type: "string" },
						role: { type: "string" },
						status: { type: "string", enum: ["active", "archived"] },
						supersedes: { type: "string" },
						tags: { type: "array", items: { type: "string" } },
						metadata: { type: "object" },
						is_global: { type: "boolean" },
						completed_at: { type: "string" },
						structured: {
							type: "boolean",
							default: false,
							description: "If true, returns structured JSON of the updated memory."
						}
					}
				},
				{
					title: "By code",
					required: ["owner", "repo", "code"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						code: { type: "string", maxLength: 20, description: "Short memory code." },
						type: { type: "string", enum: ["code_fact", "decision", "mistake", "pattern", "task_archive"] },
						title: { type: "string", minLength: 3, maxLength: 100 },
						content: { type: "string", minLength: 10 },
						importance: { type: "number", minimum: 1, maximum: 5 },
						agent: { type: "string" },
						role: { type: "string" },
						status: { type: "string", enum: ["active", "archived"] },
						supersedes: { type: "string" },
						tags: { type: "array", items: { type: "string" } },
						metadata: { type: "object" },
						is_global: { type: "boolean" },
						completed_at: { type: "string" },
						structured: {
							type: "boolean",
							default: false,
							description: "If true, returns structured JSON of the updated memory."
						}
					}
				}
			]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				code: { type: "string" },
				repo: { type: "string" },
				updatedFields: {
					type: "array",
					items: { type: "string" }
				}
			},
			required: ["success", "repo", "updatedFields"]
		}
	},
	{
		name: "memory-search",
		title: "Memory Search",
		description:
			"NAVIGATION LAYER: Returns a pointer table of matching memory IDs only. Returns columns [id, title, type, importance] — NO content. Retrieve full memory via memory-detail. Use 'current_tags' to find tech-stack specific knowledge from other projects.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					minLength: 3,
					description: "Search keyword to match against memory titles and content"
				},
				prompt: { type: "string", description: "Natural language prompt for semantic search" },
				owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
				repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
				current_tags: {
					type: "array",
					items: { type: "string" },
					description: "Active tech stack tags (e.g., ['filament', 'react'])"
				},
				types: {
					type: "array",
					items: {
						type: "string",
						enum: ["code_fact", "decision", "mistake", "pattern", "task_archive"]
					},
					description: "Filter by memory type(s)"
				},
				minImportance: { type: "number", minimum: 1, maximum: 5, description: "Minimum importance threshold (1-5)" },
				limit: { type: "number", minimum: 1, maximum: 100, default: 5 },
				offset: { type: "number", minimum: 0, default: 0 },
				includeRecap: { type: "boolean", default: false },
				current_file_path: { type: "string", description: "Absolute file path for workspace-local grounding" },
				include_archived: {
					type: "boolean",
					default: false,
					description: "Include archived/expired memories in results"
				},
				scope: {
					type: "object",
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)" },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')" },
						branch: { type: "string", description: "Git branch filter" },
						folder: { type: "string", description: "Subdirectory filter" },
						language: { type: "string", description: "Programming language filter" }
					}
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON without the text content summary."
				}
			},
			required: ["owner", "query", "repo"]
		},
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "string", enum: ["memory-search"] },
				query: { type: "string" },
				count: { type: "number", description: "Number of rows returned" },
				total: { type: "number", description: "Total matching memories" },
				offset: { type: "number" },
				limit: { type: "number" },
				results: {
					type: "object",
					properties: {
						columns: {
							type: "array",
							items: { type: "string" },
							description: "Column names: [id, title, type, importance]"
						},
						rows: {
							type: "array",
							items: { type: "array" },
							description: "Each row: [id, title, type, importance]. Fetch full content via memory-detail"
						}
					},
					required: ["columns", "rows"]
				}
			},
			required: ["schema", "query", "count", "total", "offset", "limit", "results"]
		}
	},
	{
		name: "memory-summarize",
		title: "Memory Summarize",
		description: "Update the summary for a repository",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
				repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
				signals: {
					type: "array",
					items: { type: "string", maxLength: 200 },
					minItems: 1,
					description: "High-level signals to include in summary"
				},
				structured: { type: "boolean", default: false, description: "If true, returns structured JSON of the summary." }
			},
			required: ["owner", "repo", "signals"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				repo: { type: "string" },
				summary: { type: "string" },
				signalCount: { type: "number" }
			},
			required: ["success", "repo", "summary", "signalCount"]
		}
	},
	{
		name: "memory-delete",
		title: "Memory Delete",
		description: "Soft-delete one or more memory entries. Supports single 'id' or bulk 'ids'.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			oneOf: [
				{
					title: "By single ID",
					required: ["owner", "repo", "id"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						id: { type: "string", format: "uuid", description: "Memory entry ID to delete." },
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By bulk IDs",
					required: ["owner", "repo", "ids"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						ids: {
							type: "array",
							items: { type: "string", format: "uuid" },
							minItems: 1,
							description: "Array of memory IDs to delete"
						},
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By single code",
					required: ["owner", "repo", "code"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						code: { type: "string", maxLength: 20, description: "Short memory code." },
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				},
				{
					title: "By bulk codes",
					required: ["owner", "repo", "codes"],
					properties: {
						owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
						repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
						codes: {
							type: "array",
							items: { type: "string", maxLength: 20 },
							minItems: 1,
							description: "Array of memory codes to delete"
						},
						structured: { type: "boolean", default: false, description: "If true, returns structured JSON result." }
					}
				}
			]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				code: { type: "string" },
				ids: { type: "array", items: { type: "string" } },
				codes: { type: "array", items: { type: "string" } },
				repo: { type: "string" },
				deletedCount: { type: "number" }
			},
			required: ["success"]
		}
	},
	{
		name: "memory-recap",
		title: "Memory Recap",
		description:
			"AGGREGATED OVERVIEW LAYER: Returns stats (counts by type) and a pointer table of top memories [id, code, title, type, importance]. NO content. Use for orientation only — retrieve full memory via memory-detail.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
				repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
				limit: {
					type: "number",
					minimum: 1,
					maximum: 50,
					default: 20,
					description: "Maximum number of top memories to return in the pointer table"
				},
				offset: {
					type: "number",
					minimum: 0,
					default: 0,
					description: "Number of memories to skip for pagination (optional, default 0)"
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON without the text content summary."
				}
			},
			required: ["owner", "repo"]
		},
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "string", enum: ["memory-recap"] },
				repo: { type: "string" },
				count: { type: "number", description: "Number of rows in the top pointer table" },
				total: { type: "number", description: "Total active memories in repo" },
				offset: { type: "number" },
				limit: { type: "number" },
				stats: {
					type: "object",
					properties: {
						byType: {
							type: "object",
							description: "Count of active memories per type (e.g. { decision: 3, code_fact: 7 })"
						}
					},
					required: ["byType"]
				},
				top: {
					type: "object",
					properties: {
						columns: {
							type: "array",
							items: { type: "string" },
							description: "Column names: [id, code, title, type, importance]"
						},
						rows: {
							type: "array",
							items: { type: "array" },
							description: "Each row: [id, code, title, type, importance]. Fetch full content via memory-detail"
						}
					},
					required: ["columns", "rows"]
				}
			},
			required: ["schema", "repo", "count", "total", "offset", "limit", "stats", "top"]
		}
	}
];
