# v0.20.0 — Codebase Index

## Key Features

- **index_repository**: Parse TypeScript/JavaScript codebases into a searchable knowledge graph
- **search_symbols**: Search indexed symbols with 5-tier ranking (exact > camelCase > prefix > substring > FTS5)
- **get_file_symbols**: Get all symbols declared in a specific file
- **get_architecture**: Get codebase directory tree, language breakdown, and top-level exports
- **trace_symbol**: Trace symbol definitions and usage references
- **Dashboard**: New Codebase tab with file tree, symbol explorer, search bar, index status
- **CLI**: --index flag for server startup indexing
- **Performance**: 1000 files indexed in 1.4s, concurrent parsing, batch processing

## Upgrade Notes

- New dependencies: web-tree-sitter, tree-sitter-typescript, tree-sitter-javascript
- New env vars: CODEBASE_AUTO_INDEX, CODEBASE_AUTO_INDEX_TTL, CODEBASE_INDEX_PARSE_CONCURRENCY, CODEBASE_INDEX_PARSE_TIMEOUT_MS
- Schema migration v3: codebase_files, codebase_symbols tables added
- 258 automated tests covering all components
