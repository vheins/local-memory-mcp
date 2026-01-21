import { z } from "zod";

// Shared schema components
export const MemoryScopeSchema = z.object({
  repo: z.string().min(1),
  branch: z.string().optional(),
  folder: z.string().optional(),
  language: z.string().optional()
});

export const MemoryTypeSchema = z.enum(["code_fact", "decision", "mistake", "pattern"]);

// Tool schemas
export const MemoryStoreSchema = z.object({
  type: MemoryTypeSchema,
  content: z.string().min(10),
  importance: z.number().min(1).max(5),
  scope: MemoryScopeSchema
});

export const MemoryUpdateSchema = z.object({
  id: z.string().uuid(),
  content: z.string().min(10).optional(),
  importance: z.number().min(1).max(5).optional()
}).refine(
  (data) => data.content !== undefined || data.importance !== undefined,
  { message: "At least one of content or importance must be provided" }
);

export const MemorySearchSchema = z.object({
  query: z.string().min(3),
  repo: z.string().min(1),
  types: z.array(MemoryTypeSchema).optional(),
  minImportance: z.number().min(1).max(5).optional(),
  limit: z.number().min(1).max(10).default(5)
});

export const MemorySummarizeSchema = z.object({
  repo: z.string().min(1),
  signals: z.array(z.string().max(200)).min(1)
});

export const MemoryDeleteSchema = z.object({
  id: z.string().uuid()
});

// Tool definitions for MCP
export const TOOL_DEFINITIONS = [
  {
    name: "memory.store",
    description: "Store a new memory entry that affects future behavior",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["code_fact", "decision", "mistake", "pattern"],
          description: "Type of memory being stored"
        },
        content: {
          type: "string",
          minLength: 10,
          description: "The memory content (must be durable knowledge)"
        },
        importance: {
          type: "number",
          minimum: 1,
          maximum: 5,
          description: "Importance score (1-5)"
        },
        scope: {
          type: "object",
          properties: {
            repo: {
              type: "string",
              description: "Repository name (required)"
            },
            branch: {
              type: "string",
              description: "Git branch (optional)"
            },
            folder: {
              type: "string",
              description: "Specific folder path (optional)"
            },
            language: {
              type: "string",
              description: "Programming language (optional)"
            }
          },
          required: ["repo"]
        }
      },
      required: ["type", "content", "importance", "scope"]
    }
  },
  {
    name: "memory.update",
    description: "Update an existing memory entry",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          format: "uuid",
          description: "Memory entry ID"
        },
        content: {
          type: "string",
          minLength: 10,
          description: "Updated content (optional)"
        },
        importance: {
          type: "number",
          minimum: 1,
          maximum: 5,
          description: "Updated importance (optional)"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "memory.search",
    description: "Search for relevant memories in the current repository",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 3,
          description: "Search query"
        },
        repo: {
          type: "string",
          description: "Repository name (required)"
        },
        types: {
          type: "array",
          items: {
            type: "string",
            enum: ["code_fact", "decision", "mistake", "pattern"]
          },
          description: "Filter by memory types (optional)"
        },
        minImportance: {
          type: "number",
          minimum: 1,
          maximum: 5,
          description: "Minimum importance score (optional)"
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 10,
          default: 5,
          description: "Maximum number of results"
        }
      },
      required: ["query", "repo"]
    }
  },
  {
    name: "memory.summarize",
    description: "Update the antigravity summary for a repository",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository name"
        },
        signals: {
          type: "array",
          items: {
            type: "string",
            maxLength: 200
          },
          minItems: 1,
          description: "High-level signals to include in summary"
        }
      },
      required: ["repo", "signals"]
    }
  },
  {
    name: "memory.delete",
    description: "Soft-delete a memory entry (remove from active use)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          format: "uuid",
          description: "Memory entry ID to delete"
        }
      },
      required: ["id"]
    }
  }
];
