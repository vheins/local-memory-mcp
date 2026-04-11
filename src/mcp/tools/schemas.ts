import { z } from "zod";
import { normalizeRepo } from "../utils/normalize.js";

// Shared schema components
export const MemoryScopeSchema = z.object({
  repo: z.string().min(1).transform(normalizeRepo),
  branch: z.string().optional(),
  folder: z.string().optional(),
  language: z.string().optional()
});

export const MemoryTypeSchema = z.enum(["code_fact", "decision", "mistake", "pattern", "agent_handoff", "agent_registered", "file_claim", "task_archive"]);

// Tool schemas
export const MemoryStoreSchema = z.object({
  type: MemoryTypeSchema,
  title: z.string().min(3).max(100),
  content: z.string().min(10),
  importance: z.number().min(1).max(5),
  agent: z.string().min(1),
  role: z.string().optional().default("unknown"),
  model: z.string().min(1),
  scope: MemoryScopeSchema,
  ttlDays: z.number().min(1).optional(),
  supersedes: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  is_global: z.boolean().default(false)
});

export const MemoryUpdateSchema = z.object({
  id: z.string().uuid(),
  type: MemoryTypeSchema.optional(),
  title: z.string().min(3).max(100).optional(),
  content: z.string().min(10).optional(),
  importance: z.number().min(1).max(5).optional(),
  agent: z.string().optional(),
  role: z.string().optional(),
  status: z.enum(["active", "archived"]).optional(),
  supersedes: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  is_global: z.boolean().optional(),
  completed_at: z.string().optional()
}).refine(
  (data) => data.type !== undefined || data.content !== undefined || data.title !== undefined || data.importance !== undefined || data.status !== undefined || data.supersedes !== undefined || data.tags !== undefined || data.metadata !== undefined || data.is_global !== undefined || data.agent !== undefined || data.role !== undefined || data.completed_at !== undefined,
  { message: "At least one field must be provided for update" }
);

export const MemorySearchSchema = z.object({
  query: z.string().min(3),
  prompt: z.string().optional(),
  repo: z.string().min(1).transform(normalizeRepo),
  types: z.array(MemoryTypeSchema).optional(),
  minImportance: z.number().min(1).max(5).optional(),
  limit: z.number().min(1).max(100).default(5),
  includeRecap: z.boolean().default(false),
  current_file_path: z.string().optional(),
  include_archived: z.boolean().default(false),
  current_tags: z.array(z.string()).optional(),
  scope: MemoryScopeSchema.partial().optional()
});

export const MemoryAcknowledgeSchema = z.object({
  memory_id: z.string().uuid(),
  status: z.enum(["used", "irrelevant", "contradictory"]),
  application_context: z.string().min(10).optional()
});

export const MemoryRecapSchema = z.object({
  repo: z.string().min(1).transform(normalizeRepo),
  limit: z.number().min(1).max(50).default(20),
  offset: z.number().min(0).default(0)
});

export const MemoryBulkDeleteSchema = z.object({
  repo: z.string().min(1).transform(normalizeRepo),
  ids: z.array(z.string().uuid()).min(1)
});

export const MemorySummarizeSchema = z.object({
  repo: z.string().min(1).transform(normalizeRepo),
  signals: z.array(z.string().max(200)).min(1)
});

export const MemorySynthesizeSchema = z.object({
  repo: z.string().min(1).transform(normalizeRepo).optional(),
  objective: z.string().min(5),
  current_file_path: z.string().optional(),
  include_summary: z.boolean().default(true),
  include_tasks: z.boolean().default(true),
  use_tools: z.boolean().default(true),
  max_iterations: z.number().int().min(1).max(5).default(3),
  max_tokens: z.number().int().min(128).max(4000).default(1200)
});

export const TaskStatusSchema = z.enum(["backlog", "pending", "in_progress", "completed", "canceled", "blocked"]);
export const TaskPrioritySchema = z.number().min(1).max(5);

export const TaskCreateSchema = z.object({
  repo: z.string().min(1).transform(normalizeRepo),
  task_code: z.string().min(1),
  phase: z.string().min(1),
  title: z.string().min(3).max(100),
  description: z.string().min(1),
  status: TaskStatusSchema.default("backlog"),
  priority: TaskPrioritySchema.default(3),
  agent: z.string().optional(),
  role: z.string().optional(),
  doc_path: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  parent_id: z.string().uuid().optional(),
  depends_on: z.string().uuid().optional(),
  est_tokens: z.number().int().min(0).optional()
});

export const TaskCreateInteractiveSchema = TaskCreateSchema.partial().extend({
  repo: z.string().min(1).transform(normalizeRepo).optional(),
});

export const TaskUpdateSchema = z.object({
  repo: z.string().min(1).transform(normalizeRepo),
  id: z.string().uuid(),
  task_code: z.string().optional(),
  phase: z.string().optional(),
  title: z.string().min(3).max(100).optional(),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  agent: z.string().min(1, "agent name is required").optional(),
  role: z.string().min(1, "agent role is required").optional(),
  model: z.string().optional(),
  comment: z.string().min(1).optional(),
  doc_path: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  parent_id: z.string().uuid().optional(),
  depends_on: z.string().uuid().optional(),
  est_tokens: z.number().int().min(0).optional()
}).refine(
  (data) => Object.keys(data).length > 2,
  { message: "At least one field besides repo and id must be provided for update" }
);

export const TaskListSchema = z.object({
  repo: z.string().min(1).transform(normalizeRepo),
  status: z.string().optional(),
  phase: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).default(15),
  offset: z.number().min(0).default(0)
});

export const TaskSearchSchema = z.object({
  repo: z.string().min(1).transform(normalizeRepo),
  query: z.string().min(1),
  status: z.string().optional(),
  limit: z.number().min(1).max(100).default(10),
  offset: z.number().min(0).default(0)
});

export const TaskBulkManageSchema = z.object({
  action: z.enum(["bulk_create", "bulk_delete", "bulk_update"]),
  repo: z.string().min(1).transform(normalizeRepo),
  tasks: z.array(z.object({
    task_code: z.string().min(1),
    phase: z.string().min(1),
    title: z.string().min(3).max(100),
    description: z.string().min(1),
    status: z.enum(["backlog", "pending"]).default("backlog"),
    priority: TaskPrioritySchema.optional(),
    agent: z.string().optional(),
    role: z.string().optional(),
    doc_path: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    parent_id: z.string().uuid().optional(),
    depends_on: z.string().uuid().optional(),
    est_tokens: z.number().int().min(0).optional()
  })).min(1).optional(),
  ids: z.array(z.string().uuid()).min(1).optional(),
  updates: z.object({
    status: TaskStatusSchema.optional(),
    comment: z.string().optional(),
    est_tokens: z.number().optional()
  }).optional()
}).refine(
  (data) => (data.action === "bulk_create" && data.tasks) || (data.action === "bulk_delete" && data.ids) || (data.action === "bulk_update" && data.ids && data.updates),
  { message: "tasks is required for bulk_create, ids is required for bulk_delete or bulk_update, updates is required for bulk_update" }
);

export const TaskDeleteSchema = z.object({
  repo: z.string().min(1).transform(normalizeRepo),
  id: z.string().uuid()
});

export const TaskActiveSchema = z.object({
  repo: z.string().min(1).transform(normalizeRepo),
  status: z.enum(["in_progress", "pending"]).optional(),
  limit: z.number().min(1).max(20).default(5)
});

// Tool definitions for MCP
export const TOOL_DEFINITIONS = [
  {
    name: "memory-synthesize",
    title: "Memory Synthesize",
    description: "Use client sampling to synthesize a grounded answer from local memory and tasks. Best for project briefings, tradeoff summaries, and context-aware answers.",
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
        repo: { type: "string", description: "Repository name. Optional when a single MCP root is active." },
        objective: { type: "string", minLength: 5, description: "Question or synthesis objective." },
        current_file_path: { type: "string", description: "Optional absolute file path for workspace-local grounding." },
        include_summary: { type: "boolean", default: true },
        include_tasks: { type: "boolean", default: true },
        use_tools: { type: "boolean", default: true, description: "Allow the sampled model to call local memory/task tools during synthesis when the client supports sampling.tools." },
        max_iterations: { type: "number", minimum: 1, maximum: 5, default: 3 },
        max_tokens: { type: "number", minimum: 128, maximum: 4000, default: 1200 }
      },
      required: ["objective"]
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
    name: "task-create-interactive",
    title: "Interactive Task Create",
    description: "Create a task with MCP elicitation fallback for any missing required fields. Best when an agent knows a task is needed but still needs user confirmation for repo, title, or phase.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name. Optional when it can be inferred from MCP roots or elicited from the user." },
        task_code: { type: "string" },
        phase: { type: "string" },
        title: { type: "string", minLength: 3, maxLength: 100 },
        description: { type: "string", minLength: 1 },
        status: { type: "string", enum: ["backlog", "pending"], default: "backlog" },
        priority: { type: "number", minimum: 1, maximum: 5, default: 3 },
        agent: { type: "string" },
        role: { type: "string" },
        doc_path: { type: "string" }
      }
    },
    outputSchema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        task_code: { type: "string" },
        phase: { type: "string" },
        title: { type: "string" },
        status: { type: "string" },
        priority: { type: "number" }
      },
      required: ["repo", "task_code", "phase", "title", "status", "priority"]
    }
  },
  {
    name: "memory-store",
    title: "Memory Store",
    description: "Store a new memory entry. Keep 'title' concise and human-readable; do not embed agent/role/date metadata in the title. Put auxiliary context into 'metadata'. Use 'tags' for tech-stack and 'is_global' for universal rules.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["code_fact", "decision", "mistake", "pattern", "agent_handoff", "agent_registered", "file_claim", "task_archive"],
          description: "Type of memory being stored"
        },
        title: {
          type: "string",
          minLength: 3,
          maxLength: 100,
          description: "Short human-readable title for the memory. Do not embed bracketed metadata like agent/role/date prefixes here."
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
            repo: { type: "string", description: "Repository name" },
            branch: { type: "string" },
            folder: { type: "string" },
            language: { type: "string" }
          },
          required: ["repo"]
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Technology stack tags (e.g., ['filament', 'laravel'])"
        },
        metadata: {
          type: "object",
          description: "Structured metadata for non-title context such as source agent, claim fields, or timestamps"
        },
        is_global: {
          type: "boolean",
          description: "If true, this memory is shared across all repositories"
        },
        ttlDays: { type: "number", minimum: 1 },
        supersedes: { type: "string", format: "uuid" }
      },
      required: ["type", "title", "content", "importance", "scope", "agent", "model"]
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        id: { type: "string" },
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
    description: "Acknowledge the use of a memory or report its irrelevance/contradiction. Mandatory after using memory to generate code.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string", format: "uuid" },
        status: { type: "string", enum: ["used", "irrelevant", "contradictory"] },
        application_context: { type: "string", minLength: 10 }
      },
      required: ["memory_id", "status"]
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
    description: "Update an existing memory entry. Keep 'title' concise and move agent/role/date or claim context into 'metadata' instead of the title.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        type: { type: "string", enum: ["code_fact", "decision", "mistake", "pattern", "agent_handoff", "agent_registered", "file_claim", "task_archive"] },
        title: { type: "string", minLength: 3, maxLength: 100 },
        content: { type: "string", minLength: 10 },
        importance: { type: "number", minimum: 1, maximum: 5 },
        agent: { type: "string" },
        role: { type: "string" },
        status: { type: "string", enum: ["active", "archived"] },
        supersedes: { type: "string", format: "uuid" },
        tags: { type: "array", items: { type: "string" } },
        metadata: { type: "object" },
        is_global: { type: "boolean" },
        completed_at: { type: "string" }
      },
      required: ["id"]
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        id: { type: "string" },
        repo: { type: "string" },
        updatedFields: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["success", "id", "repo", "updatedFields"]
    }
  },
  {
    name: "memory-search",
    title: "Memory Search",
    description: "Search for relevant memories. Use 'current_tags' to find tech-stack specific knowledge from other projects.",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 3 },
        prompt: { type: "string" },
        repo: { type: "string" },
        current_tags: {
          type: "array",
          items: { type: "string" },
          description: "Active tech stack tags (e.g., ['filament', 'react'])"
        },
        types: {
          type: "array",
          items: { type: "string", enum: ["code_fact", "decision", "mistake", "pattern", "agent_handoff", "agent_registered", "file_claim", "task_archive"] }
        },
        minImportance: { type: "number", minimum: 1, maximum: 5 },
        limit: { type: "number", minimum: 1, maximum: 100, default: 5 },
        includeRecap: { type: "boolean", default: false },
        current_file_path: { type: "string" },
        include_archived: { type: "boolean", default: false }
        ,
        scope: {
          type: "object",
          properties: {
            repo: { type: "string" },
            branch: { type: "string" },
            folder: { type: "string" },
            language: { type: "string" }
          }
        }
      },
      required: ["query", "repo"]
    },
    outputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        recapContext: { type: "string" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string" },
              title: { type: "string" },
              content: { type: "string" },
              importance: { type: "number" }
            },
            required: ["id", "type", "content", "importance"]
          }
        }
      },
      required: ["query", "results"]
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
        repo: { type: "string", description: "Repository name" },
        signals: {
          type: "array",
          items: { type: "string", maxLength: 200 },
          minItems: 1,
          description: "High-level signals to include in summary"
        }
      },
      required: ["repo", "signals"]
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
    description: "Soft-delete a memory entry (remove from active use)",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid", description: "Memory entry ID to delete" }
      },
      required: ["id"]
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        id: { type: "string" },
        repo: { type: "string" }
      },
      required: ["success", "id", "repo"]
    }
  },
  {
    name: "memory-bulk-delete",
    title: "Memory Bulk Delete",
    description: "Delete multiple memory entries at once.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name" },
        ids: { type: "array", items: { type: "string", format: "uuid" }, minItems: 1, description: "Array of memory IDs to delete" }
      },
      required: ["repo", "ids"]
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        repo: { type: "string" },
        deletedCount: { type: "number" },
        ids: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["success", "repo", "deletedCount", "ids"]
    }
  },
  {
    name: "memory-recap",
    title: "Memory Recap",
    description: "Get the last 20 memories from a repository for context",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name (required)" },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 50,
          default: 20,
          description: "Maximum number of memories to retrieve"
        },
        offset: {
          type: "number",
          minimum: 0,
          default: 0,
          description: "Number of memories to skip for pagination (optional, default 0)"
        }
      },
      required: ["repo"]
    },
    outputSchema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        count: { type: "number" },
        total: { type: "number" },
        offset: { type: "number" },
        summary: { type: "string" },
        memories: {
          type: "array",
          items: {
            type: "object",
            properties: {
              number: { type: "number" },
              id: { type: "string" },
              type: { type: "string" },
              importance: { type: "number" },
              preview: { type: "string" },
              created_at: { type: "string" }
            },
            required: ["number", "id", "type", "importance", "preview", "created_at"]
          }
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              task_code: { type: "string" },
              title: { type: "string" },
              status: { type: "string" },
              priority: { type: "number" }
            },
            required: ["id", "task_code", "title", "status", "priority"]
          }
        }
      },
      required: ["repo", "count", "total", "offset", "memories", "tasks", "summary"]
    }
  },
  {
    name: "task-create",
    title: "Task Create",
    description: "Create a new task in a repository. task_code must be unique within the repository. 'est_tokens' is optional during planning/creation.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name" },
        task_code: { type: "string", description: "Unique task code (e.g. TASK-001)" },
        phase: { type: "string", description: "Project phase" },
        title: { type: "string", minLength: 3, maxLength: 100 },
        description: { type: "string" },
        status: { type: "string", enum: ["backlog", "pending"], description: "New tasks MUST start in 'backlog' if there are already 10 pending tasks. Otherwise can start in 'pending'." },
        priority: { type: "number", minimum: 1, maximum: 5, default: 3 },
        agent: { type: "string" },
        role: { type: "string" },
        doc_path: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        metadata: { type: "object" },
        parent_id: { type: "string", format: "uuid" },
        depends_on: { type: "string", format: "uuid" },
        est_tokens: { type: "number", minimum: 0, description: "Estimated tokens budget for this task" }
      },
      required: ["repo", "task_code", "phase", "title", "description", "status"]
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        id: { type: "string" },
        repo: { type: "string" },
        task_code: { type: "string" },
        phase: { type: "string" },
        title: { type: "string" },
        status: { type: "string" },
        priority: { type: "number" }
      },
      required: ["success", "id", "repo", "task_code", "phase", "title", "status", "priority"]
    }
  },
  {
    name: "task-update",
    title: "Task Update",
    description: "Update an existing task. Provide only the fields that need to be changed. MANDATORY WORKFLOW: You cannot move a task from 'pending' or 'blocked' directly to 'completed'. You MUST move it to 'in_progress' first. When changing status to 'completed', include 'est_tokens' with the estimated total tokens actually used for the task.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name" },
        id: { type: "string", format: "uuid", description: "Task ID" },
        task_code: { type: "string" },
        phase: { type: "string" },
        title: { type: "string", minLength: 3, maxLength: 100 },
        description: { type: "string" },
        status: { type: "string", enum: ["backlog", "pending", "in_progress", "completed", "canceled", "blocked"], description: "New status. Transitions from 'backlog', 'pending' or 'blocked' to 'completed' are NOT allowed." },
        priority: { type: "number", minimum: 1, maximum: 5 },
        agent: { type: "string" },
        role: { type: "string" },
        model: { type: "string" },
        comment: { type: "string", description: "REQUIRED when changing task status. Explain WHY the status is changing (e.g., 'Starting implementation', 'Blocked by missing API docs', 'Verified fix')." },
        doc_path: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        metadata: { type: "object" },
        parent_id: { type: "string", format: "uuid" },
        depends_on: { type: "string", format: "uuid" },
        est_tokens: { type: "number", minimum: 0, description: "Estimated total tokens actually used for this task. Required when status changes to 'completed'." }
      },
      required: ["repo", "id"]
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        id: { type: "string" },
        repo: { type: "string" },
        status: { type: "string" },
        archivedToMemory: { type: "boolean" },
        updatedFields: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["success", "id", "repo", "status", "archivedToMemory", "updatedFields"]
    }
  },
  {
    name: "task-delete",
    title: "Task Delete",
    description: "Delete a task from a repository.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name" },
        id: { type: "string", format: "uuid", description: "Task ID" }
      },
      required: ["repo", "id"]
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        id: { type: "string" },
        repo: { type: "string" }
      },
      required: ["success", "id", "repo"]
    }
  },
  {
    name: "task-active",
    title: "Task Active",
    description: "PRIMARY task navigation tool. Call this FIRST at session start. Returns a minimal tabular list of active tasks (id, title, status, priority). Default behavior: returns in_progress tasks; falls back to pending if none exist. Use task://<id> to fetch full task details. AGENTS: call this once, pick ONE task, then fetch task://<id> for full context before starting work.",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository name"
        },
        status: {
          type: "string",
          enum: ["in_progress", "pending"],
          description: "Optional status filter. If omitted: returns in_progress tasks, falls back to pending if none."
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 20,
          default: 5,
          description: "Maximum rows to return (default 5)"
        }
      },
      required: ["repo"]
    },
    outputSchema: {
      type: "object",
      properties: {
        schema: { type: "string", enum: ["task-active"] },
        tasks: {
          type: "object",
          properties: {
            columns: {
              type: "array",
              items: { type: "string" },
              description: "Column names in order: id, task_code, title, status, priority, comments_count"
            },
            rows: {
              type: "array",
              items: { type: "array" },
              description: "Each row: [id, task_code, title, status, priority, comments_count]. Use task://<id> to fetch full task."
            }
          },
          required: ["columns", "rows"]
        },
        count: { type: "number" }
      },
      required: ["schema", "tasks", "count"]
    }
  },
  {
    name: "task-list",
    title: "Task List",
    description: "List or filtered search of tasks for a repository. Returns a compact tabular pointer list. Use 'search' to filter by code, title, or description. Use 'status' (comma-separated) to filter by status (backlog, pending, in_progress, completed, canceled, blocked). Defaults to active tasks. AGENTS: read columns array to interpret rows, then fetch task://<id>.",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository name"
        },
        status: {
          type: "string",
          description: "Filter by status (e.g. 'pending,in_progress' or 'completed'). Defaults to active tasks if omitted."
        },
        phase: {
          type: "string",
          description: "Filter by phase"
        },
        search: {
          type: "string",
          description: "Search query to filter by task code, title, or description"
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          default: 15,
          description: "Maximum number of tasks to return (default 15)"
        },
        offset: {
          type: "number",
          minimum: 0,
          default: 0,
          description: "Offset for pagination"
        }
      },
      required: ["repo"]
    },
    outputSchema: {
      type: "object",
      properties: {
        schema: { type: "string", enum: ["task-list"] },
        tasks: {
          type: "object",
          properties: {
            columns: {
              type: "array",
              items: { type: "string" },
              description: "Column names in order: id, task_code, title, status, priority, comments_count"
            },
            rows: {
              type: "array",
              items: { type: "array" },
              description: "Each row: [id, task_code, title, status, priority, comments_count]. Use task://<id> to fetch full task."
            }
          },
          required: ["columns", "rows"]
        },
        count: { type: "number" },
        offset: { type: "number" }
      },
      required: ["schema", "tasks", "count"]
    }
  },
  {
    name: "task-search",
    title: "Task Search",
    description: "Search tasks by code, title, or description and return a compact tabular pointer list. Use task://<id> to fetch full task details after selecting from results. Defaults to searching all statuses. AGENTS: call once, read columns array to interpret rows, then fetch task://<id>.",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository name"
        },
        query: {
          type: "string",
          description: "Search query (matches task code, title, or description)"
        },
        status: {
          type: "string",
          description: "Optional status filter (comma-separated, e.g. 'pending,in_progress'). Defaults to all statuses if omitted."
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          default: 10,
          description: "Maximum rows to return (default 10)"
        },
        offset: {
          type: "number",
          minimum: 0,
          default: 0,
          description: "Offset for pagination"
        }
      },
      required: ["repo", "query"]
    },
    outputSchema: {
      type: "object",
      properties: {
        schema: { type: "string", enum: ["task-search"] },
        query: { type: "string" },
        tasks: {
          type: "object",
          properties: {
            columns: {
              type: "array",
              items: { type: "string" },
              description: "Column names in order: id, task_code, title, status, priority, comments_count"
            },
            rows: {
              type: "array",
              items: { type: "array" },
              description: "Each row: [id, task_code, title, status, priority, comments_count]. Use task://<id> to fetch full task."
            }
          },
          required: ["columns", "rows"]
        },
        count: { type: "number" },
        offset: { type: "number" }
      },
      required: ["schema", "query", "tasks", "count"]
    }
  },
  {
    name: "task-bulk-manage",
    title: "Task Bulk Manage",
    description: "Perform bulk operations on tasks (e.g., bulk creation, bulk deletion). For bulk_create, 'est_tokens' is optional and can be filled later when the task is completed.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["bulk_create", "bulk_delete", "bulk_update"],
          description: "Action to perform in bulk"
        },
        repo: {
          type: "string",
          description: "Repository name"
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              task_code: { type: "string" },
              phase: { type: "string" },
              title: { type: "string", minLength: 3, maxLength: 100 },
              description: { type: "string" },
              status: { type: "string", enum: ["backlog", "pending"] },
              priority: { type: "number", minimum: 1, maximum: 5 },
              agent: { type: "string" },
              role: { type: "string" },
              doc_path: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              metadata: { type: "object" },
              parent_id: { type: "string", format: "uuid" },
              depends_on: { type: "string", format: "uuid" },
              est_tokens: { type: "number", minimum: 0, description: "Estimated tokens budget for this task" }
            },
            required: ["task_code", "title", "phase", "description", "status"]
          },
          minItems: 1
        },
        ids: {
          type: "array",
          items: { type: "string", format: "uuid" },
          minItems: 1,
          description: "Task IDs to delete or update"
        },
        updates: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["backlog", "pending", "in_progress", "completed", "canceled", "blocked"] },
            comment: { type: "string" },
            est_tokens: { type: "number", minimum: 0 }
          }
        }
      },
      required: ["action", "repo"]
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        action: { type: "string" },
        repo: { type: "string" },
        createdCount: { type: "number" },
        deletedCount: { type: "number" },
        updatedCount: { type: "number" },
        taskCodes: {
          type: "array",
          items: { type: "string" }
        },
        ids: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["success", "action", "repo"]
    }
  }
];
