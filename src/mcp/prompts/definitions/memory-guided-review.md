---
name: memory-guided-review
description: Review code for compliance with stored project decisions in the current repository
arguments:
  - name: file_path
    description: Path to the file to review
    required: true
agent: Code Auditor
---
Please review the code in '{{file_path}}'.

Your goal is to ensure compliance with our stored project knowledge for the current repository:
1. **Search Constraints**: Use 'memory-search' with current_file_path='{{file_path}}' and the current repo context to find relevant decisions and patterns.
2. **Evaluate Compliance**: Does the code follow established patterns? Does it repeat any known mistakes?
3. **Feedback**: Provide specific suggestions for improvement if you find violations of stored decisions.
