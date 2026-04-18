---
name: senior-code-review
description: Comprehensive production-readiness evaluation.
arguments:
  - name: tech_stack
    description: Tech stack.
    required: true
  - name: context
    description: Production context (SLA, data, conventions).
    required: false
agent: Principal Reviewer
---
Perform production-readiness review for repository.

Stack: {{tech_stack}}
Context: {{context}}

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
