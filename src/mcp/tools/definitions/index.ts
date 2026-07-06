// Re-export all tool definitions as a flat array
import { MEMORY_TOOL_DEFINITIONS } from "./memory";
import { TASK_TOOL_DEFINITIONS } from "./task";
import { HANDOFF_TOOL_DEFINITIONS } from "./handoff";
import { STANDARD_TOOL_DEFINITIONS } from "./standard";
import { AGENT_TOOL_DEFINITIONS } from "./agent";

export { MEMORY_TOOL_DEFINITIONS } from "./memory";
export { TASK_TOOL_DEFINITIONS } from "./task";
export { HANDOFF_TOOL_DEFINITIONS } from "./handoff";
export { STANDARD_TOOL_DEFINITIONS } from "./standard";
export { AGENT_TOOL_DEFINITIONS } from "./agent";

export const TOOL_DEFINITIONS = [
	...MEMORY_TOOL_DEFINITIONS,
	...TASK_TOOL_DEFINITIONS,
	...HANDOFF_TOOL_DEFINITIONS,
	...STANDARD_TOOL_DEFINITIONS,
	...AGENT_TOOL_DEFINITIONS
];
