---
name: memory-guided-review
description: Review code for compliance with stored decisions.
arguments:
  - name: file_path
    description: File to review. Optional — if omitted, review the currently open/active file in the workspace, or all recently modified files.
    required: false
agent: Code Auditor
---
## 0. CONTEXT RESOLUTION
- **file_path**: If provided, use it. If omitted — use the currently active/open file from workspace context, or list recently modified files via git and process them.

Audit the resolved file(s) against stored project knowledge.

Steps:
1. **Search Memory**: Call `memory-search` using `current_file_path='{{file_path}}'`.
2. **Hydrate**: Call `memory-detail` for any relevant pointer row before enforcing it.
3. **Search Standards**: Call `standard-search` with inferred language/stack/repo filters.
4. **Evaluate**: Check for compliance with established patterns, documented mistakes, and applicable coding standards.
5. **Feedback**: Suggest fixes for violations, citing whether the source is memory or standard.
