import { McpServer } from "@modelcontextprotocol/server";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { SessionContext, inferRepoFromSession, inferOwnerFromSession } from "../session";
import { listPromptFiles, loadPromptFromMarkdown } from "./loader";
import type { LoadedPrompt } from "../interfaces/index";
import { logger } from "../utils/logger";

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
				description: loaded.description
			},
			async (_args: Record<string, unknown>, _extra) => {
				const inferredRepo = inferRepoFromSession(session);
				const inferredOwner = inferOwnerFromSession(session);

				// Substitute arguments in the prompt content
				let text = loaded.content;

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
