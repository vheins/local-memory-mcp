import { McpServer } from "@modelcontextprotocol/server";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { SessionContext, inferRepoFromSession, inferOwnerFromSession } from "../session";
import { listPromptFiles, loadPromptFromMarkdown } from "./loader";
import type { LoadedPrompt } from "../interfaces/index";
import { logger } from "../utils/logger";

/**
 * Builds the description advertised by the SDK's prompts/list handler.
 *
 * argsSchema is omitted (SDK bundles zod/v4 internally, incompatible with
 * the project's zod v3), so the SDK can only surface `description` in
 * prompts/list. Append the frontmatter argument definitions here so clients
 * can discover each prompt's arguments.
 */
function buildPromptDescription(loaded: LoadedPrompt): string {
	let description = loaded.description;

	if (loaded.arguments.length > 0) {
		const argLines = loaded.arguments
			.map((arg) => {
				const name = String(arg.name ?? "");
				const argDescription = arg.description ? String(arg.description) : "";
				const required = arg.required === true ? " (required)" : "";
				return `- ${name}: ${argDescription}${required}`;
			})
			.join("\n");
		description += `\n\nArguments:\n${argLines}`;
	}

	return description;
}

/**
 * Registers all prompts via SDK registerPrompt().
 *
 * Each prompt is defined as a Markdown file in ./definitions/ with
 * frontmatter containing name, description, arguments, and agent metadata.
 *
 * The callback substitutes template variables ({{argName}}) with
 * provided argument values, and auto-injects {{current_repo}} and
 * {{current_owner}} from the session context.
 *
 * Note: argsSchema is omitted because the SDK bundles zod/v4 internally
 * (incompatible with the project's zod v3). Argument definitions from
 * prompt frontmatter are surfaced via the `description` field instead.
 * Completions for prompt arguments (e.g. task_id) continue to work via
 * the old completion handler in completion.ts.
 */
export function registerAllPrompts(
	server: McpServer,
	store: SQLiteStore,
	_vectors: VectorStore,
	session: SessionContext
): void {
	const _db = store;

	// Discover and load all prompt definitions
	const promptNames = listPromptFiles();

	for (const name of promptNames) {
		let loaded: LoadedPrompt;
		try {
			loaded = loadPromptFromMarkdown(name);
		} catch (e) {
			logger.warn(`[prompts] Failed to load prompt ${name}: ${e}`);
			continue;
		}

		// Register prompt without argsSchema (zod/v4 incompatibility).
		// Arguments are documented in the prompt description.
		server.registerPrompt(
			loaded.name,
			{
				title: loaded.name,
				description: buildPromptDescription(loaded)
			},
			async (args: Record<string, unknown>, _extra) => {
				const inferredRepo = inferRepoFromSession(session);
				const inferredOwner = inferOwnerFromSession(session);

				// Substitute arguments in the prompt content
				let text = loaded.content;

				// Standard arguments (mirrors registry.ts getPrompt)
				for (const [key, value] of Object.entries(args)) {
					// Escape regex metacharacters in the arg key so a client-supplied
					// key like "(" or "a.b" can never throw SyntaxError in RegExp.
					const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					text = text.replace(new RegExp(`\\{{${escapedKey}\\}}`, "g"), String(value));
				}

				// Auto-injected context (always present regardless of args)
				text = text.replace(/\{\{current_repo\}\}/g, inferredRepo || "unknown-repo");
				text = text.replace(/\{\{current_owner\}\}/g, inferredOwner || "unknown-owner");

				return {
					description: loaded.description,
					messages: [
						{
							role: "user" as const,
							content: {
								type: "text" as const,
								text
							}
						}
					],
					...(loaded.agent ? { _meta: { agent: loaded.agent } } : {})
				};
			}
		);

		logger.debug(`[prompts] Registered prompt: ${loaded.name}`);
	}
}
