# Feature Documentation: Dashboard UI

## Responsibility
The Dashboard UI provides a responsive, high-fidelity interface for human interaction with the local memory system. It serves as both a monitoring tool and a manual administrative console.

## Primary Navigation
The interface is organized into 5 functional tabs:
1. **Dashboard**: High-level stats, volume trends, and performance metrics.
2. **Activity**: A chronological audit log of all system actions.
3. **Memories**: Knowledge search, curation, and bulk import/export.
4. **Tasks**: A Kanban view of all development initiatives.
5. **Reference**: A self-documenting index of MCP capabilities (Tools/Prompts).

## UI Architecture Components
- **`App.svelte`**: Tab orchestration and global state context.
- **Composables**: Logic encapsulation for specific features (e.g., `useKanban`, `useActivity`).
- **Glass System**: A set of reusable CSS patterns for transparent surfaces and blurs.
- **Icon Set**: Standardized SVG icons for status and action clarity.

## User Stories (Production)
- **Activity Auditing**: "As a developer, I want to see the exact input/output of an agent's search query so I can debug why it missed a critical fact."
- **Bulk Seeding**: "As a developer, I want to upload a JSON list of project rules so the agent is immediately context-aware."
- **Capability Inspection**: "As a developer, I want to see the JSON schema of the `memory.store` tool to ensure my prompts match the required types."

## Technical Patterns
- **API Communication**: Centralized via `api.ts` with typed fetch wrappers.
- **State Management**: Svelte stores for reactive UI updates (Loading states, Toast notifications).
- **Responsiveness**: Flexbox-first layout with mobile-specific drawer transitions.
