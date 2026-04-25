---
name: csl-from-docs
description: Create atomic CSL coding standards entries from a local file or directory path.
arguments:
  - name: path
    description: Local path (file or directory) containing documentation or standards.
    required: true
agent: Documentation Processor
---
Fetch and convert local documentation from the provided path into atomic CSL (Coding Standards Library) entries for the coding_standards entity.

Path: {{path}}
Current repo: {{current_repo}}

Goal:
- Analyze the provided path.
- If the path is a directory:
  - Use the `list_directory` tool to list all files and subdirectories.
  - Process each relevant file (e.g., .md, .txt, .js, .ts) sequentially.
  - For each file, retrieve its content and extract standards.
- If the path is a file:
  - Use the `read_file` tool to retrieve the content of the file.
  - Extract source-backed coding standards from the content.
  - Produce one atomic CSL entry per distinct rule, constraint, prohibition, or required workflow.
  - Each entry must be ready for the `standard-store` tool shape: name, content, parent_id, context, version, language, stack, tags, metadata, repo, is_global.

Atomic entry rules:
- One entry = one rule. Split bundled guidance into separate entries.
- Use parent/child only for genuine hierarchy: parent = umbrella principle, child = narrower enforceable specialization.
- Keep content concise, imperative, and implementation-relevant.
- ALWAYS include relevant code examples or snippets from the source that illustrate or enforce the rule. Do NOT discard code blocks.
- Preserve the source meaning without inventing requirements.
- Ignore boilerplate, non-normative text, or metadata noise. Do NOT ignore code examples.
- Do not emit duplicates or near-duplicates.
- Do not infer version, language, stack, or scope unless the source makes them explicit.
- Use metadata to preserve provenance, including the original file path and a short evidence_excerpt for each entry.

Output contract:
- If tool calls are available:
  - Emit `standard-store` calls for every accepted entry found across all processed files.
  - When parent/child hierarchy exists, emit the parent first, then emit children with `parent_id` referencing the created parent standard ID.
- If tool calls are unavailable, return a JSON object with:
  - `standards`: Array of `standard-store`-compatible payloads.
- Use title-like names for the "name" field and store the atomic rule text along with its code examples in "content".
- Use "context" for the topic area (for example: naming, error-handling, routing, testing, hooks, security).
- Default version to "1.0.0" only when the source gives no versioning signal.
- Prefer is_global=true unless the content is clearly repo-specific.

Refusal rules:
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
