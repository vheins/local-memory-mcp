# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-04-12

### Added
- **Hybrid Search Strategy**: Implemented 70% Vector and 30% FTS5 weighting for repository-wide context research.
- **Similarity Conflict Detection**: Enforced a 0.55 similarity threshold for `memory-store` to prevent redundant knowledge entries.
- **Task Lifecycle Safety**: Mandatory transition requirement for tasks to pass through `in_progress` status before reaching `completed`.
- **Automatic Task Archiving**: Automatic creation of `task_archive` memory entries upon task completion, including full history and token metrics.

### Changed
- **Behavioral Rule Alignment**: Updated global `GEMINI.md` rules and `.agents` workflow source files to strictly follow the new technical constants (70/30 weighting, 0.55 threshold).
- **Prompt Synchronization**: Refactored `task-memory-executor`, `create-task`, and audit prompts to align with the core PRD/TDD implementation logic.

## [0.5.33] - 2026-04-11
- Initial public release of stable memory toolset.
