import { z } from "zod";

export const McpContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("image"),
    data: z.string(),
    mimeType: z.string(),
  }),
  z.object({
    type: z.literal("resource"),
    resource: z.object({
      uri: z.string(),
      mimeType: z.string().optional(),
      text: z.string().optional(),
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
    }> 
  }
): McpResponse {
  const { query, results } = options || {};
  
  const content: McpContent[] = [
    {
      type: "text",
      text: summary,
    },
  ];

  // Add resource for each result with embedded content
  if (results && results.length > 0) {
    for (const result of results) {
      const resultId = Buffer.from(result.id).toString('base64').substring(0, 8);
      
      // Generate title from content if not present
      const title = result.title || (result.content.length > 50 ? result.content.substring(0, 50) + '...' : result.content);
      
      content.push({
        type: "resource",
        resource: {
          uri: `memory://${resultId}`,
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
          })
        }
      });
    }
  }

  return { 
    content,
    data,
    structuredContent: data
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
