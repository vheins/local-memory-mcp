---
name: fix-suggestion
description: Targeted fix with before/after code and test case.
arguments:
  - name: tech_stack
    description: Target tech stack.
    required: true
  - name: bug_description
    description: Bug behavior.
    required: true
  - name: root_cause
    description: Identified root cause.
    required: true
agent: Debugging Expert
---
Provide precise, minimal fix for confirmed bug.

Stack: {{tech_stack}}
Bug: {{bug_description}}
Cause: {{root_cause}}

Output:
1. **Explanation**: Why it happens & how fix works.
2. **Before/After**: Diff style code blocks with comments.
3. **Checklist**: Meta changes (config, migrations).
4. **Verification**: Regression test case.
