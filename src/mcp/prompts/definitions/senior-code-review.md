---
name: senior-code-review
description: Comprehensive production-readiness evaluation.
arguments:
  - name: tech_stack
    description: Tech stack. Optional — auto-detected from repo package files, language, or active task tags if omitted.
    required: false
  - name: context
    description: Production context (SLA, data, conventions).
    required: false
agent: Principal Reviewer
---
## 0. CONTEXT RESOLUTION
- **tech_stack**: If provided, use directly. If omitted — detect from repo package files or language.
- **context**: Optional. Use if provided; otherwise infer from task description or recent conversation.

Perform production-readiness review for the active repository.

Audit Dimensions:
1. **Errors**: Completeness & patterns.
2. **Security**: Validation, injection, secrets.
3. **Performance**: Complexity, DB efficiency.
4. **Observability**: Logs, metrics, traces.
5. **Testing**: Coverage & quality.
6. **Docs**: Clarity & accuracy.

Output per Finding:
- **Severity**: P0-P3.
- **Problem**: What & why.
- **Location**: Path/function.
- **Fix**: Actionable step.

Verdict: READY | READY WITH MINOR FIXES | NOT READY
