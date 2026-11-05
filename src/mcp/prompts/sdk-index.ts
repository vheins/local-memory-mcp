import { McpServer } from "@modelcontextprotocol/server";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { SessionContext, inferRepoFromSession, inferOwnerFromSession } from "../session";
import { listPromptFiles, loadPromptFromMarkdown } from "./loader";
import { substitutePromptArgs } from "./substitution";
import type { LoadedPrompt } from "../interfaces";
import { logger } from "../utils/logger";
import { z } from "zod";

/**
 * Builds the description advertised by the SDK's prompts/list handler.
 *
 * Appends the frontmatter argument definitions so clients can discover each
 * prompt's arguments directly from the description text.
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
 * Builds the Standard Schema registered with `registerPrompt` from the prompt's
 * frontmatter argument definitions.
 *
 * SDK 2.3.0 forwards prompt arguments to the callback only when an `argsSchema`
 * is present; without one the callback receives just the server context. The
 * schema is loose so undeclared keys still reach `substitutePromptArgs`,
 * preserving pre-2.3.0 substitution behavior.
 */
function buildPromptArgsSchema(loaded: LoadedPrompt) {
	const shape = Object.fromEntries(
		loaded.arguments.map((arg) => {
			const argName = String(arg.name ?? "");
			const field = z.string();
			return [argName, arg.required === true ? field : field.optional()];
		})
	);
	return z.looseObject(shape);
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
 * Argument definitions from prompt frontmatter are registered as an
 * `argsSchema` so SDK 2.3.0 forwards them to the callback, and are also
 * surfaced via the `description` field. Completions for prompt arguments
 * (e.g. task_id) continue to work via the old completion handler in
 * completion.ts.
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

		// Register prompt with an argsSchema derived from the frontmatter
		// arguments; SDK 2.3.0 only forwards arguments to the callback when
		// a schema is present. Arguments are also documented in the
		// description for discovery.
		server.registerPrompt(
			loaded.name,
			{
				title: loaded.name,
				description: buildPromptDescription(loaded),
				argsSchema: buildPromptArgsSchema(loaded)
			},
			async (args: Record<string, unknown>) => {
				// Substitute arguments (shared helper — reserved context keys are
				// never honored from args), then auto-inject session context.
				const stringArgs = Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)]));
				const text = substitutePromptArgs(loaded.content, stringArgs, {
					owner: inferOwnerFromSession(session) || "unknown-owner",
					repo: inferRepoFromSession(session) || "unknown-repo"
				});

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
