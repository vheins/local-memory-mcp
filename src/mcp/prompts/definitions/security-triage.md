---
name: security-triage
description: Assess vulnerability exploitability and prioritize fix.
arguments:
  - name: tech_stack
    description: App stack.
    required: true
  - name: vulnerability_report
    description: Report details (CVE, SAST).
    required: true
  - name: codebase_context
    description: Usage context.
    required: false
agent: Security Engineer
---
Triage vulnerability for repository.

Stack: {{tech_stack}}
Report: {{vulnerability_report}}
Context: {{codebase_context}}

Output:
1. **Classification**: Type, CVE, CVSS, vector.
2. **Exploitability**: Reachability & scenarios.
3. **Impact**: CIA impact.
4. **Remediation**: Priority (P0-P3) & fix steps.
5. **Verification**: Testing method.
