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
  data?: any;
  structuredContent?: unknown;
};

export function createMcpResponse(
  data: unknown,
  summary: string,
  options?: { 
    query?: string; 
    results?: Array<{ 
      id: string; 
      type: string; 
      title?: string; 
      content: string;
      importance?: number;
      scope?: { repo: string; folder?: string; language?: string };
      created_at?: string;
      updated_at?: string;
      hit_count?: number;
      recall_count?: number;
      last_used_at?: string | null;
      expires_at?: string | null;
    }>;
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
  const { query, results, resourceLinks } = options || {};
  
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

  // Add resource link and embedded content for each result
  if (results && results.length > 0) {
    for (const result of results) {
      // Generate title from content if not present
      const title = result.title || (result.content.length > 50 ? result.content.substring(0, 50) + "..." : result.content);
      const annotations = {
        audience: ["assistant" as const],
        priority: 0.8,
        lastModified: result.updated_at || result.created_at,
      };

      content.push({
        type: "resource_link",
        uri: `memory://${result.id}`,
        name: title,
        description: `Memory ${result.type} in repo ${result.scope?.repo ?? "unknown"}`,
        mimeType: "application/json",
        annotations,
      });
      
      content.push({
        type: "resource",
        resource: {
          uri: `memory://${result.id}`,
          mimeType: "application/json",
          text: JSON.stringify({
            id: result.id,
            type: result.type,
            title: title,
            content: result.content,
            importance: result.importance,
            scope: result.scope,
            created_at: result.created_at,
            updated_at: result.updated_at,
            hit_count: result.hit_count,
            recall_count: result.recall_count,
            last_used_at: result.last_used_at,
            expires_at: result.expires_at
          }),
          annotations,
        }
      });
    }
  }

  return { 
    content,
    data,
    structuredContent: data,
    isError: false,
  };
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
