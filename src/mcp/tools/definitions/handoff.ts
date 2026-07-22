// Tool definitions for handoff and claim domain

export const HANDOFF_TOOL_DEFINITIONS = [
	{
		name: "handoff-create",
		title: "Handoff Create",
		description:
			"Create a pending handoff only when unfinished work needs context transfer between agents. Do not use this for completed-work summaries, release notes, validation notes, or archives; put those on task-update/task comments or durable memory.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
				repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
				from_agent: { type: "string", description: "Agent creating the handoff" },
				to_agent: { type: "string", description: "Optional target agent" },
				task_id: { type: "string", format: "uuid", description: "Optional task id to associate" },
				task_code: { type: "string", description: "Optional task code to associate" },
				summary: { type: "string", minLength: 1, description: "Concise human-readable transfer summary" },
				context: {
					type: "object",
					description:
						"Structured handoff context. Include next_steps, blockers, or remaining_work unless a target agent or task is provided."
				},
				expires_at: { type: "string", description: "Optional expiration timestamp" },
				json: { type: "boolean", default: false }
			},
			required: ["owner", "repo", "from_agent", "summary"]
		},
		outputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				repo: { type: "string" },
				from_agent: { type: "string" },
				to_agent: { type: "string", nullable: true },
				task_id: { type: "string", nullable: true },
				summary: { type: "string" },
				context: { type: "object" },
				status: { type: "string", enum: ["pending", "accepted", "rejected", "expired"] },
				created_at: { type: "string" },
				updated_at: { type: "string" },
				expires_at: { type: "string", nullable: true }
			},
			required: ["id", "repo", "from_agent", "summary", "context", "status", "created_at", "updated_at"]
		}
	},
	{
		name: "handoff-update",
		title: "Handoff Update",
		description:
			"Close or reclassify a handoff after it has been consumed or found stale. Use accepted when transfer context was consumed, rejected when intentionally declined, and expired when the handoff is obsolete or only described completed work.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", format: "uuid", description: "Handoff ID" },
				status: { type: "string", enum: ["pending", "accepted", "rejected", "expired"] },
				json: { type: "boolean", default: false }
			},
			required: ["id", "status"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				id: { type: "string" },
				status: { type: "string", enum: ["pending", "accepted", "rejected", "expired"] }
			},
			required: ["success", "id", "status"]
		}
	},
	{
		name: "handoff-list",
		title: "Handoff List",
		description:
			"Navigation layer for handoff queues. List repository handoffs with optional status and agent filters, then inspect selected rows before acting.",
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
				status: { type: "string", enum: ["pending", "accepted", "rejected", "expired"] },
				from_agent: { type: "string" },
				to_agent: { type: "string" },
				limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
				offset: { type: "number", minimum: 0, default: 0 },
				json: { type: "boolean", default: false }
			},
			required: ["owner", "repo"]
		},
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "string", enum: ["handoff-list"] },
				handoffs: {
					type: "object",
					properties: {
						columns: {
							type: "array",
							items: { type: "string" },
							description:
								"Column names: [id, from_agent, to_agent, task_id, task_code, status, created_at, updated_at, expires_at, summary, context]"
						},
						rows: {
							type: "array",
							items: { type: "array" },
							description:
								"Each row: [id, from_agent, to_agent, task_id, task_code, status, created_at, updated_at, expires_at, summary, context]"
						}
					},
					required: ["columns", "rows"]
				},
				count: { type: "number" },
				offset: { type: "number" }
			},
			required: ["schema", "handoffs", "count", "offset"]
		}
	},
	{
		name: "task-claim",
		title: "Task Claim",
		description:
			"Claim task ownership for an agent using the dedicated claims table. Use this before taking work from task-list; provide either task_id or task_code.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
				repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
				task_id: {
					type: "string",
					format: "uuid",
					description: "Task id to claim. Optional if task_code is provided."
				},
				task_code: { type: "string", description: "Task code to claim. Optional if task_id is provided." },
				agent: { type: "string", description: "Claiming agent name" },
				role: { type: "string", description: "Claiming agent role" },
				metadata: { type: "object", description: "Optional claim metadata" },
				json: { type: "boolean", default: false }
			},
			required: ["owner", "repo", "agent"]
		},
		outputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				repo: { type: "string" },
				task_id: { type: "string" },
				task_code: { type: "string", nullable: true },
				agent: { type: "string" },
				role: { type: "string" },
				claimed_at: { type: "string" },
				released_at: { type: "string", nullable: true },
				metadata: { type: "object" }
			},
			required: ["id", "repo", "task_id", "agent", "role", "claimed_at", "metadata"]
		}
	},
	{
		name: "claim-list",
		title: "Claim List",
		description:
			"List task claims in a repository. Use this to inspect active ownership, optionally filtered by agent.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
				repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
				agent: { type: "string", description: "Optional agent filter" },
				active_only: { type: "boolean", description: "When true, return only unreleased claims" },
				limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
				offset: { type: "number", minimum: 0, default: 0 },
				json: { type: "boolean", default: false }
			},
			required: ["owner", "repo"]
		},
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "string", enum: ["claim-list"] },
				claims: {
					type: "object",
					properties: {
						columns: {
							type: "array",
							items: { type: "string" },
							description: "Column names: [id, task_id, task_code, agent, role, claimed_at, released_at, metadata]"
						},
						rows: {
							type: "array",
							items: { type: "array" },
							description: "Each row: [id, task_id, task_code, agent, role, claimed_at, released_at, metadata]"
						}
					},
					required: ["columns", "rows"]
				},
				count: { type: "number" },
				offset: { type: "number" }
			},
			required: ["schema", "claims", "count", "offset"]
		}
	},
	{
		name: "claim-release",
		title: "Claim Release",
		description: "Release an active claim for a task. Optionally restrict the release to a specific agent.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "Organization/namespace (e.g., GitHub org or username)." },
				repo: { type: "string", description: "Repository/project name (e.g., 'local-memory-mcp')." },
				task_id: {
					type: "string",
					format: "uuid",
					description: "Task id to release. Optional if task_code is provided."
				},
				task_code: { type: "string", description: "Task code to release. Optional if task_id is provided." },
				agent: { type: "string", description: "Optional agent name to release only that claim" },
				json: { type: "boolean", default: false }
			},
			required: ["repo", "owner"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				repo: { type: "string" },
				task_id: { type: "string" },
				task_code: { type: "string", nullable: true },
				agent: { type: "string", nullable: true }
			},
			required: ["success", "repo", "task_id"]
		}
	}
];
