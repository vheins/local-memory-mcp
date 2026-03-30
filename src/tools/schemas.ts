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
  title: z.string().min(3).max(100),
  content: z.string().min(10),
  importance: z.number().min(1).max(5),
  scope: MemoryScopeSchema,
  ttlDays: z.number().min(1).optional(),
  supersedes: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  is_global: z.boolean().default(false)
});

export const MemoryUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(3).max(100).optional(),
  content: z.string().min(10).optional(),
  importance: z.number().min(1).max(5).optional(),
  status: z.enum(["active", "archived"]).optional(),
  supersedes: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  is_global: z.boolean().optional()
}).refine(
  (data) => data.content !== undefined || data.title !== undefined || data.importance !== undefined || data.status !== undefined || data.supersedes !== undefined || data.tags !== undefined || data.is_global !== undefined,
  { message: "At least one field must be provided for update" }
);

export const MemorySearchSchema = z.object({
  query: z.string().min(3),
  prompt: z.string().optional(),
  repo: z.string().min(1),
  types: z.array(MemoryTypeSchema).optional(),
  minImportance: z.number().min(1).max(5).optional(),
  limit: z.number().min(1).max(10).default(5),
  includeRecap: z.boolean().default(false),
  current_file_path: z.string().optional(),
  include_archived: z.boolean().default(false),
  current_tags: z.array(z.string()).optional()
});

export const MemoryAcknowledgeSchema = z.object({
  memory_id: z.string().uuid(),
  status: z.enum(["used", "irrelevant", "contradictory"]),
  application_context: z.string().min(10).optional()
});

export const MemoryRecapSchema = z.object({
  repo: z.string().min(1),
  limit: z.number().min(1).max(50).default(20),
  offset: z.number().min(0).default(0)
});

export const MemorySummarizeSchema = z.object({
  repo: z.string().min(1),
  signals: z.array(z.string().max(200)).min(1)
});

// Tool definitions for MCP
export const TOOL_DEFINITIONS = [
  {
    name: "memory-store",
    description: "Store a new memory entry. Use 'tags' for tech-stack (e.g., ['filament', 'vue']) and 'is_global' for universal rules.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["code_fact", "decision", "mistake", "pattern"],
          description: "Type of memory being stored"
        },
        title: {
          type: "string",
          minLength: 3,
          maxLength: 100,
          description: "Short title for the memory"
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
        is_global: {
          type: "boolean",
          description: "If true, this memory is shared across all repositories"
        },
        ttlDays: { type: "number", minimum: 1 },
        supersedes: { type: "string", format: "uuid" }
      },
      required: ["type", "title", "content", "importance", "scope"]
    }
  },
  {
    name: "memory-acknowledge",
    description: "Acknowledge the use of a memory or report its irrelevance/contradiction. Mandatory after using memory to generate code.",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string", format: "uuid" },
        status: { type: "string", enum: ["used", "irrelevant", "contradictory"] },
        application_context: { type: "string", minLength: 10 }
      },
      required: ["memory_id", "status"]
    }
  },
  {
    name: "memory-update",
    description: "Update an existing memory entry",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        title: { type: "string", minLength: 3, maxLength: 100 },
        content: { type: "string", minLength: 10 },
        importance: { type: "number", minimum: 1, maximum: 5 },
        status: { type: "string", enum: ["active", "archived"] },
        supersedes: { type: "string", format: "uuid" },
        tags: { type: "array", items: { type: "string" } },
        is_global: { type: "boolean" }
      },
      required: ["id"]
    }
  },
  {
    name: "memory-search",
    description: "Search for relevant memories. Use 'current_tags' to find tech-stack specific knowledge from other projects.",
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
          items: { type: "string", enum: ["code_fact", "decision", "mistake", "pattern"] }
        },
        minImportance: { type: "number", minimum: 1, maximum: 5 },
        limit: { type: "number", minimum: 1, maximum: 10, default: 5 },
        includeRecap: { type: "boolean", default: false },
        current_file_path: { type: "string" },
        include_archived: { type: "boolean", default: false }
      },
      required: ["query", "repo"]
    }
  },
  {
    name: "memory-summarize",
    description: "Update the summary for a repository",
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
    }
  },
  {
    name: "memory-delete",
    description: "Soft-delete a memory entry (remove from active use)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid", description: "Memory entry ID to delete" }
      },
      required: ["id"]
    }
  },
  {
    name: "memory-recap",
    description: "Get the last 20 memories from a repository for context",
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
    }
  }
];
