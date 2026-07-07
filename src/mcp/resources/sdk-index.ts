import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { SessionContext } from "../session";
import { rankCompletionValues } from "../utils/completion";
import { parseRepoInput } from "../utils/normalize";
import type { Task, MemoryType } from "../types/index";

/**
 * Registers all resources and resource templates via SDK registerResource().
 *
 * Mirrors the old resources/index.ts logic but uses the SDK's built-in
 * resource/template/completion lifecycle instead of manual handlers.
 *
 * Static resources:
 *   - repository://index
 *   - session://roots
 *
 * Template resources:
 *   - repository://{name}/memories{?search,type,tag,limit,offset}
 *   - memory://{id}
 *   - repository://{name}/tasks{?status,priority,limit,offset}
 *   - task://{id}
 *   - repository://{name}/summary
 *   - repository://{name}/actions{?limit,offset}
 *   - action://{id}
 */
export function registerAllResources(
	server: McpServer,
	store: SQLiteStore,
	_vectors: VectorStore,
	session: SessionContext
): void {
	const db = store;

	// ── Data source helpers (shared by completions and reads) ──────────

	function getRepos(): string[] {
		const values = new Set<string>();
		for (const repo of db.system.listRepos()) {
			values.add(repo);
		}
		if (session.roots.length > 0) {
			for (const root of session.roots) {
				const name = root.name || root.uri.split("/").filter(Boolean).pop() || "";
				if (name) values.add(name);
			}
		}
		return [...values].sort((a, b) => a.localeCompare(b));
	}

	function getTags(): string[] {
		const values = new Set<string>();
		const memories = db.memories.getRecentMemories("", "", 1000);
		for (const memory of memories) {
			for (const tag of memory.tags || []) {
				if (typeof tag === "string" && tag.trim()) {
					values.add(tag.trim());
				}
			}
		}
		return [...values].sort((a, b) => a.localeCompare(b));
	}

	function _deriveLastModified(values: Array<string | undefined | null>): string {
		const normalized = values.filter((v): v is string => typeof v === "string" && v.length > 0);
		return normalized.sort().at(-1) ?? new Date().toISOString();
	}

	// ── Static: Repository Index ──────────────────────────────────────

	server.registerResource(
		"repository-index",
		"repository://index",
		{
			title: "Repository Index",
			description: "List of all known repositories with memory/task counts and last activity",
			mimeType: "application/json"
		},
		async (uri, _extra) => {
			const repos = db.system.listRepoNavigation();
			const payload = JSON.stringify(repos, null, 2);
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: payload
					}
				]
			};
		}
	);

	// ── Static: Session Roots ────────────────────────────────────────

	server.registerResource(
		"session-roots",
		"session://roots",
		{
			title: "Session Roots",
			description: session?.roots?.length
				? "Active workspace roots provided by the MCP client"
				: "No active workspace roots were provided by the MCP client",
			mimeType: "application/json"
		},
		async (uri, _extra) => {
			const payload = JSON.stringify({ roots: session?.roots ?? [] }, null, 2);
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: payload
					}
				]
			};
		}
	);

	// ── Helper: lazy completable repos/tags (deferred until first completion request) ──

	function reposLazy(): () => string[] {
		let cached: string[] | null = null;
		return () => {
			if (cached === null) cached = getRepos();
			return cached;
		};
	}

	function tagsLazy(): () => string[] {
		let cached: string[] | null = null;
		return () => {
			if (cached === null) cached = getTags();
			return cached;
		};
	}

	const reposFn = reposLazy();
	const tagsFn = tagsLazy();

	// ── Template: Repository Memories ─────────────────────────────────

	server.registerResource(
		"repository-memories",
		new ResourceTemplate("repository://{name}/memories{?search,type,tag,limit,offset}", {
			list: undefined,
			complete: {
				name: async (value) => rankCompletionValues(reposFn(), value as string),
				tag: async (value) => rankCompletionValues(tagsFn(), value as string)
			}
		}),
		{
			title: "Repository Memories",
			description: "All active memory entries for a specific repository, optionally filtered by search, type, or tag",
			mimeType: "application/json"
		},
		async (uri, variables, _extra) => {
			const name = variables.name as string;
			const search = (variables.search as string) || "";
			const type = variables.type as string | undefined;
			const tag = variables.tag as string | undefined;

			const result = db.memories.listMemoriesForDashboard({
				repo: name,
				type: (type as MemoryType) || undefined,
				tag: tag || undefined,
				search: search || undefined,
				limit: 50
			});
			const entries = result.items;
			const payload = JSON.stringify(entries, null, 2);
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: payload
					}
				]
			};
		}
	);

	// ── Template: Memory Detail ───────────────────────────────────────

	server.registerResource(
		"memory-detail",
		new ResourceTemplate("memory://{id}", { list: undefined }),
		{
			title: "Memory Detail",
			description: "Full content and statistics for a specific memory UUID",
			mimeType: "application/json"
		},
		async (uri, variables, _extra) => {
			const id = variables.id as string;
			const entry = db.memories.getByIdWithStats(id);
			if (!entry) {
				throw new Error(`Memory with ID ${id} not found.`);
			}
			const payload = JSON.stringify(entry, null, 2);
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: payload
					}
				]
			};
		}
	);

	// ── Template: Repository Tasks ────────────────────────────────────

	server.registerResource(
		"repository-tasks",
		new ResourceTemplate("repository://{name}/tasks{?status,priority,limit,offset}", {
			list: undefined,
			complete: {
				name: async (value) => rankCompletionValues(reposFn(), value as string)
			}
		}),
		{
			title: "Repository Tasks",
			description: "All active tasks for a specific repository, optionally filtered by status or priority",
			mimeType: "application/json"
		},
		async (uri, variables, _extra) => {
			const name = variables.name as string;
			const status = variables.status as string | undefined;
			const priority = variables.priority as string | undefined;
			const owner = parseRepoInput(name).owner;

			let tasks: Task[];
			if (status && status !== "all") {
				const statuses = status.split(",").map((s) => s.trim());
				tasks = db.tasks.getTasksByMultipleStatuses(owner, name, statuses);
			} else {
				tasks = db.tasks.getTasksByMultipleStatuses(owner, name, ["backlog", "pending", "in_progress", "blocked"]);
			}

			if (priority) {
				const p = Number(priority);
				if (!isNaN(p)) {
					tasks = tasks.filter((t: Task) => t.priority === p);
				}
			}

			const payload = JSON.stringify(tasks, null, 2);
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: payload
					}
				]
			};
		}
	);

	// ── Template: Task Detail ─────────────────────────────────────────

	server.registerResource(
		"task-detail",
		new ResourceTemplate("task://{id}", { list: undefined }),
		{
			title: "Task Detail",
			description: "Full content and comments for a specific task UUID",
			mimeType: "application/json"
		},
		async (uri, variables, _extra) => {
			const id = variables.id as string;
			const task = db.tasks.getTaskById(id);
			if (!task) {
				throw new Error(`Task with ID ${id} not found.`);
			}
			const payload = JSON.stringify(task, null, 2);
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: payload
					}
				]
			};
		}
	);

	// ── Template: Repository Summary ──────────────────────────────────

	server.registerResource(
		"repository-summary",
		new ResourceTemplate("repository://{name}/summary", {
			list: undefined,
			complete: {
				name: async (value) => rankCompletionValues(reposFn(), value as string)
			}
		}),
		{
			title: "Repository Summary",
			description: "High-level architectural summary for a repository",
			mimeType: "text/plain"
		},
		async (uri, variables, _extra) => {
			const name = variables.name as string;
			const summary = db.summaries.getSummary("", name);
			const text = summary?.summary || `No summary available for repository: ${name}`;
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "text/plain",
						text
					}
				]
			};
		}
	);

	// ── Template: Repository Actions ─────────────────────────────────

	server.registerResource(
		"repository-actions",
		new ResourceTemplate("repository://{name}/actions{?limit,offset}", {
			list: undefined,
			complete: {
				name: async (value) => rankCompletionValues(reposFn(), value as string)
			}
		}),
		{
			title: "Repository Actions",
			description: "Audit log of agent tool actions scoped to a repository",
			mimeType: "application/json"
		},
		async (uri, variables, _extra) => {
			const name = variables.name as string;
			const actions = db.actions.getRecentActions("", name, 100);
			const payload = JSON.stringify(actions, null, 2);
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: payload
					}
				]
			};
		}
	);

	// ── Template: Action Detail ───────────────────────────────────────

	server.registerResource(
		"action-detail",
		new ResourceTemplate("action://{id}", { list: undefined }),
		{
			title: "Action Detail",
			description: "Full details of a specific audit log entry by integer ID",
			mimeType: "application/json"
		},
		async (uri, variables, _extra) => {
			const idStr = variables.id as string;
			const id = Number(idStr);
			const action = db.actions.getActionById(id);
			if (!action) {
				throw new Error(`Action with ID ${id} not found.`);
			}
			const payload = JSON.stringify(action, null, 2);
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: payload
					}
				]
			};
		}
	);
}
