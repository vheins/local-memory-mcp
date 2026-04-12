import { SQLiteStore } from "../storage/sqlite";
import { SessionContext, inferRepoFromSession } from "../session";
import { rankCompletionValues } from "../utils/completion";
import { loadPromptFromMarkdown, listPromptFiles } from "./loader";
import type { LoadedPrompt } from "../interfaces";
import { decodeCursor, encodeCursor } from "../utils/pagination";

function createPromptDefinition(loaded: LoadedPrompt) {
	return {
		name: loaded.name,
		description: loaded.description,
		arguments: loaded.arguments,
		agent: loaded.agent,
		messages: [
			{
				role: "user",
				content: {
					type: "text",
					text: loaded.content
				}
			}
		]
	};
}

interface PromptMessage {
	role: "user" | "assistant";
	content: {
		type: "text";
		text: string;
	};
}

interface PromptDefinition {
	name: string;
	description: string;
	arguments: Record<string, unknown>[];
	agent?: string;
	messages: PromptMessage[];
}

export const PROMPTS: Record<string, PromptDefinition> = {};

// Dynamically discover and load all prompts from the definitions directory
const promptFiles = listPromptFiles();
for (const name of promptFiles) {
	try {
		PROMPTS[name] = createPromptDefinition(loadPromptFromMarkdown(name));
	} catch (e) {
		console.warn(`Failed to load prompt ${name}: ${e}`);
	}
}

/**
 * Handles MCP 'prompts/list'
 */
export async function listPrompts(
	db: SQLiteStore,
	session?: SessionContext,
	params?: { cursor?: string; limit?: number }
) {
	const allPrompts = Object.values(PROMPTS).map((p) => ({
		name: p.name,
		description: p.description,
		arguments: p.arguments,
		metadata: p.agent ? { agent: p.agent } : undefined
	}));

	const rawLimit = typeof params?.limit === "number" && Number.isInteger(params?.limit) ? params.limit : 25;
	const limit = Math.max(1, Math.min(100, Math.trunc(rawLimit)));
	const offset = decodeCursor(params?.cursor);
	const sliced = allPrompts.slice(offset, offset + limit);
	const nextOffset = offset + sliced.length;

	return {
		prompts: sliced,
		nextCursor: nextOffset < allPrompts.length ? encodeCursor(nextOffset) : undefined
	};
}

/**
 * Handles MCP 'prompts/get'
 */
export async function getPrompt(
	name: string,
	args: Record<string, string> = {},
	db: SQLiteStore,
	session?: SessionContext
) {
	const prompt = PROMPTS[name];
	if (!prompt) {
		throw new Error(`Prompt not found: ${name}`);
	}

	const inferredRepo = inferRepoFromSession(session);

	// Substitute arguments in messages
	const messages = prompt.messages.map((m: PromptMessage) => {
		let text = m.content.text;

		// Standard arguments
		for (const [key, value] of Object.entries(args)) {
			text = text.replace(new RegExp(`\\{{${key}\\}}`, "g"), value);
		}

		// Auto-injected context
		text = text.replace(/{{current_repo}}/g, inferredRepo || "unknown-repo");

		return {
			...m,
			content: {
				...m.content,
				text
			}
		};
	});

	return {
		description: prompt.description,
		messages,
		metadata: prompt.agent ? { agent: prompt.agent } : undefined
	};
}

/**
 * Handles completion for MCP 'prompts/get' arguments
 */
export async function completePromptArgument(
	name: string,
	argName: string,
	value: string,
	contextArguments: Record<string, unknown>,
	dataSources: { tasks: { id: string }[] }
) {
	void name;
	void contextArguments;
	if (argName === "task_id") {
		const values = dataSources.tasks.map((t) => t.id);
		return rankCompletionValues(values, value);
	}

	return [];
}
