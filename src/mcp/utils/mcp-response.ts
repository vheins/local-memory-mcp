import { z } from "zod";

const McpAnnotationsSchema = z.object({
  audience: z.array(z.enum(["user", "assistant"])).optional(),
  priority: z.number().min(0).max(1).optional(),
  lastModified: z.string().optional(),
}).strict().optional();

export const McpContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    annotations: McpAnnotationsSchema,
  }),
  z.object({
    type: z.literal("image"),
    data: z.string(),
    mimeType: z.string(),
    annotations: McpAnnotationsSchema,
  }),
  z.object({
    type: z.literal("resource_link"),
    uri: z.string(),
    name: z.string(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    annotations: McpAnnotationsSchema,
  }),
  z.object({
    type: z.literal("resource"),
    resource: z.object({
      uri: z.string(),
      mimeType: z.string().optional(),
      text: z.string().optional(),
      annotations: McpAnnotationsSchema,
    }),
  }),
]);

export type McpContent = z.infer<typeof McpContentSchema>;

export type McpResponse = {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: unknown;
};

export function createMcpResponse(
  data: any,
  summary: string,
  options?: { 
    query?: string; 
    results?: any[];
    resourceLinks?: Array<{
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
      annotations?: {
        audience?: Array<"user" | "assistant">;
        priority?: number;
        lastModified?: string;
      };
    }>;
  }
): McpResponse {
  const { results, resourceLinks } = options || {};
  
  const content: McpContent[] = [
    {
      type: "text",
      text: summary,
      annotations: {
        audience: ["user", "assistant"],
        priority: 1,
      },
    },
  ];

  // Add global resource links (like repo index)
  for (const link of resourceLinks || []) {
    content.push({
      type: "resource_link",
      uri: link.uri,
      name: link.name,
      description: link.description,
      mimeType: link.mimeType,
      annotations: link.annotations,
    });
  }

  // Pruning logic to save tokens for the agent
  let finalData = data;
  if (data && typeof data === 'object') {
    // Clone to avoid mutation
    finalData = JSON.parse(JSON.stringify(data));
    
    // Prune known memory/task arrays if found in the data structure
    const arrayKeys = ['results', 'tasks', 'memories', 'items'];
    let foundArray = false;
    
    for (const key of arrayKeys) {
      if (Array.isArray(finalData[key])) {
        finalData[key] = finalData[key].map((item: any) => pruneMetadata(item));
        foundArray = true;
      }
    }
    
    // If it's a direct array, prune it
    if (Array.isArray(finalData)) {
      finalData = finalData.map((item: any) => pruneMetadata(item));
    } else if (!foundArray) {
      // If it's just an object (like a single memory), prune it
      finalData = pruneMetadata(finalData);
    }
  }

  // Add resource_links for results if they were provided in options
  // (We use this for referring to specific items regardless of data pruning)
  if (Array.isArray(results) && results.length > 0) {
    for (const result of results) {
      const title = result.title || (result.content.length > 50 ? result.content.substring(0, 50) + "..." : result.content);
      content.push({
        type: "resource_link",
        uri: `memory://${result.id}`,
        name: title,
        description: `Memory ${result.type} in repo ${result.scope?.repo ?? "unknown"}`,
        mimeType: "application/json",
        annotations: {
          audience: ["assistant"],
          priority: 0.8,
          lastModified: result.updated_at || result.created_at,
        },
      });
    }
  }

  return { 
    content,
    structuredContent: finalData,
    isError: false,
  };
}

/**
 * Prunes redundant or operational metadata from memory/task objects to save tokens.
 */
function pruneMetadata(item: any): any {
  if (!item || typeof item !== 'object') return item;

  // Deep clone to avoid mutating original objects (simple but safe for this context)
  const pruned = { ...item };

  // Common operational fields to remove from agent context
  const toRemove = [
    'hit_count',
    'recall_count',
    'last_used_at',
    'expires_at',
    'agent',
    'role',
    'model',
    'recall_rate',
    'vector_version',
    'similarity' // Similarity is useful but adds noise if many results
  ];

  for (const field of toRemove) {
    delete pruned[field];
  }

  // If it's a memory, prune scope slightly if redundant? 
  // No, keep scope as it defines the repo/context.

  return pruned;
}

export function createTextOnlyResponse(text: string): McpResponse {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    structuredContent: { text },
    isError: false,
  };
}

export function isMcpResponse(obj: unknown): obj is McpResponse {
  if (typeof obj !== "object" || obj === null) return false;
  const response = obj as Record<string, unknown>;
  if (!Array.isArray(response.content)) return false;
  return response.content.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      typeof item.type === "string"
  );
}
