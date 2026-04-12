import { z } from "zod";

const McpAnnotationsSchema = z
	.object({
		audience: z.array(z.enum(["user", "assistant"])).optional(),
		priority: z.number().min(0).max(1).optional(),
		lastModified: z.string().optional()
	})
	.strict()
	.optional();

export const McpContentSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("text"),
		text: z.string(),
		annotations: McpAnnotationsSchema
	}),
	z.object({
		type: z.literal("image"),
		data: z.string(),
		mimeType: z.string(),
		annotations: McpAnnotationsSchema
	}),
	z.object({
		type: z.literal("resource_link"),
		uri: z.string(),
		name: z.string(),
		description: z.string().optional(),
		mimeType: z.string().optional(),
		annotations: McpAnnotationsSchema
	}),
	z.object({
		type: z.literal("resource"),
		resource: z.object({
			uri: z.string(),
			mimeType: z.string().optional(),
			text: z.string().optional(),
			annotations: McpAnnotationsSchema
		})
	})
]);

export type McpContent = z.infer<typeof McpContentSchema>;

export type McpResponse = {
	content?: McpContent[];
	isError?: boolean;
	structuredContent?: unknown;
};

export function createMcpResponse(
	data: unknown,
	summary: string,
	options?: {
		query?: string;
		results?: unknown[];
		structuredContentPathHint?: string;
		contentSummary?: string;
		includeSerializedStructuredContent?: false;
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
	const {
		resourceLinks,
		structuredContentPathHint,
		contentSummary,
		includeSerializedStructuredContent = "auto"
	} = options || {};
	// includeSerializedStructuredContent is reserved for future use in protocol negotiation
	void includeSerializedStructuredContent;

	// Pruning logic to save tokens for the agent
	let finalData = data;
	if (data && typeof data === "object") {
		// Clone to avoid mutation
		const cloned = JSON.parse(JSON.stringify(data));
		finalData = cloned;

		// Prune known memory/task arrays if found in the data structure
		const arrayKeys = ["results", "tasks", "memories", "items"];
		let foundArray = false;

		for (const key of arrayKeys) {
			const value = (cloned as Record<string, unknown>)[key];
			if (Array.isArray(value)) {
				(cloned as Record<string, unknown>)[key] = value.map((item: unknown) =>
					pruneMetadata(item as Record<string, unknown>)
				);
				foundArray = true;
			}
		}

		// If it's a direct array, prune it
		if (Array.isArray(cloned)) {
			finalData = cloned.map((item: unknown) => pruneMetadata(item as Record<string, unknown>));
		} else if (!foundArray) {
			// If it's just an object (like a single memory), prune it
			finalData = pruneMetadata(cloned as Record<string, unknown>);
		}
	}

	const content: McpContent[] = [];

	if (contentSummary?.trim().length) {
		content.push({
			type: "text",
			text: contentSummary.trim()
		});
	} else if (summary.trim().length > 0) {
		const pointerText = structuredContentPathHint
			? `Read structuredContent.${structuredContentPathHint} for details.`
			: `Read structuredContent for machine-readable results.`;
		content.push({
			type: "text",
			text: `${summary.trim()} ${pointerText}`
		});
	}

	// Add global resource links (like repo index)
	for (const link of resourceLinks || []) {
		content.push({
			type: "resource_link",
			uri: link.uri,
			name: link.name,
			mimeType: link.mimeType,
			annotations: link.annotations
		});
	}

	const response: McpResponse = {
		structuredContent: finalData,
		isError: false
	};

	response.content = content;

	return response;
}

/**
 * Prunes redundant or operational metadata from memory/task objects to save tokens.
 */
function pruneMetadata(item: Record<string, unknown>): Record<string, unknown> {
	if (!item || typeof item !== "object") return item;

	// Deep clone to avoid mutating original objects (simple but safe for this context)
	const pruned = { ...item };

	// Common operational fields to remove from agent context
	const toRemove = [
		"hit_count",
		"recall_count",
		"last_used_at",
		"expires_at",
		"agent",
		"role",
		"model",
		"recall_rate",
		"vector_version",
		"similarity" // Similarity is useful but adds noise if many results
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
				text
			}
		],
		structuredContent: { text },
		isError: false
	} as McpResponse;
}

export function getPrimaryTextContent(response: McpResponse): string {
	if (!Array.isArray(response.content)) return "";
	const textItem = response.content.find((item) => item.type === "text");
	return textItem?.type === "text" ? textItem.text : "";
}

export function isMcpResponse(obj: unknown): obj is McpResponse {
	if (typeof obj !== "object" || obj === null) return false;
	const response = obj as Record<string, unknown>;
	if (!Array.isArray(response.content)) return false;
	return response.content.every(
		(item) => typeof item === "object" && item !== null && "type" in item && typeof item.type === "string"
	);
}
