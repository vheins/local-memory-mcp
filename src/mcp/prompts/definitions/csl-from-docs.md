---
name: csl-from-docs
description: Create atomic CSL coding standards entries from a local file or directory path.
arguments:
  - name: path
    description: Local path (file or directory) containing documentation or standards.
    required: true
agent: Documentation Processor
category: workflows
version: "1.0.0"
tags: [workflow, csl, coding-standards, documentation, mcp]
---

## CSL from Docs

Entry=G0 → S0 → S1 → S2 → S3 → S4 Exit=stored|refused
Guard: S(N) req S(N-1)✅

G0 | path exists + readable + normative? | path provided? | → S0 / refuse | —
S0 | discover: if dir→list_directory then read_file each; if file→read_file | G0✅ | raw content | —
S1 | extract atomic rules: 1 entry=1 rule, keep code examples, split bundled, preserve source meaning, ignore boilerplate | S0✅ | atomic entries | —
S2 | dedup via standard-search (skip if high-confidence match; update if new source more authoritative) | S1✅ | filtered entries | —
S3 | store via standard-store: parent first→children with parent_id; context=topic area; version=1.0.0(default); is_global=true(unless repo-specific); metadata={original_path, evidence_excerpt} | S2✅ | CSL entries stored | —
S4 | verify: confirm stored count matches extracted, validate parent/child linkage, check metadata provenance | S3✅ | verified | —

## Atomic Entry Rules

- One entry = one rule. Split bundled guidance into separate entries.
- DO NOT emit duplicates. If standard-search returns a high-confidence match, skip the entry or update it if the new source is more authoritative.
- Use parent/child only for genuine hierarchy: parent = umbrella principle, child = narrower enforceable specialization.
- Keep content concise, imperative, and implementation-relevant.
- ALWAYS include relevant code examples or snippets from the source that illustrate or enforce the rule.
- Preserve the source meaning without inventing requirements.
- Ignore boilerplate, non-normative text, or metadata noise. Do NOT ignore code examples.
- Do not infer version, language, stack, or scope unless the source makes them explicit.
- Use metadata to preserve provenance, including the original file path and a short evidence_excerpt for each entry.

## Output Contract

- If tool calls are available:
  - First, emit standard-search calls to verify existing data.
  - Then, emit standard-store calls for every unique/new accepted entry.
  - When parent/child hierarchy exists, emit the parent first, then emit children with parent_id referencing the created parent standard ID.
- If tool calls are unavailable, return a JSON object with:
  - standards: Array of standard-store-compatible payloads.
- Use title-like names for the name field and store the atomic rule text along with its code examples in content.
- Use context for the topic area (e.g., naming, error-handling, routing, testing, hooks, security).
- Default version to 1.0.0 only when the source gives no versioning signal.
- Prefer is_global=true unless the content is clearly repo-specific.

## Refusal Rules

- Refuse when the path does not exist or is not readable.
- Refuse when the file content is not documentation or not clearly normative reference content.
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

Path: {{path}} Owner: {{current_owner}} Repo: {{current_repo}}
