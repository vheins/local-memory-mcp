import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pkgVersion = "0.1.0";

// __PKG_VERSION__ is injected at build time by tsup define
// Fallback: walk up directory tree to find package.json
if (typeof __PKG_VERSION__ !== "undefined" && __PKG_VERSION__) {
	pkgVersion = __PKG_VERSION__;
} else {
	let searchDir = __dirname;
	for (let i = 0; i < 5; i++) {
		const candidate = path.join(searchDir, "package.json");
		try {
			if (fs.existsSync(candidate)) {
				const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
				if (pkg.name === "@vheins/local-memory-mcp" && pkg.version) {
					pkgVersion = pkg.version;
					break;
				}
			}
		} catch { /* try next */ }
		searchDir = path.dirname(searchDir);
	}
}

declare const __PKG_VERSION__: string;

// MCP Server Capabilities
export const MCP_PROTOCOL_VERSION = "2025-03-26";

const SERVER_INSTRUCTIONS = `
Local Memory MCP — persistent memory, task coordination, and coding standards for AI agents.

## When to use this server
Use at the START of every session and before any implementation work:
1. Call \`task-list\` to sync active/pending tasks for the current repository.
2. Call \`handoff-list\` to check pending context transfers. Close stale handoffs with \`handoff-update\`.
3. Call \`memory-search\` and \`memory-synthesize\` to hydrate architectural context before coding.
4. Call \`standard-search\` when implementation may be governed by language/stack conventions.

## Core Workflows

**Memory**: \`memory-search\` → \`memory-detail\` → \`memory-store\` / \`memory-update\`
- Store only durable knowledge (architecture, patterns, decisions, fixes).
- Use \`memory-acknowledge\` after generating code from memory results.
- Global scope only for cross-repo rules; prefer repo-specific scope.

**Tasks**: \`task-list\` → \`task-claim\` → \`task-update\` (in_progress → completed)
- Register planned steps via \`task-create\` before execution.
- Never skip intermediate \`in_progress\` state before \`completed\`.
- Completing a task auto-releases claims and expires linked handoffs.

**Standards**: \`standard-search\` → \`standard-store\`
- One rule per entry. Treat as normative implementation contracts, not docs summaries.

**Handoffs/Claims**: \`handoff-list\` → \`handoff-create\` / \`handoff-update\` | \`task-claim\` / \`claim-release\`
- Create handoffs only for unfinished work with concrete next owner or next steps.
- Do NOT create handoffs as completion summaries — put those on \`task-update\` comments.

## Available Prompts (invoke as slash commands)
- \`session-planner\` — orient and plan at session start
- \`task-memory-executor\` — execute tasks with memory and standard enforcement
- \`senior-code-review\` — full code review against stored standards
- \`memory-guided-review\` — review using project memory as context
- \`architecture-design\` — architectural planning and ADR generation
- \`technical-planning\` — feature planning with task decomposition
- \`root-cause-analysis\` — structured bug / incident investigation
- \`fix-suggestion\` — propose and validate fixes
- \`security-triage\` — security risk assessment
- \`learning-retrospective\` — capture lessons and update memory
- \`documentation-sync\` — sync docs with current codebase state
- \`project-briefing\` — generate repository briefing from memory
`.trim();

export const CAPABILITIES = {
	serverInfo: {
		name: "mcp-memory-local",
		version: pkgVersion,
		instructions: SERVER_INSTRUCTIONS
	},
	capabilities: {
		completions: {},
		logging: {},
		resources: {
			subscribe: true,
			listChanged: true
		},
		tools: {
			listChanged: false
		},
		prompts: {
			listChanged: true
		}
	}
};
