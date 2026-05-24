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
version: "1.1.0"
category: debugging
tags: [fix, patch, bug-fix, code-change, test-case, debugging]
---

# Skill: Fix Suggestion

> Provide precise, minimal fix for confirmed bug.

## I/O
tech_stack (req), bug_description (req), root_cause (req) → diagnosis report + fix suggestion

## Rules
1. Explanation: Why it happens and how fix works
2. Before/After: Diff style code blocks with comments
3. Checklist: Meta changes (config, migrations)
4. Verification: Regression test case
