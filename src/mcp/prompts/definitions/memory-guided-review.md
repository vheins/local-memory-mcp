---
name: memory-guided-review
description: Review code for compliance with stored decisions.
arguments:
  - name: file_path
    description: File to review.
    required: true
agent: Code Auditor
---
Audit {{file_path}} against stored project knowledge.

Steps:
1. **Search**: Call `memory-search` using `current_file_path='{{file_path}}'`.
2. **Evaluate**: Check for compliance with established patterns and avoidance of documented mistakes.
3. **Feedback**: Suggest fixes for any decision violations found.
