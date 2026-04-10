import { MemoryRecapSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { createMcpResponse, McpResponse } from "../utils/mcp-response.js";
import { logger } from "../utils/logger.js";

export async function handleMemoryRecap(
  params: any,
  db: SQLiteStore
): Promise<McpResponse> {
  // Validate input
  const validated = MemoryRecapSchema.parse(params);

  logger.info("[MCP] memory.recap", { repo: validated.repo, limit: validated.limit, offset: validated.offset });

  // Get total count for pagination metadata
  const total = db.getTotalCount(validated.repo, false, ['task_archive']);

  // Get recent memories using public API (no type-unsafe cast)
  const rows = db.getRecentMemories(validated.repo, validated.limit, validated.offset, false, ['task_archive']);

  // Get active tasks for recap (In Progress, Pending, Blocked, Canceled)
  const activeStatuses = ["in_progress", "pending", "blocked", "canceled"];
  const tasks = db.getTasksByMultipleStatuses(validated.repo, activeStatuses, 50);
  
  // Sort tasks: in_progress first, then by priority
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.status === "in_progress" && b.status !== "in_progress") return -1;
    if (a.status !== "in_progress" && b.status === "in_progress") return 1;
    return (b.priority || 0) - (a.priority || 0);
  });

  const formattedTasks = sortedTasks.map(t => ({
    id: t.id,
    task_code: t.task_code,
    title: t.title,
    status: t.status,
    priority: t.priority
  }));

  if (rows.length === 0 && tasks.length === 0) {
    return createMcpResponse(
      {
        repo: validated.repo,
        count: 0,
        total,
        offset: validated.offset,
        memories: [],
        tasks: [],
        message: `No memories or tasks found for repo: ${validated.repo}`
      },
      `No memories or tasks for repo "${validated.repo}".`,
      {
        structuredContentPathHint: "memories",
        contentSummary: `No memories or tasks for repo "${validated.repo}". See structuredContent.memories and structuredContent.tasks.`,
      }
    );
  }

  // Format memories for recap
  const formattedMemories = rows.map((row, index) => ({
    number: validated.offset + index + 1,
    id: row.id,
    type: row.type,
    importance: row.importance,
    preview: row.content.substring(0, 100) + (row.content.length > 100 ? "..." : ""),
    created_at: row.created_at
  }));

  // Create summary text
  const memorySummary = formattedMemories
    .map(
      (m) =>
        `${m.number}. [${m.type.toUpperCase()}] (importance: ${m.importance}) ${m.preview}`
    )
    .join("\n");

  const taskSummary = formattedTasks
    .map(
      (t) =>
        `- [${t.status.toUpperCase()}] [${t.task_code}] ${t.title} (P${t.priority})`
    )
    .join("\n");

  return createMcpResponse(
    {
      repo: validated.repo,
      count: rows.length,
      total,
      offset: validated.offset,
      memories: formattedMemories,
      tasks: formattedTasks,
      summary: `Recent ${rows.length} memories:\n\n${memorySummary}\n\nActive Tasks:\n\n${taskSummary || "No active tasks"}`
    },
    `Retrieved ${rows.length} memories and ${tasks.length} active tasks for repo "${validated.repo}".`,
    {
      contentSummary: `Retrieved ${rows.length} memories and ${tasks.length} active tasks for repo "${validated.repo}". See structuredContent.memories and structuredContent.tasks.`,
      resourceLinks: [
        {
          uri: `memory://summary/${validated.repo}`,
          name: `Memory Summary (${validated.repo})`,
          description: "Repository summary resource",
          mimeType: "text/plain",
          annotations: {
            audience: ["assistant"],
            priority: 0.8,
          },
        },
        {
          uri: `tasks://current?repo=${encodeURIComponent(validated.repo)}`,
          name: `Current Tasks (${validated.repo})`,
          description: "Current task snapshot for the repository",
          mimeType: "application/json",
          annotations: {
            audience: ["assistant"],
            priority: 0.7,
          },
        },
      ],
    }
  );
}
