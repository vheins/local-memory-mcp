---
name: documentation-sync
description: Reconcile memory decisions with local markdown files in the current repository
arguments: []
agent: Documentation Specialist
---
Please verify if our local documentation (README.md, docs/*.md, .agents/documents/**/*.md, .kiro/**/*.md) is in sync with our stored memories for the current repository.

Steps:
1. **Fetch Decisions**: Use '@vheins/local-memory-mcp tools memory-search' to find all 'decision' type memories for this repo.
2. **Read Docs**: Read the primary project documentation files including those in .agents/documents and .kiro.
3. **Identify Gaps**: Is there any durable knowledge in the memory that is MISSING from the docs? Is there any documentation that is OUTDATED based on recent decisions?
4. **Propose Updates**: Suggest specific changes to the documentation to reflect the current source of truth.
