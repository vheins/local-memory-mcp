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
1. **Search Memory**: Call `memory-search` using `current_file_path='{{file_path}}'`.
2. **Hydrate**: Call `memory-detail` for any relevant pointer row before enforcing it.
3. **Search Standards**: Call `standard-search` with inferred language/stack/repo filters.
4. **Evaluate**: Check for compliance with established patterns, documented mistakes, and applicable coding standards.
5. **Feedback**: Suggest fixes for violations, citing whether the source is memory or standard.
