---
name: csl-scrapper
description: Scrape trusted documentation from a URL into atomic CSL coding standards entries.
arguments:
  - name: source_url
    description: Canonical URL for the documentation source to scrape.
    required: true
agent: Documentation Scraper
category: workflows
version: "1.0.0"
tags: [workflow, csl, scraping, coding-standards, mcp]
---

## CSL Scrapper

Entry=G0 → S0 → G1 → S1 → S2 → S3 → S4 → S5 Exit=stored|refused
Guard: S(N) req S(N-1)✅

G0 | source_url provided? | source_url arg exists? | → S0 / refuse | —
S0 | fetch via web_fetch | G0✅ | raw doc | —
G1 | content reachable + normative? | S0✅ | → S1 / refuse | —
S1 | extract atomic rules: 1 entry=1 rule, keep code examples, detect nav menus for sub-pages, ignore marketing/release notes, preserve source meaning | S0✅ | atomic entries, sub-page URLs | —
S2 | dedup via standard-search (skip if high-confidence match; update if new source more authoritative) | S1✅ | filtered entries | —
S3 | store via standard-store: parent first→children with parent_id; context=topic area; version=1.0.0(default); is_global=true(unless repo-specific); metadata={source_url, evidence_excerpt} | S2✅ | CSL entries stored | —
S4 | create scrape tasks for each sub-page URL via task-create | sub-page URLs exist? | MCP tasks queued | —
S5 | verify: confirm stored entries match extracted count, validate parent/child linkage, verify sub-page tasks created | S4✅ | verified | —

## Atomic Entry Rules

- One entry = one rule. Split bundled guidance into separate entries.
- DO NOT emit duplicates. If standard-search returns a high-confidence match, skip the entry or update it if the new source is more authoritative.
- Use parent/child only for genuine hierarchy: parent = umbrella principle, child = narrower enforceable specialization.
- Keep content concise, imperative, and implementation-relevant.
- ALWAYS include relevant code examples or snippets from the source that illustrate or enforce the rule.
- Preserve the source meaning without inventing requirements.
- Ignore marketing copy, release notes, and changelog noise. Do NOT ignore code examples.
- Do not infer version, language, stack, or scope unless the source makes them explicit.
- Use metadata to preserve provenance, including the source_url and a short evidence_excerpt for each entry.

## Output Contract

- If tool calls are available:
  - First, emit standard-search calls to verify existing data.
  - Emit one standard-store call per unique/new accepted entry.
  - When parent/child hierarchy exists, emit the parent first, then emit children with parent_id referencing the created parent standard ID.
  - Emit one task-create call for each discovered documentation sub-page URL. Task title: "Scrape: [URL]".
- If tool calls are unavailable, return a JSON object with:
  - standards: Array of standard-store-compatible payloads.
  - next_urls: Array of sub-page URLs to scrape.
- Use title-like names for the name field and store the atomic rule text along with its code examples in content.
- Use context for the topic area (e.g., naming, error-handling, routing, testing, hooks, security).
- Use parent_id only when the source explicitly shows the rule is nested under a broader parent concept.
- Default version to 1.0.0 only when the source gives no versioning signal.
- Prefer is_global=true unless the source is clearly repo-specific.

## Refusal Rules

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

Source: {{source_url}} Owner: {{current_owner}} Repo: {{current_repo}}
