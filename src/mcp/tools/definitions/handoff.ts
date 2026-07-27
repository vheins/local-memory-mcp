// Tool definitions for handoff and claim domain

export const HANDOFF_TOOL_DEFINITIONS = [
	{
		name: "handoff-write",
		title: "Handoff Write",
		description:
			"Creates or updates a handoff. Auto-infers operation: provide summary+from_agent (with owner, repo) for CREATE; provide id+status for UPDATE.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username. Required for CREATE." },
				repo: { type: "string", description: "Repo name. Required for CREATE." },
				from_agent: { type: "string", description: "Agent creating the handoff. Required for CREATE." },
				to_agent: { type: "string", description: "Optional target agent" },
				task_id: { type: "string", format: "uuid", description: "Optional task id to associate" },
				task_code: { type: "string", description: "Optional task code to associate" },
				summary: {
					type: "string",
					minLength: 1,
					description: "Concise human-readable transfer summary. Required for CREATE."
				},
				context: {
					type: "object",
					description: "Include next_steps/blockers/remaining_work."
				},
				expires_at: { type: "string", description: "Optional expiration timestamp" },
				id: { type: "string", format: "uuid", description: "Handoff ID. Required for UPDATE." },
				status: {
					type: "string",
					enum: ["pending", "accepted", "rejected", "expired"],
					description: "New status. Required for UPDATE."
				},
				json: { type: "boolean", default: false }
			}
		}
	},
	{
		name: "claim-manage",
		title: "Claim Manage",
		description:
			"Manages claims: CLAIM (task_id/task_code + agent), RELEASE (task_id/task_code + release:true), or LIST (query). Auto-infers operation from field presence.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string", description: "GitHub org or username. Use with query for LIST." },
				repo: { type: "string", description: "Repo name. Use with query for LIST." },
				task_id: {
					type: "string",
					format: "uuid",
					description: "Task ID for CLAIM or RELEASE."
				},
				task_code: {
					type: "string",
					description: "Task code for CLAIM or RELEASE."
				},
				agent: {
					type: "string",
					description: "Required for CLAIM (claiming agent). Optional for RELEASE (filter) and LIST (filter)."
				},
				role: { type: "string", description: "Claiming agent role (CLAIM only)." },
				metadata: { type: "object", description: "Optional claim metadata (CLAIM only)." },
				release: {
					type: "boolean",
					default: false,
					description: "Set to true for RELEASE mode."
				},
				query: {
					type: "string",
					description: "Present to trigger LIST mode. Lists active claims."
				},
				active_only: {
					type: "boolean",
					default: true,
					description: "LIST mode: return only unreleased claims."
				},
				limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
				offset: { type: "number", minimum: 0, default: 0 },
				json: { type: "boolean", default: false }
			}
		}
	},
	{
		name: "handoff-read",
		title: "Handoff Read",
		description:
			"Reads handoffs and claims — detail, list, or search. Auto-infers operation: id for DETAIL, claim:true or agent for LIST CLAIMS, query for SEARCH handoffs, or none for LIST HANDOFFS.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", format: "uuid", description: "Handoff ID for DETAIL mode." },
				claim: {
					type: "boolean",
					default: false,
					description: "Set true for LIST CLAIMS mode. Also inferred from 'agent' presence."
				},
				query: {
					type: "string",
					description: "Present to trigger SEARCH handoffs mode with optional filters."
				},
				status: {
					type: "string",
					enum: ["pending", "accepted", "rejected", "expired"],
					description: "Filter by handoff status (SEARCH / LIST HANDOFFS)."
				},
				from_agent: {
					type: "string",
					description: "Filter by originating agent (SEARCH / LIST HANDOFFS)."
				},
				to_agent: {
					type: "string",
					description: "Filter by target agent (SEARCH / LIST HANDOFFS)."
				},
				agent: {
					type: "string",
					description: "Filter by claiming agent (LIST CLAIMS). Also triggers LIST CLAIMS mode."
				},
				active_only: {
					type: "boolean",
					default: true,
					description: "LIST CLAIMS mode: return only unreleased claims."
				},
				limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
				offset: { type: "number", minimum: 0, default: 0 },
				owner: { type: "string", description: "GitHub org or username. Auto-inferred." },
				repo: { type: "string", description: "Repo name. Auto-inferred." },
				json: { type: "boolean", default: false }
			}
		}
	}
];
