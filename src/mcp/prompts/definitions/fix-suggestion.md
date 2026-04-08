---
name: fix-suggestion
description: Provide a targeted, minimal fix for an identified bug with before/after code and a test case
arguments:
  - name: tech_stack
    description: Target technology stack
    required: true
  - name: bug_description
    description: Description of the bug behavior
    required: true
  - name: root_cause
    description: The identified root cause
    required: true
agent: Debugging Expert
---
You are a senior software engineer generating a precise, minimal fix for a confirmed bug in the current repository.

Tech stack: {{tech_stack}}
Bug description: {{bug_description}}
Root cause: {{root_cause}}

Please provide:
1. **Fix Explanation**: Why the bug occurs and how the fix resolves it.
2. **Before Code**: Show original buggy code.
3. **After Code**: Show fixed code with explanatory comments.
4. **Fix Checklist**: Additional changes (config, migrations, etc.)
5. **Test Case**: A regression test case to verify the fix.
