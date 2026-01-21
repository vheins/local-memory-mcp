# Spec – SQLite Schema & Migration

## Purpose

Dokumen ini mendefinisikan skema SQLite final untuk MCP Local Memory Server.

**Fokus utama:**
- Skema tahan lama & mudah di-migrate
- Selaras dengan tool schema, git scope, dan heuristics
- Siap dipakai dengan atau tanpa vector DB

> *Prinsip: SQLite adalah source of truth. Vector hanyalah index.*

---

## Design Principles

1. **Append-friendly** (mudah evolve)
2. **Readable** (debug via sqlite CLI masih masuk akal)
3. **Strict schema** (hindari JSON berlebihan)
4. **Repo-scoped by design**

---

## Database File

`storage/memory.db`

Single file, local-only.

---

## Table: `memories`

**Purpose:**
Menyimpan semua long-term memory berkualitas tinggi.

**Schema:**
```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'code_fact',
    'decision',
    'mistake',
    'pattern'
  )),
  content TEXT NOT NULL,
  importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
  folder TEXT,
  language TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Notes:**
- `repo` adalah **hard boundary**
- `content` adalah canonical text (untuk embedding)
- Jangan simpan JSON besar di sini

---

## Indexes (WAJIB)

```sql
CREATE INDEX idx_memories_repo ON memories(repo);
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_importance ON memories(importance);
```

*Index ini cukup untuk tahap awal.*

---

## Table: `memory_summary`

**Purpose:**
Antigravity snapshot per repo.

**Schema:**
```sql
CREATE TABLE memory_summary (
  repo TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## Optional Table: `memory_embeddings`

> *Opsional – hanya jika embedding tidak disimpan inline.*

```sql
CREATE TABLE memory_embeddings (
  memory_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
```

*Jika pakai sqlite-vector extension, table ini bisa diganti.*

---

## Migration Strategy

### v1 – Initial

```sql
-- 001_init.sql
BEGIN;

-- memories table
CREATE TABLE memories (...);
CREATE INDEX ...;

-- summary table
CREATE TABLE memory_summary (...);

COMMIT;
```

### Rules
- Tidak ada destructive migration di awal
- Tambah kolom → nullable
- Jangan rename kolom (add new instead)

---

## Insert Example

```sql
INSERT INTO memories (
  id, repo, type, content, importance, created_at, updated_at
) VALUES (
  'uuid',
  'my-repo',
  'decision',
  'Do not use ORM; raw SQL only',
  5,
  datetime('now'),
  datetime('now')
);
```

---

## Query Patterns

### By Repo (most common)

```sql
SELECT * FROM memories
WHERE repo = ?
ORDER BY importance DESC, created_at DESC
LIMIT 5;
```

---

## What NOT to Store

- ❌ Chat logs
- ❌ Prompt history
- ❌ Temporary task state
- ❌ Vector-only data without text

---

## Final Take

Skema ini sengaja tidak kompleks.

**Kalau kamu disiplin di schema & heuristics:**
- SQLite akan cukup lama
- Vector DB bisa ditambah belakangan
- Memory tetap bersih & bernilai tinggi

Ini fondasi terakhir sebelum masuk ke vector search.
