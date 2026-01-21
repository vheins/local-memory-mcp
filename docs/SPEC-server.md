# MCP Local Memory Server – Skeleton Documentation

## Purpose

Dokumen ini mendefinisikan skeleton MCP server lokal (Node.js) yang:
- Kompatibel secara konsep dengan MCP Memory berbasis remote API
- Minimal tapi lengkap: resources, tools, prompts
- Siap dikembangkan ke SQLite + vector DB
- Dirancang untuk coding copilot & antigravity agent

Skeleton ini bukan full implementation, tapi contract + struktur agar:
- Agent tidak perlu diubah
- Remote MCP bisa diganti local MCP tanpa friction

---

## Design Principles

1. **Contract-first, storage-second**
2. **Agent-facing API harus stabil**
3. **Memory high-signal only**
4. **Strict project / git scoping**
5. **Local-first, no auth by default**

---

## Server Capabilities

```json
{
  "resources": { "list": true, "read": true, "templates": true },
  "tools": { "list": true, "call": true },
  "prompts": { "list": true, "get": true }
}
```

---

## Resources

### 1. `memory://index`
**Purpose:** Lightweight discovery index (metadata only).
**Contract:**
- Returns list of recent memory entries
- **MUST NOT** include full content
- Used for de-duplication & inspection

### 2. `memory://{id}`
**Purpose:** Read a single memory entry.
**Returned Fields:**
```typescript
{
  id: string
  type: "code_fact" | "decision" | "mistake" | "pattern"
  content: string
  importance: number
  scope: { repo: string }
  created_at: string
}
```

### 3. `memory://summary/{repo}`
**Purpose:** Antigravity snapshot per project / repo.
**Notes:**
- High-level only
- Used before any search

### 4. `schema://mcp`
**Purpose:** Machine-readable schema for tools, resources, prompts.

---

## Resource Templates

```json
[
  { "uriTemplate": "memory://index", "description": "Recent memory index (metadata only)" },
  { "uriTemplate": "memory://{id}", "description": "Read individual memory" },
  { "uriTemplate": "memory://summary/{repo}", "description": "Project summary" },
  { "uriTemplate": "schema://mcp", "description": "MCP schema" }
]
```

---

## Tools (Minimal Set)

> Tool names intentionally mirip secara semantik dengan remote MCP, tapi disederhanakan untuk local usage.

### 1. `memory.store`
Create a new memory entry.

**Input:**
```typescript
{
  type: "code_fact" | "decision" | "mistake" | "pattern"
  content: string
  importance: number
  scope: { repo: string, folder?: string, language?: string }
}
```
**Rules:**
- `repo` is **REQUIRED**
- No speculative or temporary info

### 2. `memory.update`
Update existing memory.

**Input:**
```typescript
{
  id: string
  content?: string
  importance?: number
}
```

### 3. `memory.search`
Semantic + filtered search.

**Input:**
```typescript
{
  query: string
  repo: string
  types?: ("code_fact" | "decision" | "mistake" | "pattern")[]
  minImportance?: number
  limit?: number
}
```
**Behavior:**
- Vector similarity search
- Repo match is **mandatory**

### 4. `memory.summarize`
Update antigravity summary.

**Input:**
```typescript
{
  repo: string
  signals: string[]
}
```

---

## Prompts

### 1. `memory-agent-core`
**Purpose:** Core behavioral contract.

> You are a coding copilot agent.
>
> You must:
> - Respect stored decisions and constraints
> - Avoid repeating known mistakes
> - Use memory only when relevant
>
> Memory is a source of truth, not a suggestion.

### 2. `memory-index-policy`
**Purpose:** Enforce strict memory discipline.

> Do not store:
> - Temporary discussions
> - Brainstorming
> - Subjective opinions
>
> Only store durable knowledge.

### 3. `tool-usage-guidelines`
**Purpose:** Prevent tool abuse.

> Only call memory.store when:
> - The information affects future behavior
> - The scope (repo) is clear
> - The memory will still matter later

---

## Git / Project Scoping (Hard Requirement)

### Rule
Every memory entry **MUST** include:
`scope.repo`

### Resolution Order
1. Git repository root
2. Project folder name

### Enforcement
- Search without repo → **reject**
- Store without repo → **reject**

*This prevents cross-project contamination.*

---

## Suggested Internal Folder Structure

```
mcp-memory-local/
├─ server.ts          # MCP JSON-RPC loop
├─ capabilities.ts    # static MCP contract
├─ tools/
│  ├─ store.ts
│  ├─ search.ts
│  └─ summarize.ts
├─ resources/
│  ├─ index.ts
│  └─ read.ts
├─ prompts/
│  └─ registry.ts
├─ storage/
│  ├─ sqlite.ts
│  └─ vectors.ts
└─ utils/
   └─ git-scope.ts
```

---

## Explicit Non-Goals (for Skeleton)

- ❌ Auth & tokens
- ❌ Organization-level scope
- ❌ Knowledge graph
- ❌ Audit & versioning
- ❌ Bulk operations

*These can be added later without breaking contract.*

---

## Final Note

Skeleton ini cukup kecil untuk dibangun cepat, tapi cukup kuat untuk:
- Menggantikan remote MCP
- Menjadi fondasi agent yang konsisten
- Menjaga antigravity behavior

Kalau kontrak ini dijaga, backend bisa berubah tanpa menyentuh agent.
