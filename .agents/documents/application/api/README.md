# API

> Bridge — canonical contract is not here.

**Canonical:** `src/mcp/prompts/server/instructions.md` · Tool definitions: `src/mcp/types/tool-definitions/` (20 tools: `memory-*` 3, `task-*` 3, `standard-*` 3, `handoff-*` 3, `codebase-*` 2, `agent-context`, `synthesize`, `repo-summarize`, `observation-*` 2, `prompt-read` 1) + 32 prompts in `src/mcp/prompts/definitions/`.

This `application/api/` will hold **per-feature OpenAPI-style specs** as they are authored (one file per feature/tool group, generated from Zod schemas via `inputSchemaFromSchema`). Until then:

- Existing detail: [.agents/documents/api/](../../api/) (e.g. [codebase-index.md](../../api/codebase-index.md))
- Schema source of truth: `src/mcp/tools/schemas/*` (Zod)
- Operations: [.agents/documents/operations/](../../operations/)

Do not duplicate the contract — link to it.
