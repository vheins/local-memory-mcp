import { SQLiteStore } from "../storage/sqlite.js";
import { SessionContext } from "../session.js";
import { logger } from "../utils/logger.js";
import { rankCompletionValues } from "../utils/completion.js";
import { decodeCursor, encodeCursor } from "../utils/pagination.js";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export function listResources(session?: SessionContext, params?: { cursor?: string; limit?: number }) {
	const resources = [
		{
			uri: "repository://index",
			name: "Repository Index",
			title: "Repository Index",
			description: "List of all known repositories with memory/task counts and last activity",
			mimeType: "application/json",
			annotations: {
				audience: ["assistant"],
				priority: 1,
				lastModified: new Date().toISOString()
			}
		},
		{
			uri: "session://roots",
			name: "Session Roots",
			title: "Session Roots",
			description: session?.roots.length
				? "Active workspace roots provided by the MCP client"
				: "No active workspace roots were provided by the MCP client",
			mimeType: "application/json",
			size: Buffer.byteLength(JSON.stringify({ roots: session?.roots ?? [] }), "utf8"),
			annotations: {
				audience: ["assistant"],
				priority: 0.95,
				lastModified: new Date().toISOString()
			}
		}
	];

	return paginateEntries("resources", resources, params);
}

export function listResourceTemplates(params?: { cursor?: string; limit?: number }) {
	const templates = [
		// ── Memory ──────────────────────────────────────────────────────────────
		{
			uriTemplate: "repository://{name}/memories",
			name: "Repository Memories",
			title: "Repository Memories",
			description: "All active memory entries for a specific repository",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.85 }
		},
		{
			uriTemplate: "repository://{name}/memories?search={search}&type={type}&tag={tag}",
			name: "Filtered Repository Memories",
			title: "Filtered Repository Memories",
			description: "Filter or search memories within a repository by keyword, type, or tag",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.8 }
		},
		{
			uriTemplate: "memory://{id}",
			name: "Memory Detail",
			title: "Memory Detail",
			description: "Full content and statistics for a specific memory UUID",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.75 }
		},
		// ── Tasks ────────────────────────────────────────────────────────────────
		{
			uriTemplate: "repository://{name}/tasks",
			name: "Repository Tasks",
			title: "Repository Tasks",
			description: "All active tasks for a specific repository",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.9 }
		},
		{
			uriTemplate: "repository://{name}/tasks?status={status}&priority={priority}",
			name: "Filtered Repository Tasks",
			title: "Filtered Repository Tasks",
			description: "Filter tasks within a repository by status or priority level",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.85 }
		},
		{
			uriTemplate: "task://{id}",
			name: "Task Detail",
			title: "Task Detail",
			description: "Full content and comments for a specific task UUID",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.8 }
		},
		// ── Repository extras ────────────────────────────────────────────────────
		{
			uriTemplate: "repository://{name}/summary",
			name: "Repository Summary",
			title: "Repository Summary",
			description: "High-level architectural summary for a repository",
			mimeType: "text/plain",
			annotations: { audience: ["assistant"], priority: 0.95 }
		},
		{
			uriTemplate: "repository://{name}/actions",
			name: "Repository Actions",
			title: "Repository Actions",
			description: "Audit log of agent tool actions scoped to a repository",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.6 }
		},
		// ── Action detail ────────────────────────────────────────────────────────
		{
			uriTemplate: "action://{id}",
			name: "Action Detail",
			title: "Action Detail",
			description: "Full details of a specific audit log entry by integer ID",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.55 }
		}
	];

	return paginateEntries("resourceTemplates", templates, params);
}

export function completeResourceArgument(
	resourceUri: string,
	argumentName: string,
	argumentValue: string,
	_contextArguments: Record<string, unknown>,
	dataSources: {
		repos: string[];
		tags: string[];
	}
) {
	// Repo autocomplete for all repository://{name}/... templates
	if (
		resourceUri === "repository://{name}/memories" ||
		resourceUri === "repository://{name}/memories?search={search}&type={type}&tag={tag}" ||
		resourceUri === "repository://{name}/tasks" ||
		resourceUri === "repository://{name}/tasks?status={status}&priority={priority}" ||
		resourceUri === "repository://{name}/summary" ||
		resourceUri === "repository://{name}/actions"
	) {
		if (argumentName === "name") {
			return rankCompletionValues(dataSources.repos, argumentValue);
		}
	}

	// Tag autocomplete for filtered memories
	if (resourceUri === "repository://{name}/memories?search={search}&type={type}&tag={tag}") {
		if (argumentName === "tag") {
			return rankCompletionValues(dataSources.tags, argumentValue);
		}
	}

	throw invalidCompletionParams(`Unknown resource template or argument: ${resourceUri} (${argumentName})`);
}

export function readResource(uri: string, db: SQLiteStore, session?: SessionContext) {
	logger.info("[MCP] resource.read", { uri });

	// 1. Repository Index
	if (uri === "repository://index") {
		const repos = db.system.listRepoNavigation();
		const payload = JSON.stringify(repos, null, 2);
		return {
			contents: [
				{
					uri,
					mimeType: "application/json",
					text: payload,
					size: Buffer.byteLength(payload, "utf8"),
					annotations: {
						audience: ["assistant"],
						priority: 1,
						lastModified: new Date().toISOString()
					}
				}
			]
		};
	}

	// 2. Session Roots
	if (uri === "session://roots") {
		const payload = JSON.stringify({ roots: session?.roots ?? [] }, null, 2);
		return {
			contents: [
				{
					uri,
					mimeType: "application/json",
					text: payload,
					size: Buffer.byteLength(payload, "utf8"),
					annotations: {
						audience: ["assistant"],
						priority: 0.95,
						lastModified: new Date().toISOString()
					}
				}
			]
		};
	}

	// 3. Memory Detail: memory://{id}
	const memoryIdMatch = uri.match(/^memory:\/\/([0-9a-f-]{36})$/i);
	if (memoryIdMatch) {
		const id = memoryIdMatch[1];
		const entry = db.memories.getByIdWithStats(id);
		if (!entry) throw resourceNotFound(`Memory with ID ${id} not found.`, uri);

		const payload = JSON.stringify(entry, null, 2);
		return {
			contents: [
				{
					uri,
					mimeType: "application/json",
					text: payload,
					size: Buffer.byteLength(payload, "utf8"),
					annotations: {
						audience: ["assistant"],
						priority: 0.75,
						lastModified: entry.updated_at || entry.created_at
					}
				}
			]
		};
	}

	// 4. Task Detail: task://{id}
	const taskIdMatch = uri.match(/^task:\/\/([0-9a-f-]{36})$/i);
	if (taskIdMatch) {
		const id = taskIdMatch[1];
		const task = db.tasks.getTaskById(id);
		if (!task) throw resourceNotFound(`Task with ID ${id} not found.`, uri);

		const payload = JSON.stringify(task, null, 2);
		return {
			contents: [
				{
					uri,
					mimeType: "application/json",
					text: payload,
					size: Buffer.byteLength(payload, "utf8"),
					annotations: {
						audience: ["assistant"],
						priority: 0.8,
						lastModified: task.updated_at || task.created_at
					}
				}
			]
		};
	}

	// 5. Repository-scoped resources: repository://{name}/...
	const repoBase = parseRepoUri(uri);
	if (repoBase) {
		const { name, path: repoPath, query } = repoBase;

		// 5a. Repository Summary: repository://{name}/summary
		if (repoPath === "summary") {
			const summary = db.summaries.getSummary(name);
			const text = summary?.summary || `No summary available for repository: ${name}`;
			return {
				contents: [
					{
						uri,
						mimeType: "text/plain",
						text,
						size: Buffer.byteLength(text, "utf8"),
						annotations: {
							audience: ["assistant"],
							priority: 0.95,
							lastModified: summary?.updated_at || new Date().toISOString()
						}
					}
				]
			};
		}

		// 5b. Repository Memories: repository://{name}/memories[?...]
		if (repoPath === "memories") {
			const search = query.get("search") || "";
			const type = query.get("type");
			const tag = query.get("tag");

			const result = db.memories.listMemoriesForDashboard({
				repo: name,
				type: type || undefined,
				tag: tag || undefined,
				search: search || undefined,
				includeArchived: false,
				limit: 50
			});
			const entries = result.items;

			const payload = JSON.stringify(entries, null, 2);
			return {
				contents: [
					{
						uri,
						mimeType: "application/json",
						text: payload,
						size: Buffer.byteLength(payload, "utf8"),
						annotations: {
							audience: ["assistant"],
							priority: 0.85,
							lastModified: deriveLastModifiedFromCollection(entries.map((e: any) => e.updated_at || e.created_at))
						}
					}
				]
			};
		}

		// 5c. Repository Tasks: repository://{name}/tasks[?...]
		if (repoPath === "tasks") {
			const status = query.get("status");
			const priority = query.get("priority");

			let tasks: any[];
			if (status && status !== "all") {
				const statuses = status.split(",").map((s) => s.trim());
				tasks = db.tasks.getTasksByMultipleStatuses(name, statuses);
			} else {
				tasks = db.tasks.getTasksByMultipleStatuses(name, ["backlog", "pending", "in_progress", "blocked"]);
			}

			if (priority) {
				const p = Number(priority);
				if (!isNaN(p)) {
					tasks = tasks.filter((t: any) => t.priority === p);
				}
			}

			const payload = JSON.stringify(tasks, null, 2);
			return {
				contents: [
					{
						uri,
						mimeType: "application/json",
						text: payload,
						size: Buffer.byteLength(payload, "utf8"),
						annotations: {
							audience: ["assistant"],
							priority: 0.9,
							lastModified: deriveLastModifiedFromCollection(tasks.map((t: any) => t.updated_at))
						}
					}
				]
			};
		}

		// 5d. Repository Actions: repository://{name}/actions
		if (repoPath === "actions") {
			const actions = db.actions.getRecentActions(name, 100);
			const payload = JSON.stringify(actions, null, 2);
			return {
				contents: [
					{
						uri,
						mimeType: "application/json",
						text: payload,
						size: Buffer.byteLength(payload, "utf8"),
						annotations: {
							audience: ["assistant"],
							priority: 0.6,
							lastModified: deriveLastModifiedFromCollection(actions.map((a: any) => a.created_at))
						}
					}
				]
			};
		}
	}

	// 6. Action Detail: action://{id}  (integer ID from audit log)
	const actionIdMatch = uri.match(/^action:\/\/(\d+)$/);
	if (actionIdMatch) {
		const id = Number(actionIdMatch[1]);
		const action = db.actions.getActionById(id);
		if (!action) throw resourceNotFound(`Action with ID ${id} not found.`, uri);

		const payload = JSON.stringify(action, null, 2);
		return {
			contents: [
				{
					uri,
					mimeType: "application/json",
					text: payload,
					size: Buffer.byteLength(payload, "utf8"),
					annotations: {
						audience: ["assistant"],
						priority: 0.55,
						lastModified: action.created_at
					}
				}
			]
		};
	}

	throw resourceNotFound(`Unknown resource URI: ${uri}`, uri);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parses a `repository://{name}/{path}[?query]` URI.
 * Returns null if the URI doesn't match the pattern.
 */
function parseRepoUri(uri: string): { name: string; path: string; query: URLSearchParams } | null {
	const prefix = "repository://";
	if (!uri.startsWith(prefix)) return null;

	const rest = uri.slice(prefix.length);
	const queryStart = rest.indexOf("?");
	const withoutQuery = queryStart === -1 ? rest : rest.slice(0, queryStart);
	const queryString = queryStart === -1 ? "" : rest.slice(queryStart + 1);

	const slashIdx = withoutQuery.indexOf("/");
	if (slashIdx === -1) return null; // must have at least one slash

	const name = withoutQuery.slice(0, slashIdx);
	const path = withoutQuery.slice(slashIdx + 1);

	if (!name || !path) return null;

	return { name, path, query: new URLSearchParams(queryString) };
}

function paginateEntries<T extends object>(
	key: "resources" | "resourceTemplates",
	entries: T[],
	params?: { cursor?: string; limit?: number }
) {
	const limit = normalizeLimit(params?.limit);
	const offset = decodeCursor(params?.cursor);
	const sliced = entries.slice(offset, offset + limit);
	const nextOffset = offset + sliced.length;

	return {
		[key]: sliced,
		nextCursor: nextOffset < entries.length ? encodeCursor(nextOffset) : undefined
	};
}

function normalizeLimit(limit: unknown) {
	if (typeof limit !== "number" || !Number.isFinite(limit)) {
		return DEFAULT_PAGE_SIZE;
	}

	return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(limit)));
}

function deriveLastModifiedFromCollection(values: Array<string | undefined | null>) {
	const normalized = values.filter((value): value is string => typeof value === "string" && value.length > 0);
	return normalized.sort().at(-1) ?? new Date().toISOString();
}

function resourceNotFound(message: string, uri: string) {
	const error = new Error(message) as Error & { code: number; data?: Record<string, unknown> };
	error.code = -32002;
	error.data = { uri };
	return error;
}

function invalidCompletionParams(message: string) {
	const error = new Error(message) as Error & { code: number };
	error.code = -32602;
	return error;
}
