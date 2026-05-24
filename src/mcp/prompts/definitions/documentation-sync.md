---
name: documentation-sync
description: Sync memory decisions with repository markdown files
arguments: []
agent: Documentation Specialist
version: "1.0.0"
license: Proprietary — Personal Use Only
category: workflows
type: Utility
complexity: Beginner
tags: [workflow, documentation, memory, sync]
author: vheins
---
Reconcile local documentation with stored memories.

Steps:
1. **Search**: Find `type: decision` memories via `memory-search`.
2. **Scan**: Read `README.md`, `docs/`, `.agents/documents/`, and `.kiro/`.
3. **Compare**: Identify missing or outdated durable knowledge.
4. **Update**: Propose specific changes to align docs with current source of truth.
