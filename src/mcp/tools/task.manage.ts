/**
 * Backward-compatible re-exports.
 * task.manage.ts was split into per-operation files:
 *   - task.helpers.ts  — shared utilities
 *   - task.create.ts   — handleTaskCreate, handleTaskCreateInteractive
 *   - task.update.ts   — handleTaskUpdate
 *   - task.delete.ts   — handleTaskDelete
 *   - task.list.ts     — handleTaskList
 *
 * Direct consumers should import from the individual files instead.
 */

export { resolveParentId, resolveDependsOn, deriveTaskStatusTimestamps, archiveTaskToMemory } from "./task.helpers";
export { handleTaskCreate, handleTaskCreateInteractive } from "./task.create";
export { handleTaskUpdate } from "./task.update";
export { handleTaskDelete } from "./task.delete";
export { handleTaskList } from "./task.list";
