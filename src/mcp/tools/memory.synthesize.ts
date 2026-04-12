import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore } from "../types.js";
import {
	SamplingCreateMessageResult,
	SamplingRequestHandler,
	extractTextFromContent,
	extractToolUses
} from "../sampling.js";
import { SessionContext, inferRepoFromSession } from "../session.js";
import { ElicitationRequestHandler, extractAcceptedElicitationContent } from "../elicitation.js";
import { createMcpResponse, getPrimaryTextContent, McpResponse } from "../utils/mcp-response.js";
import { logger } from "../utils/logger.js";
import { MemorySynthesizeSchema } from "./schemas.js";
import { normalizeRepo } from "../utils/normalize.js";
import { handleMemoryRecap } from "./memory.recap.js";
import { handleMemorySearch } from "./memory.search.js";
import { handleTaskList } from "./task.manage.js";

type SynthesizeOptions = {
	session?: SessionContext;
	sampleMessage?: SamplingRequestHandler;
	elicit?: ElicitationRequestHandler;
};

export async function handleMemorySynthesize(
	params: any,
	db: SQLiteStore,
	vectors: VectorStore,
	options: SynthesizeOptions = {}
): Promise<McpResponse> {
	const validated = MemorySynthesizeSchema.parse(params);
	const session = options.session;

	if (!options.sampleMessage || !session?.supportsSampling) {
		throw new Error("Client does not advertise MCP sampling support");
	}

	const repo = await resolveRepository(validated.repo, session, options.elicit);
	if (!repo) {
		throw new Error("repo is required when repo cannot be inferred from active MCP roots");
	}

	const recap = await handleMemoryRecap({ repo, limit: 8, offset: 0 }, db);
	const recapText = getPrimaryTextContent(recap);
	const summary = validated.include_summary ? db.summaries.getSummary(repo)?.summary : "";

	const taskSnapshot = validated.include_tasks
		? await handleTaskList({ repo, status: "backlog,pending,in_progress,blocked", limit: 15, offset: 0 }, db)
		: null;
	const taskText = taskSnapshot ? getPrimaryTextContent(taskSnapshot) : "";

	const systemPrompt = [
		"You are a repository memory synthesizer.",
		"Answer strictly from grounded MCP context and tool results.",
		"If memory is insufficient, say so explicitly instead of inventing details.",
		"Prefer concise, technical answers with explicit caveats when evidence is incomplete."
	].join(" ");

	const contextBlock = [
		`Repository: ${repo}`,
		validated.current_file_path ? `Current file: ${validated.current_file_path}` : "",
		summary ? `Summary:\n${summary}` : "",
		recapText ? `Recent context:\n${recapText}` : "",
		taskText ? `Active tasks:\n${taskText}` : ""
	]
		.filter(Boolean)
		.join("\n\n");

	const messages: any[] = [
		{
			role: "user",
			content: {
				type: "text",
				text: `Objective: ${validated.objective}\n\nGrounding context:\n${contextBlock || "No additional context provided."}`
			}
		}
	];

	const toolDefinitions = buildSamplingTools(session, validated.use_tools);
	let lastResponse: SamplingCreateMessageResult | null = null;
	let totalToolCalls = 0;
	let iterations = 0;

	while (iterations < validated.max_iterations) {
		iterations += 1;

		const response = await options.sampleMessage({
			messages,
			systemPrompt,
			maxTokens: validated.max_tokens,
			tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
			toolChoice:
				toolDefinitions.length > 0 ? { mode: iterations === validated.max_iterations ? "none" : "auto" } : undefined,
			modelPreferences: {
				intelligencePriority: 0.9,
				speedPriority: 0.4
			}
		});

		lastResponse = response;
		messages.push({
			role: "assistant",
			content: response.content
		});

		const toolUses = extractToolUses(response.content);
		if (toolUses.length === 0) {
			break;
		}

		totalToolCalls += toolUses.length;
		const toolResults = await Promise.all(
			toolUses.map(async (toolUse) => ({
				type: "tool_result" as const,
				toolUseId: toolUse.id,
				content: [
					{
						type: "text" as const,
						text: await executeSamplingTool(toolUse.name, toolUse.input, db, vectors)
					}
				]
			}))
		);

		messages.push({
			role: "user",
			content: toolResults
		});
	}

	const answer = lastResponse ? extractTextFromContent(lastResponse.content).trim() : "";
	if (!answer) {
		throw new Error("Sampling did not return a final text answer");
	}

	logger.info("[MCP] memory.synthesize", {
		repo,
		objective: validated.objective,
		iterations,
		toolCalls: totalToolCalls
	});

	return createMcpResponse(
		{
			repo,
			objective: validated.objective,
			answer,
			model: lastResponse?.model,
			stopReason: lastResponse?.stopReason,
			iterations,
			toolCalls: totalToolCalls
		},
		`Synthesized answer for "${validated.objective}" using repository "${repo}".`,
		{
			structuredContentPathHint: "answer"
		}
	);
}

async function resolveRepository(
	repo: string | undefined,
	session: SessionContext | undefined,
	elicit: ElicitationRequestHandler | undefined
) {
	if (repo) return normalizeRepo(repo);

	const inferredRepo = inferRepoFromSession(session);
	if (inferredRepo) return normalizeRepo(inferredRepo);

	if (!session?.supportsElicitationForm || !elicit) {
		return undefined;
	}

	const elicited = extractAcceptedElicitationContent(
		await elicit({
			mode: "form",
			message: "Repository tidak bisa diinfer dari roots aktif. Pilih repository yang ingin disintesis.",
			requestedSchema: {
				type: "object",
				properties: {
					repo: {
						type: "string",
						title: "Repository",
						description: "Nama repository yang akan dipakai untuk sintesis memori.",
						minLength: 1
					}
				},
				required: ["repo"]
			}
		})
	);

	return typeof elicited.repo === "string" && elicited.repo.trim() ? normalizeRepo(elicited.repo.trim()) : undefined;
}

function buildSamplingTools(session: SessionContext | undefined, useTools: boolean) {
	if (!useTools || !session?.supportsSamplingTools) {
		return [];
	}

	return [
		{
			name: "memory_search",
			description: "Search local repository memories for relevant context.",
			inputSchema: {
				type: "object",
				properties: {
					repo: { type: "string" },
					query: { type: "string" },
					limit: { type: "number", minimum: 1, maximum: 10 }
				},
				required: ["repo", "query"]
			}
		},
		{
			name: "memory_recap",
			description: "Fetch a recap of the most recent memories and active tasks.",
			inputSchema: {
				type: "object",
				properties: {
					repo: { type: "string" },
					limit: { type: "number", minimum: 1, maximum: 20 }
				},
				required: ["repo"]
			}
		},
		{
			name: "task_list",
			description: "List tasks by status or search term for the repository.",
			inputSchema: {
				type: "object",
				properties: {
					repo: { type: "string" },
					status: { type: "string" },
					search: { type: "string" },
					limit: { type: "number", minimum: 1, maximum: 20 }
				},
				required: ["repo"]
			}
		}
	];
}

async function executeSamplingTool(
	toolName: string,
	rawInput: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
) {
	switch (toolName) {
		case "memory_search": {
			const response = await handleMemorySearch(
				{
					repo: rawInput.repo,
					query: rawInput.query,
					limit: rawInput.limit ?? 5
				},
				db,
				vectors
			);
			return getPrimaryTextContent(response);
		}

		case "memory_recap": {
			const response = await handleMemoryRecap(
				{
					repo: rawInput.repo,
					limit: rawInput.limit ?? 8,
					offset: 0
				},
				db
			);
			return getPrimaryTextContent(response);
		}

		case "task_list": {
			const response = await handleTaskList(
				{
					repo: rawInput.repo,
					status: rawInput.status,
					search: rawInput.search,
					limit: rawInput.limit ?? 10,
					offset: 0
				},
				db
			);
			return getPrimaryTextContent(response);
		}

		default:
			throw new Error(`Unsupported sampling tool: ${toolName}`);
	}
}

function formatContentForToolResult(content: any) {
	if (content.type === "text") return content.text;
	if (content.type === "resource") return JSON.stringify(content.resource);
	return JSON.stringify(content);
}
