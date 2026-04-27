---
name: fix-suggestion
description: Targeted fix with before/after code and test case.
arguments:
  - name: tech_stack
    description: Target tech stack. Optional — inferred from repo/context if omitted.
    required: false
  - name: bug_description
    description: Bug behavior. Optional — inferred from active conversation or task context if omitted.
    required: false
  - name: root_cause
    description: Identified root cause. Optional — inferred from recent error/log context if omitted.
    required: false
agent: Debugging Expert
---

## 0. CONTEXT RESOLUTION
Resolve missing arguments from available context before proceeding:
- **tech_stack**: Detect from repo language, package files, or active task tags. Fallback: ask agent to infer from open files.
- **bug_description**: Extract from active task description, recent conversation, or error logs. Fallback: describe observable broken behavior.
- **root_cause**: Extract from recent analysis, error traces, or `memory-search` results. Fallback: state "unknown — investigation required".

Provide precise, minimal fix for confirmed bug.

Output:
1. **Explanation**: Why it happens & how fix works.
2. **Before/After**: Diff style code blocks with comments.
3. **Checklist**: Meta changes (config, migrations).
4. **Verification**: Regression test case.
