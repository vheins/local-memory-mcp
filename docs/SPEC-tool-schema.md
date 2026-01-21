# Spec – MCP Tool Schema & Validation

## Purpose

Dokumen ini mendefinisikan tool schema final + aturan validasi untuk MCP Local Memory Server.

**Fokus dokumen ini:**
- Kontrak tool yang stabil & agent-safe
- Validasi ketat untuk mencegah memory pollution
- Konsisten dengan skeleton server & git scope resolver

> *Prinsip: tolak request buruk lebih awal. Memory jelek lebih berbahaya daripada tidak ada memory.*

---

## Design Principles

1. **Schema-first** – logic mengikuti schema, bukan sebaliknya
2. **Fail fast** – invalid input langsung reject
3. **Repo-scoped by default**
4. **Minimal surface area**

---

## Shared Types

```typescript
type MemoryType = "code_fact" | "decision" | "mistake" | "pattern";

type MemoryScope = {
  repo: string;
  branch?: string;
  folder?: string;
  language?: string;
};
```

---

## Tool: `memory.store`

**Purpose:**
Menyimpan memory baru yang berdampak jangka panjang.

**Input Schema:**
```typescript
{
  type: MemoryType;
  content: string;
  importance: number;      // 1–5
  scope: MemoryScope;
}
```

**Validation Rules (WAJIB):**
- `content.length >= 10`
- `importance` antara 1–5
- `scope.repo` **REQUIRED** & non-empty
- `content` **tidak boleh**:
    - pertanyaan
    - speculative language ("mungkin", "kayaknya")

**Semantic Guardrails:**
- Tolak jika `content` mengandung:
    - brainstorming
    - diskusi sementara
    - opini subjektif

---

## Tool: `memory.update`

**Purpose:**
Update memory yang sudah ada.

**Input Schema:**
```typescript
{
  id: string;              // uuid
  content?: string;
  importance?: number;
}
```

**Validation Rules:**
- `id` **REQUIRED**
- Minimal 1 field selain id
- Update tidak boleh mengubah `scope.repo`

---

## Tool: `memory.search`

**Purpose:**
Mencari memory relevan untuk augment prompt.

**Input Schema:**
```typescript
{
  query: string;
  repo: string;
  types?: MemoryType[];
  minImportance?: number;
  limit?: number;          // default 5
}
```

**Validation Rules:**
- `query.length >= 3`
- `repo` **REQUIRED**
- `limit` max 10

**Behavioral Rules:**
- Repo mismatch → **reject**
- No global search

---

## Tool: `memory.summarize`

**Purpose:**
Update antigravity summary per repo.

**Input Schema:**
```typescript
{
  repo: string;
  signals: string[];
}
```

**Validation Rules:**
- `repo` **REQUIRED**
- `signals.length >= 1`
- Setiap signal max 200 chars

---

## Zod Validation Example

```typescript
import { z } from "zod";

export const MemoryStoreSchema = z.object({
  type: z.enum(["code_fact", "decision", "mistake", "pattern"]),
  content: z.string().min(10),
  importance: z.number().min(1).max(5),
  scope: z.object({
    repo: z.string().min(1),
    branch: z.string().optional(),
    folder: z.string().optional(),
    language: z.string().optional()
  })
});
```

---

## Tool Registration (`router.ts`)

```typescript
case "tools/list":
  return {
    tools: [
      { name: "memory.store", inputSchema: MemoryStoreSchema },
      { name: "memory.search", inputSchema: MemorySearchSchema },
      { name: "memory.update", inputSchema: MemoryUpdateSchema },
      { name: "memory.summarize", inputSchema: MemorySummarizeSchema }
    ]
  };
```

---

## Error Strategy (Opinionated)

- Validation error → `-32602 Invalid params`
- Scope missing → **hard error**
- Silent fallback → **DILARANG**

---

## Anti-Patterns (DILARANG)

- ❌ Auto-coerce input
- ❌ Infer repo implicitly in search
- ❌ Store memory without scope
- ❌ Accept vague content

---

## Final Take

Tool schema adalah kontrak moral antara agent dan memory.

**Kalau schema ini dijaga ketat:**
- Memory tetap bersih
- Agent makin konsisten
- Antigravity benar-benar terasa

Ini fondasi sebelum masuk ke SQLite & vector DB.
