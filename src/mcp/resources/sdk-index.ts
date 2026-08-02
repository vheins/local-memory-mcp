import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { SessionContext } from "../session";
import { readResource } from "./index";

/**
 * Registers all resources and resource templates via SDK registerResource().
 *
 * Single-source adapter (TASK-098): every read handler delegates to the shared
 * implementation in `./index` (readResource), so the SDK transport and the
 * legacy test-adapter router (router.ts) serve resources through the SAME
 * code path — no overlapping logic to drift.
 *
 * This is the PRODUCTION registration path (server.ts → mcp-server.ts).
 * `./index` also remains the completion source (completion.ts →
 * completeResourceArgument); the SDK's per-template `complete` callbacks are
 * intentionally not configured here because mcp-server.ts installs a custom
 * `completion/complete` handler that overrides the SDK's built-in one.
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

	// Shared read dispatcher: the SDK invokes this with the concrete URI, and
	// readResource (./index) owns the URI → payload mapping for both transports.
	const read = (uri: URL): ReturnType<typeof readResource> => readResource(uri.toString(), db, session);

	// ── Static: Repository Index ──────────────────────────────────────

	server.registerResource(
		"repository-index",
		"repository://index",
		{
			title: "Repository Index",
			description: "All known repos with memory/task counts",
			mimeType: "application/json"
		},
		(uri) => read(uri)
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
		(uri) => read(uri)
	);

	// ── Template: Repository Memories ─────────────────────────────────

	server.registerResource(
		"repository-memories",
		new ResourceTemplate("repository://{name}/memories{?search,type,tag,limit,offset}", {
			list: undefined
		}),
		{
			title: "Repository Memories",
			description: "Active memory entries for a repo, filtered by search/type/tag",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Memory Detail ───────────────────────────────────────

	server.registerResource(
		"memory-detail",
		new ResourceTemplate("memory://{id}", { list: undefined }),
		{
			title: "Memory Detail",
			description: "Full content and stats for a memory UUID",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Repository Tasks ────────────────────────────────────

	server.registerResource(
		"repository-tasks",
		new ResourceTemplate("repository://{name}/tasks{?status,priority,limit,offset}", {
			list: undefined
		}),
		{
			title: "Repository Tasks",
			description: "Active tasks for a repo, filtered by status/priority",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Task Detail ─────────────────────────────────────────

	server.registerResource(
		"task-detail",
		new ResourceTemplate("task://{id}", { list: undefined }),
		{
			title: "Task Detail",
			description: "Full content and comments for a task UUID",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Repository Summary ──────────────────────────────────

	server.registerResource(
		"repository-summary",
		new ResourceTemplate("repository://{name}/summary", {
			list: undefined
		}),
		{
			title: "Repository Summary",
			description: "Architectural summary for a repo",
			mimeType: "text/plain"
		},
		(uri) => read(uri)
	);

	// ── Template: Repository Actions ─────────────────────────────────

	server.registerResource(
		"repository-actions",
		new ResourceTemplate("repository://{name}/actions{?limit,offset}", {
			list: undefined
		}),
		{
			title: "Repository Actions",
			description: "Audit log of tool actions for a repo",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Action Detail ───────────────────────────────────────

	server.registerResource(
		"action-detail",
		new ResourceTemplate("action://{id}", { list: undefined }),
		{
			title: "Action Detail",
			description: "Full details of an audit log entry",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);
}
