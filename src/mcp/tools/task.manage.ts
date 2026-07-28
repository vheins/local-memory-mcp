/**
 * Consolidated re-exports for task tools (ADR-002).
 * All 7 legacy tools merged into 3 unified handlers:
 *   - task.write.ts  — handleTaskWrite  (create + update + interactive + bulk)
 *   - task.read.ts   — handleTaskRead   (search + detail + list)
 *   - task.delete.ts — handleTaskDelete (single + bulk delete)
 *   - task.helpers.ts — shared utilities
 *
 * Direct consumers should import from the individual files instead.
 */

export { resolveParentId, resolveDependsOn, deriveTaskStatusTimestamps, archiveTaskToMemory } from "./task.helpers";
export { handleTaskWrite } from "./task-write";
export { handleTaskRead } from "./task-read";
export { handleTaskDelete } from "./task.delete";
