---
name: root-cause-analysis
description: 5-Why analysis to trace bug origins.
arguments:
  - name: tech_stack
    description: Target tech stack. Optional — auto-detected from repo/context if omitted.
    required: false
  - name: bug_description
    description: Bug behavior. Optional — inferred from active task or recent conversation if omitted.
    required: false
  - name: symptoms
    description: Logs, errors, metrics.
    required: false
agent: Diagnostic Lead
---
## 0. CONTEXT RESOLUTION
- **tech_stack**: If provided, use directly. If omitted — detect from repo package files or active task tags.
- **bug_description**: If provided, use directly. If omitted — extract from active task description or recent error/log context.
- **symptoms**: Optional. Use if provided; otherwise infer from available logs or error traces.

Conduct root cause analysis for the active repository bug.

Output:
1. **Symptom**: Technical problem restatement.
2. **5-Whys**: Causal chain from symptom to core failure.
3. **Root Cause**: "The root cause is [X] because [Y], allowing [Z]."
4. **Recommendation**: Fix addressing root cause.
5. **Prevention**: Monitoring/testing measure.
