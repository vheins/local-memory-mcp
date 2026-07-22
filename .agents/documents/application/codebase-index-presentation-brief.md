# Codebase Index — Presentation Brief

## Audience

AI coding agents (primary), developers using AI coding tools (secondary), project maintainers.

## Objective

Provide a 5-minute overview of the Codebase Index feature: what it does, why it matters, how it works, and when it will be delivered.

## Core Narrative Arc

1. **Problem**: AI agents spend 99%+ of tokens on file-by-file codebase exploration. Agents lack structural understanding of code (functions, classes, call relationships).
2. **Solution**: Parse source code into a persistent knowledge graph. Expose structural queries via MCP tools. Reduce exploration tokens by ~90%.
3. **How**: tree-sitter WASM parsing -> SQLite graph storage -> MCP tools + dashboard UI.
4. **Value**: Agents understand code structure instantly. Developers navigate codebases visually. Zero external dependencies.

## Key Claims (Evidence-Linked)

| Claim                                            | Evidence Source                                                           |
| :----------------------------------------------- | :------------------------------------------------------------------------ |
| Reduces agent exploration tokens by ~90%         | `.agents/documents/requirements/codebase-index/brd.md`                    |
| Parses TypeScript/JS/TSX/JSX at MVP              | `.agents/documents/design/codebase-index/architecture.md`                 |
| Indexes average repo in milliseconds             | `.agents/documents/design/codebase-index/schema.md` — performance targets |
| Zero external dependencies (pure Node.js + WASM) | `.agents/documents/design/decisions/adr-002-codebase-index.md`            |
| 6 new MCP tools for code query                   | `.agents/documents/design/codebase-index/api-contracts.md`                |

## Slide Outline (8 slides)

1. **Title**: "Codebase Index — Structural Code Intelligence for AI Agents"
2. **Problem**: The token waste graph — 99% of exploration tokens burned on file reads
3. **Solution**: Parse + Persist + Query — the three-stage pipeline
4. **Architecture**: Mermaid diagram showing File Discovery -> tree-sitter -> SQLite -> MCP Tools -> Dashboard
5. **MCP Tools**: 6 tools overview (index, search, file symbols, architecture, trace, status)
6. **Dashboard**: Codebase tab wireframe — file tree, symbol list, search, detail panel
7. **Delivery**: 4 sprints over 8 weeks — Core Indexing -> MCP Tools -> Dashboard -> Polish
8. **Value**: Before/after comparison for an AI agent exploring a new codebase

## Visual Guidance

- Use Mermaid architecture diagram from `.agents/documents/design/codebase-index/architecture.md`
- Use dashboard wireframe from `.agents/documents/design/codebase-index/wireframe.md`
- Use the sprint Gantt from `.agents/documents/tasks/codebase-index/roadmap.md`
- Flow diagrams for indexing pipeline from `.agents/documents/design/codebase-index/user-flows.md`

## Metrics to Present

- MVP effort: ~59 developer-days across 4 sprints
- Target: 10K files indexed in <60s
- Target: Symbol search in <200ms for 10K symbols
- Database growth: ~150MB for a 10K-file TypeScript project

## Assumptions & Risks

- **Assumption**: tree-sitter WASM works across Node 18/20/22 without native fallback
- **Assumption**: Single-language initial scope (TypeScript) is sufficient for MVP
- **Risk**: Large repo (50K+ files) may exceed 500MB memory target
- **Risk**: Name-based reference resolution produces false positives (documented limitation)

## Decisions Presented as Final

- tree-sitter WASM over native bindings (no platform deps)
- Single SQLite database (shared with existing memory.db)
- Incremental checksum-based re-indexing
- Single-pass parsing for MVP, multi-pass for Phase 2

## Exclusions

- Do NOT present LSP integration (Phase 2)
- Do NOT present cross-repo indexing (Phase 2)
- Do NOT present non-TypeScript languages beyond JS/TS/TSX/JSX (Phase 2)
- Do NOT present performance numbers before Sprint 10 benchmarks are run

## Source Files

- `.agents/documents/requirements/codebase-index/brd.md`
- `.agents/documents/requirements/codebase-index/prd.md`
- `.agents/documents/requirements/codebase-index/fsd.md`
- `.agents/documents/requirements/codebase-index/tdd.md`
- `.agents/documents/design/codebase-index/architecture.md`
- `.agents/documents/design/codebase-index/domain.md`
- `.agents/documents/design/codebase-index/schema.md`
- `.agents/documents/design/codebase-index/api-contracts.md`
- `.agents/documents/design/codebase-index/wireframe.md`
- `.agents/documents/design/codebase-index/user-flows.md`
- `.agents/documents/design/codebase-index/components.md`
- `.agents/documents/design/decisions/adr-002-codebase-index.md`
- `.agents/documents/application/modules/codebase-index/overview.md`
- `.agents/documents/tasks/codebase-index/roadmap.md`
- `.agents/documents/tasks/codebase-index/sprint-7.md`
- `.agents/documents/tasks/codebase-index/sprint-8.md`
- `.agents/documents/tasks/codebase-index/sprint-9.md`
- `.agents/documents/tasks/codebase-index/sprint-10.md`
