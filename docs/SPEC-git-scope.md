# Skeleton – Git / Project Scope Resolver

## Purpose

Dokumen ini mendefinisikan resolver scope project / git yang digunakan oleh MCP Local Memory Server.

**Resolver ini adalah komponen KRITIS untuk:**
- Mencegah memory lintas project tercampur
- Menjaga kualitas coding copilot
- Mendukung antigravity behavior

> *Jika resolver ini salah → memory system akan rusak perlahan.*

---

## Responsibility

**Git Scope Resolver bertugas untuk:**
1. Menentukan repo aktif saat agent bekerja
2. Menyediakan scope object yang konsisten
3. Menolak operasi memory tanpa scope jelas

**Resolver ini tidak:**
- Menyimpan memory
- Menentukan relevance
- Melakukan vector search

---

## Scope Resolution Strategy (Opinionated)

### Priority Order
1. **Explicit scope** dari client (jika ada)
2. **Git repository root** (via `.git`)
3. **Project folder name** (fallback)

**Jika SEMUA gagal → REJECT.**

---

## Scope Object (Canonical)

```typescript
export type MemoryScope = {
  repo: string            // REQUIRED
  branch?: string
  folder?: string
  language?: string
}
```

### Rules
- `repo` **wajib**
- `branch` **opsional** (tidak dipakai untuk search default)
- `folder` hanya jika decision lokal

---

## File Location

`utils/git-scope.ts`

---

## Implementation – `git-scope.ts`

```typescript
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export function resolveGitScope(cwd = process.cwd()) {
  // 1. Try git root
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();

    const repo = path.basename(root);

    let branch: string | undefined;
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        stdio: ["ignore", "pipe", "ignore"]
      })
        .toString()
        .trim();
    } catch {}

    return {
      repo,
      branch
    };
  } catch {}

  // 2. Fallback: project folder
  const fallback = path.basename(cwd);

  if (fallback) {
    return {
      repo: fallback
    };
  }

  throw new Error("Unable to resolve project scope (no git repo, no folder)");
}
```

---

## Enforcement Rules (WAJIB di Tool Layer)

### `memory.store`
```typescript
if (!scope?.repo) {
  throw new Error("Memory must be scoped to a repo");
}
```

### `memory.search`
```typescript
if (!repo) {
  throw new Error("Search requires repo scope");
}
```

---

## Agent Behavior Contract

**Agent:**
- **TIDAK BOLEH** menebak repo
- **TIDAK BOLEH** reuse memory lintas repo
- **HARUS** pass scope eksplisit atau implicit

**Jika resolver gagal:**
- Agent **HARUS** lanjut tanpa memory
- **BUKAN** fallback ke global memory

---

## Common Failure Modes (dan Kenapa Ini Penting)

- ❌ **Global memory fallback**
  - → Constraint project A bocor ke project B
- ❌ **Branch-based memory**
  - → Memory jadi rapuh & terfragmentasi
- ❌ **Silent failure**
  - → Agent pakai memory salah tanpa sadar

**Resolver ini mencegah semua itu.**

---

## Extension Points (Future, Not Now)

- Hash-based repo ID
- Multi-workspace support
- Manual override via env

*Semua bisa ditambah tanpa breaking contract.*

---

## Final Take

Git scope resolver adalah **seatbelt** untuk memory system.
Tidak terlihat, tapi menyelamatkan kamu dari kecelakaan serius di masa depan.
