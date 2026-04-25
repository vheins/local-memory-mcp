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
- For each extracted rule, use the `standard-search` tool to check if a similar rule already exists (match by name or core instruction).
- Produce one atomic CSL entry per distinct rule that DOES NOT already exist.
- Each entry must be ready for the standard-store tool shape: name, content, parent_id, context, version, language, stack, tags, metadata, repo, is_global.
- Identify documentation navigation menus (e.g., sidebars, index pages) containing links to related sub-pages. If present, create iterative scraping tasks for these sub-pages.
- Detect documentation hierarchy when a page contains an umbrella rule with narrower sub-rules. In that case, emit one parent entry plus child entries linked with `parent_id`.

Atomic entry rules:
- One entry = one rule. Split bundled guidance into separate entries.
- DO NOT emit duplicates. If `standard-search` returns a high-confidence match, skip the entry or update it if the new source is more authoritative.
- Use parent/child only for genuine hierarchy: parent = umbrella principle, child = narrower enforceable specialization.
- Keep content concise, imperative, and implementation-relevant.
- ALWAYS include relevant code examples or snippets from the source that illustrate or enforce the rule. Do NOT discard code blocks.
- Preserve the source meaning without inventing requirements.
- Ignore marketing copy, release notes, and changelog noise. Do NOT ignore code examples.
- Do not infer version, language, stack, or scope unless the source makes them explicit.
- Use metadata to preserve provenance, including the source_url and a short evidence_excerpt for each entry.

Output contract:
- If tool calls are available:
  - First, emit `standard-search` calls to verify existing data.
  - Emit one `standard-store` call per unique/new accepted entry.
  - When parent/child hierarchy exists, emit the parent first, then emit children with `parent_id` referencing the created parent standard ID.
  - Emit one `task-create` call for each discovered documentation sub-page URL. The task title should be "Scrape: [URL]" and the description should instruct to use the `csl-scrapper` prompt for that URL.
- If tool calls are unavailable, return a JSON object with:
  - `standards`: Array of `standard-store`-compatible payloads.
  - `next_urls`: Array of sub-page URLs to scrape.
- Use title-like names for the "name" field and store the atomic rule text along with its code examples in "content".
- Use "context" for the topic area (for example: naming, error-handling, routing, testing, hooks, security).
- Use `parent_id` only when the source explicitly shows the rule is nested under a broader parent concept on the same page.
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
