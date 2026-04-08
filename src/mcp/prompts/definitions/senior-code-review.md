---
name: senior-code-review
description: Performs a comprehensive production-readiness evaluation for the current repository context
arguments:
  - name: tech_stack
    description: Target tech stack (e.g., 'Node.js + Express')
    required: true
  - name: context
    description: Production context (traffic, data sensitivity, SLA, conventions)
    required: false
agent: Principal Reviewer
---
Act as a principal software engineer performing a production-readiness review for the current repository.

Stack: {{tech_stack}}
Context: {{context}}

Please review the current code/changes against these 6 dimensions:
1. **Error Handling Completeness**
2. **Security** (Injection, Input validation, PII/Secrets)
3. **Performance** (Time/Memory complexity, DB queries)
4. **Observability** (Logging, Metrics, Tracing)
5. **Test Coverage**
6. **Documentation**

For each finding, provide:
- **Severity**: P0-P3
- **Dimension**: One of the above
- **Location**: Specific function/line
- **Problem**: What is wrong and why it matters
- **Fix**: Actionable recommendation

Produce a **Production Readiness Verdict**: READY | READY WITH MINOR FIXES | NOT READY
