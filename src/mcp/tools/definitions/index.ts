// Re-export all tool definitions as a flat array
import { MEMORY_TOOL_DEFINITIONS } from "./memory";
import { TASK_TOOL_DEFINITIONS } from "./task";
import { HANDOFF_TOOL_DEFINITIONS } from "./handoff";
import { STANDARD_TOOL_DEFINITIONS } from "./standard";

export { MEMORY_TOOL_DEFINITIONS } from "./memory";
export { TASK_TOOL_DEFINITIONS } from "./task";
export { HANDOFF_TOOL_DEFINITIONS } from "./handoff";
export { STANDARD_TOOL_DEFINITIONS } from "./standard";

export const TOOL_DEFINITIONS = [
	...MEMORY_TOOL_DEFINITIONS,
	...TASK_TOOL_DEFINITIONS,
	...HANDOFF_TOOL_DEFINITIONS,
	...STANDARD_TOOL_DEFINITIONS
];
