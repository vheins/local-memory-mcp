---
name: root-cause-analysis
description: 5-Why analysis to trace bug origins.
arguments:
  - name: tech_stack
    description: Target tech stack.
    required: true
  - name: bug_description
    description: Bug behavior.
    required: true
  - name: symptoms
    description: Logs, errors, metrics.
    required: false
agent: Diagnostic Lead
---
Conduct root cause analysis for repository bug.

Stack: {{tech_stack}}
Bug: {{bug_description}}
Symptoms: {{symptoms}}

Output:
1. **Symptom**: Technical problem restatement.
2. **5-Whys**: Causal chain from symptom to core failure.
3. **Root Cause**: "The root cause is [X] because [Y], allowing [Z]."
4. **Recommendation**: Fix addressing root cause.
5. **Prevention**: Monitoring/testing measure.
