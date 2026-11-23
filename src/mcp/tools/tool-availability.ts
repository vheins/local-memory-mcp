/**
 * The capability filter over the canonical tool definitions (TASK-011).
 *
 * This is the single source for "which tools exist and which may be called".
 * It lives beside the definitions rather than inside `router.ts` because the
 * filter is pure data plus one session flag: the root CLI builds its whole
 * command surface from it, and importing the router would drag in
 * `buildExecutors` — the codebase-index engine and the embedding loaders — into
 * a one-shot `--help` call that must start in milliseconds and never open a
 * database. `router.ts` imports this module, so the MCP transport and the CLI
 * cannot disagree about what exists.
 */

import { TOOL_DEFINITIONS } from "./tool-definitions";
import type { SessionContext } from "../session";

/** The tool names that need a session capability the CLI cannot provide. */
const SAMPLING_GATED_TOOLS = new Set(["synthesize"]);

/**
 * The tool definitions a session may call, filtered by capability.
 *
 * @param session - The calling session; omit for a capability-less session
 *                  (no roots, no sampling), which is the CLI's own profile.
 * @returns Every definition the session may call, unpaginated, in registry order.
 */
export function getAvailableToolDefinitions(session?: Pick<SessionContext, "supportsSampling">) {
	return TOOL_DEFINITIONS.filter((tool) => !SAMPLING_GATED_TOOLS.has(tool.name) || session?.supportsSampling === true);
}
