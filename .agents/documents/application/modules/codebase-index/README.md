# Module: Codebase Index

**Purpose**: Parse, index, and query source code structure using tree-sitter AST parsing, enabling agents to understand codebases without reading every file.

**Key Capabilities**:

- Discover source files respecting `.gitignore` and binary detection
- Parse TypeScript/JavaScript with tree-sitter WASM (extensible to more languages)
- Store files, symbols, and relations in SQLite
- Search symbols by name with exact/prefix/substring matching
- Retrieve all symbols in a file with signatures and doc comments
- Trace call relationships across files
- Query architecture overview with hotspot detection
- Auto-index on session start with incremental re-indexing

**Documentation**:

- [Module Overview](overview.md) — architecture, services, dependencies
- [Indexing Pipeline](indexing.md) — file discovery, parsing, storage flow
- [Symbol Search](search.md) — search, query, retrieval
- [Architecture Query](architecture-overview.md) — structural overview, call tracing, hotspots
