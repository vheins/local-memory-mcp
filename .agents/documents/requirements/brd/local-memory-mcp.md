# Business Requirements Document (BRD)

## Project Overview
**Project Name:** `local-memory-mcp`
**Description:** A Model Context Protocol (MCP) server that provides AI coding assistants with persistent semantic memory and lifecycle task management.

## Objectives
- Allow AI assistants to recall architectural decisions and codebase context across isolated sessions.
- Reduce the token cost and time wasted on repetitive prompting.
- Establish clear task boundaries so context is relevant only to the active work stream.

## Stakeholders
- **Primary Users:** Software Engineers, Developers.
- **Consumers:** AI Coding Assistants (Cursor, VSCode with AI extensions).

## Scope & Constraints
- Must operate entirely locally (zero cloud footprint for data privacy).
- Embedded within the IDE or local terminal environment.
- Failsafe fallback if vector embeddings fail to load.

## Metrics for Success
- Decreased repetitive context inquiries by the AI.
- Improved agent task completion rate due to stable context boundaries.