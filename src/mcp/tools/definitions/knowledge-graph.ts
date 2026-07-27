// Tool definitions for knowledge graph domain

export const KG_TOOL_DEFINITIONS = [
	{
		name: "create_entity",
		title: "KG Create Entity",
		description:
			"Creates a new knowledge graph entity node.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Unique entity name."
				},
				type: {
					type: "string",
					default: "unknown",
					description: "Entity type for categorization."
				},
				description: {
					type: "string",
					description: "Optional entity description."
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
			required: ["name"]
		}
	},
	{
		name: "delete_entity",
		title: "KG Delete Entity",
		description:
			"Deletes a KG entity with CASCADE.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Entity name to delete."
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
			required: ["name"]
		}
	},
	{
		name: "create_relation",
		title: "KG Create Relation",
		description:
			"Creates directed KG relation.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				from_entity: {
					type: "string",
					description: "Source entity name."
				},
				to_entity: {
					type: "string",
					description: "Target entity name."
				},
				relation_type: {
					type: "string",
					description: "Relation type."
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
			required: ["from_entity", "to_entity", "relation_type"]
		}
	},
	{
		name: "delete_relation",
		title: "KG Delete Relation",
		description:
			"Deletes a relation by its composite key.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				from_entity: {
					type: "string",
					description: "Source entity name."
				},
				to_entity: {
					type: "string",
					description: "Target entity name."
				},
				relation_type: {
					type: "string",
					description: "Relation type."
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
			required: ["from_entity", "to_entity", "relation_type"]
		}
	},
	{
		name: "delete_observation",
		title: "KG Delete Observation",
		description:
			"Deletes an observation by its UUID ID.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Observation UUID to delete."
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
			required: ["id"]
		}
	},
	{
		name: "query_graph",
		title: "Query Graph",
		description:
			"Fusion query across KG + codebase index.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
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
					description: "Repo name."
				},
				type_filter: {
					type: "string",
					description:
						"Filter by entity type or symbol kind."
				},
				json: {
					type: "boolean",
					default: false,
					description: "Return JSON results."
				}
			},
			required: ["owner", "repo"]
		}
	},
	{
		name: "kg-backfill",
		description:
			"Scans memories/standards for KG entities.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: {
			type: "object",
			properties: {
				repo: {
					type: "string",
					description: "Optional repo filter."
				},
				owner: {
					type: "string",
					description: "Optional owner filter."
				},
				source: {
					type: "string",
					enum: ["memories", "standards", "both"],
					description: "Source to scan."
				},
				json: {
					type: "boolean",
					default: false,
					description: "Return JSON results."
				}
			}
		}
	}
];
