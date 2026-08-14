# Coding Standards Vault

The Coding Standards Vault is a structured, searchable library of coding rules, conventions, and patterns that an agent should follow for a given project or tech stack. Unlike free-form memories, standards are first-class records with language/stack metadata and a parent–child hierarchy, so an agent can pull the right rule for the right language at the right moment.

> **Why it matters:** "Don't use `var`" only matters in JavaScript; "use Eloquent scopes" only matters in Laravel. Standards store that context and let the agent apply the correct rule instead of guessing.

---

## What Is It?

Three MCP tools manage standards:

- **`standard-write`** — create, bulk-create, or update a standard.
- **`standard-read`** — search, fetch a single standard, or list/filter standards.
- **`standard-delete`** — delete one or many standards (with KG cleanup).

A standard is a typed rule record with: `name`, `content`, `parent_id` (hierarchy), `context` (where it applies), `version`, `language`, `stack`, `is_global`, `tags`, `metadata` (non-empty), and `agent` / `model` attribution.

---

## How It Works

### Write modes (auto-inferred)

`standard-write` picks the operation from the fields you send:

- `standards: [...]` → **BULK** create.
- `id` / `code` + any fields → **UPDATE**.
- `name` + `content` + `tags` + `metadata` → **CREATE** (single).

### Conflict guard (stricter than memory)

When creating, the server checks semantic overlap against existing standards and rejects content above **0.82 cosine similarity** (`STANDARD_CONFLICT_THRESHOLD` — stricter than memory's 0.85). Update the matching standard instead of duplicating it.

### Scoping: language, stack, global

Standards are scoped three ways:

- **Per-repo** — tied to a `repo` (and `owner`).
- **By language / stack** — `language` (e.g. `php`) and `stack` (e.g. `["laravel", "filament"]`) so the right rule surfaces for the current file.
- **Global** — `is_global: true` applies everywhere.

### Read modes (auto-inferred)

- `query` present → **SEARCH** (hybrid vector + keyword; recency half-life is 180 days for standards — they age slower than memories).
- `id` / `code` / `ids` / `codes` → **DETAIL** (single or bulk).
- no discriminator → **LIST**, grouped by language and filterable by `context`, `version`, `language`, `stack`, `tags`, `is_global`, and `repo`.

### Hierarchy

`parent_id` lets you model a standard as a child of another (e.g. a project rule under a global policy). Reads return the chain so the agent sees both the specific and the general rule.

---

## MCP Usage

Create a language-scoped coding standard:

```json
{
	"method": "tools/call",
	"params": {
		"name": "standard-write",
		"arguments": {
			"name": "Prefer Eloquent scopes over raw queries",
			"content": "Use query scopes / query builder on models instead of DB::select() for reusable, testable filters.",
			"context": "All Laravel model data access",
			"language": "php",
			"stack": ["laravel", "filament"],
			"tags": ["eloquent", "db"],
			"metadata": { "severity": "must", "source": "team-style-guide" },
			"owner": "vheins",
			"repo": "local-memory-mcp"
		}
	}
}
```

Search standards for the current stack:

```json
{
	"method": "tools/call",
	"params": {
		"name": "standard-read",
		"arguments": { "query": "database access", "stack": ["laravel"], "owner": "vheins", "repo": "local-memory-mcp" }
	}
}
```

---

## Dashboard Usage

Open the **Standards** tab. Standards are listed grouped by language with their tags, context, and scope. Click a standard for full content. This tab is read-only for editing — create and update standards through `standard-write`.

---

## Tips & Limitations

- **`metadata` must be non-empty** — a standard with no metadata is rejected; use it for severity, source, or enforcement notes.
- **Conflict rejection at 0.82** is stricter than memory — keep standards distinct and update in place rather than re-adding near-duplicates.
- **Language/stack drive recall** — always set `language` and `stack` so the rule surfaces for the matching file; a missing language makes the standard repo-scoped only.
- **`is_global` is powerful but blunt** — a global standard applies to every repo; prefer repo/language scope unless the rule is truly universal.
- **Standards age slowly** — the recency half-life is 180 days, so older standards still rank; archive or update stale ones rather than relying on decay.
