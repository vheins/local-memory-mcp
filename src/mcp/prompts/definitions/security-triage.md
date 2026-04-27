---
name: security-triage
description: Assess vulnerability exploitability and prioritize fix.
arguments:
  - name: tech_stack
    description: App stack. Optional — auto-detected from repo/context if omitted.
    required: false
  - name: vulnerability_report
    description: Report details (CVE, SAST). Optional — extracted from active task description or recent conversation if omitted.
    required: false
  - name: codebase_context
    description: Usage context.
    required: false
agent: Security Engineer
---
## 0. CONTEXT RESOLUTION
- **tech_stack**: If provided, use directly. If omitted — detect from repo package files, language, or active task tags.
- **vulnerability_report**: If provided, use directly. If omitted — extract from active task description, recent conversation, or attached SAST output.
- **codebase_context**: Optional. Use if provided.

Triage the resolved vulnerability for the active repository.

Output:
1. **Classification**: Type, CVE, CVSS, vector.
2. **Exploitability**: Reachability & scenarios.
3. **Impact**: CIA impact.
4. **Remediation**: Priority (P0-P3) & fix steps.
5. **Verification**: Testing method.
