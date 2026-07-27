// Tool definitions for handoff and claim domain

export const HANDOFF_TOOL_DEFINITIONS = [
	{
		name: "handoff-create",
		title: "Handoff Create",
		description:
			"Creates pending handoff between agents.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name (e.g., 'local-memory-mcp')." },
				from_agent: { type: "string", description: "Agent creating the handoff" },
				to_agent: { type: "string", description: "Optional target agent" },
				task_id: { type: "string", format: "uuid", description: "Optional task id to associate" },
				task_code: { type: "string", description: "Optional task code to associate" },
				summary: { type: "string", minLength: 1, description: "Concise human-readable transfer summary" },
				context: {
					type: "object",
					description:
						"Include next_steps/blockers/remaining_work."
				},
				expires_at: { type: "string", description: "Optional expiration timestamp" },
				json: { type: "boolean", default: false }
			},
			required: ["owner", "repo", "from_agent", "summary"]
		}
	},
	{
		name: "handoff-update",
		title: "Handoff Update",
		description:
			"Closes or reclassifies a handoff.",
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
		}
	},
	{
		name: "handoff-list",
		title: "Handoff List",
		description:
			"Lists handoffs with status/agent filters.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name (e.g., 'local-memory-mcp')." },
				status: { type: "string", enum: ["pending", "accepted", "rejected", "expired"] },
				from_agent: { type: "string" },
				to_agent: { type: "string" },
				limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
				offset: { type: "number", minimum: 0, default: 0 },
				json: { type: "boolean", default: false }
			},
			required: ["owner", "repo"]
		}
	},
	{
		name: "task-claim",
		title: "Task Claim",
		description:
			"Claims task ownership for an agent.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name (e.g., 'local-memory-mcp')." },
				task_id: {
					type: "string",
					format: "uuid",
					description: "Task ID. Optional if task_code given."
				},
				task_code: { type: "string", description: "Task code. Optional if task_id given." },
				agent: { type: "string", description: "Claiming agent name" },
				role: { type: "string", description: "Claiming agent role" },
				metadata: { type: "object", description: "Optional claim metadata" },
				json: { type: "boolean", default: false }
			},
			required: ["owner", "repo", "agent"]
		}
	},
	{
		name: "claim-list",
		title: "Claim List",
		description:
			"Lists claims, optionally filtered by agent.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name (e.g., 'local-memory-mcp')." },
				agent: { type: "string", description: "Optional agent filter" },
				active_only: { type: "boolean", description: "Return only unreleased claims." },
				limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
				offset: { type: "number", minimum: 0, default: 0 },
				json: { type: "boolean", default: false }
			},
			required: ["owner", "repo"]
		}
	},
	{
		name: "claim-release",
		title: "Claim Release",
		description:
			"Releases an active claim for a task.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username." },
				repo: { type: "string", description: "Repo name (e.g., 'local-memory-mcp')." },
				task_id: {
					type: "string",
					format: "uuid",
					description: "Task ID. Optional if task_code given."
				},
				task_code: { type: "string", description: "Task code. Optional if task_id given." },
				agent: { type: "string", description: "Agent name to release only that claim." },
				json: { type: "boolean", default: false }
			},
			required: ["repo", "owner"]
		}
	}
];
