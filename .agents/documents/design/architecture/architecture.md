# Architecture Overview

## Components & Data Flow
The `local-memory-mcp` project follows a local-first, server-client architecture utilizing the Model Context Protocol over standard input/output (stdio) or SSE (when applicable). It comprises two primary services:
1. **MCP Server (`mcp-memory-server.js`)**: An LLM-facing process. Takes JSON-RPC commands on `stdin`, processes tools/resources/prompts requests, interacts with the SQLite database, generates embeddings via a local ONNX model, and responds over `stdout`.
2. **Dashboard Server (`mcp-memory-dashboard.js`)**: An Express server running on a designated port serving a Svelte frontend, connecting directly to the same SQLite database for read-only (and some administrative) capabilities for the developer to inspect.

## Key Technical Decisions
- **Local-First AI**: Leveraging `@xenova/transformers` ensures that all data embedded remains strictly on the user's machine, securing proprietary context.
- **SQLite**: Single-file relational database that provides an excellent balance between ACID compliance and zero-configuration setups, ideal for an extension plugin.
- **Stdio Transport**: Standard integration model for Cursor, VSCode, and other AI IDEs.