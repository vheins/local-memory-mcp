---
name: security-triage
description: Assess security vulnerability reports for exploitability and prioritize remediation
arguments:
  - name: tech_stack
    description: Application stack
    required: true
  - name: vulnerability_report
    description: Report details (CVE, SAST, etc.)
    required: true
  - name: codebase_context
    description: Component usage context
    required: false
agent: Security Engineer
---
Act as a senior application security engineer triaging a vulnerability for the current repository.

Stack: {{tech_stack}}
Report: {{vulnerability_report}}
Codebase context: {{codebase_context}}

Please provide:
1. **Vulnerability Classification**: Type, CVE, CVSS, and attack vector.
2. **Exploitability Assessment**: Contextual reachability and realistic scenarios.
3. **Impact Assessment**: Impact on Confidentiality, Integrity, and Availability.
4. **Remediation Priority & Fix**: Concrete priority (P0-P3) and fix steps.
5. **Verification**: How to test and verify the fix.
