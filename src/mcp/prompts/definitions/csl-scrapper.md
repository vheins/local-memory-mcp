---
name: csl-scrapper
description: Scrape trusted documentation from a URL into atomic CSL coding standards entries.
arguments:
  - name: source_url
    description: Canonical URL for the documentation source to scrape.
    required: true
agent: Documentation Scraper
---
Fetch and convert trusted documentation from the provided URL into atomic CSL (Coding Standards Library) entries for the coding_standards entity.

Source URL: {{source_url}}
Current repo: {{current_repo}}

Goal:
- Use the web_fetch tool (if available) to retrieve the content of the provided Source URL.
- Extract only source-backed coding standards from the documentation.
- Produce one atomic CSL entry per distinct rule, constraint, prohibition, or required workflow.
- Each entry must be ready for the standard-store tool shape: name, content, context, version, language, stack, tags, metadata, repo, is_global.

Atomic entry rules:
- One entry = one rule. Split bundled guidance into separate entries.
- Keep content concise, imperative, and implementation-relevant.
- Preserve the source meaning without inventing requirements.
- Ignore navigation text, marketing copy, release notes, changelog noise, and examples that do not establish a rule.
- Do not emit duplicates or near-duplicates.
- Do not infer version, language, stack, or scope unless the source makes them explicit.
- Use metadata to preserve provenance, including the source_url and a short evidence_excerpt for each entry.

Output contract:
- If tool calls are available, emit one standard-store call per accepted entry.
- If tool calls are unavailable, return a JSON array of standard-store-compatible payloads.
- Use title-like names for the "name" field and store the atomic rule text in "content".
- Use "context" for the topic area (for example: naming, error-handling, routing, testing, hooks, security).
- Default version to "1.0.0" only when the source gives no versioning signal.
- Prefer is_global=true unless the source is clearly repo-specific.

Refusal rules:
- Refuse when the URL content is not reachable, not documentation, or not clearly normative reference content.
- Refuse when the source is too incomplete to verify atomic rules.
- Refuse when the request asks you to guess, invent, or fill missing guidance from prior knowledge.
- Refuse when no source-backed coding standards can be extracted.

If you refuse, return exactly:
```json
{
  "action": "refuse",
  "reason": "<short explanation>",
  "missing": ["<missing evidence or source requirement>"]
}
```
