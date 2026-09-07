# Module Manifest

> Canonical: 6 modules. All paths relative to repo root.

| #   | Module              | Scope                          | Tools                                        | Key paths                                                                   |
| :-- | :------------------ | :----------------------------- | :------------------------------------------- | :-------------------------------------------------------------------------- |
| 1   | **memory**          | Memories + FTS5 + vectors + KG | `memory-read/write/delete`, `repo-summarize` | `src/mcp/tools/memory.*.ts`, `src/mcp/storage/`, `src/mcp/services/memory*` |
| 2   | **tasks**           | Tasks FSM + claims             | `task-read/write/delete`, `claim-manage`     | `src/mcp/tools/task*.ts`, `src/mcp/tools/claim*.ts`                         |
| 3   | **standards**       | Coding standards catalog       | `standard-read/write/delete`                 | `src/mcp/tools/standard*.ts`                                                |
| 4   | **handoffs/claims** | Inter-agent handoffs           | `handoff-read/write`, `claim-manage`         | `src/mcp/tools/handoff*.ts`                                                 |
| 5   | **codebase-index**  | Tree-sitter index + search     | `codebase-index`, `codebase-read`            | `src/mcp/codebase-index/`, `src/mcp/tools/codebase*.ts`                     |
| 6   | **dashboard**       | Svelte 5 + Express (port 3456) | REST `/api/*`                                | `src/dashboard/`, `src/dashboard/ui/`                                       |

Contract: `src/mcp/prompts/server/instructions.md` · Tool definitions: `src/mcp/types/tool-definitions/` · Brief: `../brief.md`.
