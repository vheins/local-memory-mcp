// Tool definitions for knowledge graph domain

export const KG_TOOL_DEFINITIONS = [
	{
		name: "create_entity",
		title: "KG Create Entity",
		description:
			"Creates a new knowledge graph entity. Entities represent nodes in the knowledge graph (e.g., concepts, people, systems). Name must be unique per repo. Owner and repo are auto-inferred from session when omitted.",
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
					description: "Unique entity name (acts as primary key per repo)."
				},
				type: {
					type: "string",
					default: "unknown",
					description: "Entity type for categorization (e.g., 'person', 'system', 'concept')."
				},
				description: {
					type: "string",
					description: "Optional description of the entity."
				},
				owner: {
					type: "string",
					description: "Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON results."
				}
			},
			required: ["name"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				entity: {
					type: "object",
					properties: {
						name: { type: "string" },
						type: { type: "string" },
						description: { type: "string" },
						repo: { type: "string" },
						owner: { type: "string" }
					}
				}
			}
		}
	},
	{
		name: "delete_entity",
		title: "KG Delete Entity",
		description:
			"Deletes a knowledge graph entity by name. All related relations and observations are automatically removed via CASCADE. Owner and repo are auto-inferred from session when omitted.",
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
					description: "Name of the entity to delete."
				},
				owner: {
					type: "string",
					description: "Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON results."
				}
			},
			required: ["name"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				deletedCount: { type: "number" }
			}
		}
	},
	{
		name: "create_relation",
		title: "KG Create Relation",
		description:
			"Creates a directed relation between two existing knowledge graph entities. Both from_entity and to_entity must already exist. The composite key (from_entity, to_entity, relation_type) must be unique. Owner and repo are auto-inferred from session when omitted.",
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
					description: "Source entity name (must exist)."
				},
				to_entity: {
					type: "string",
					description: "Target entity name (must exist)."
				},
				relation_type: {
					type: "string",
					description: "Type of relation (e.g., 'depends_on', 'implements', 'part_of')."
				},
				owner: {
					type: "string",
					description: "Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON results."
				}
			},
			required: ["from_entity", "to_entity", "relation_type"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				relation: {
					type: "object",
					properties: {
						from_entity: { type: "string" },
						to_entity: { type: "string" },
						relation_type: { type: "string" }
					}
				}
			}
		}
	},
	{
		name: "delete_relation",
		title: "KG Delete Relation",
		description:
			"Deletes a relation by its composite key (from_entity, to_entity, relation_type). Owner and repo are auto-inferred from session when omitted.",
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
					description: "Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON results."
				}
			},
			required: ["from_entity", "to_entity", "relation_type"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				deletedCount: { type: "number" }
			}
		}
	},
	{
		name: "delete_observation",
		title: "KG Delete Observation",
		description:
			"Deletes an observation by its ID. Observation IDs are UUIDs returned when observations are created. Owner and repo are auto-inferred from session when omitted.",
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
					description: "UUID of the observation to delete."
				},
				owner: {
					type: "string",
					description: "Organization/namespace (e.g., GitHub org or username). Auto-inferred from session when omitted."
				},
				repo: {
					type: "string",
					description: "Repository/project name (e.g., 'local-memory-mcp'). Auto-inferred from session when omitted."
				},
				structured: {
					type: "boolean",
					default: false,
					description: "If true, returns structured JSON results."
				}
			},
			required: ["id"]
		},
		outputSchema: {
			type: "object",
			properties: {
				success: { type: "boolean" },
				deletedCount: { type: "number" }
			}
		}
	},
	{
		name: "kg-backfill",
		description:
			"Scan existing memories and standards to extract Knowledge Graph entities via NLP. If no repo specified, scans all repositories. Progress logged every 100 items.",
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
					description: "Optional repo filter. If omitted, scans all repos."
				},
				owner: {
					type: "string",
					description: "Optional owner."
				},
				source: {
					type: "string",
					enum: ["memories", "standards", "both"],
					description: "Source to scan."
				}
			}
		}
	}
];
