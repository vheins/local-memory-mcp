# Test Scenarios – MCP Local Memory

## Purpose

Dokumen ini berisi test scenarios konseptual & praktis untuk memverifikasi bahwa MCP Local Memory:
- Menyimpan memory yang benar
- Menolak memory yang buruk
- Tidak bocor lintas repo
- Mendukung antigravity behavior

*Test ini bukan unit test code, tapi behavioral contract test untuk agent + MCP server.*

---

## Test Category Overview

1. **Memory Quality** (Good vs Bad)
2. **Repo / Git Scoping**
3. **Auto-Memory Heuristics**
4. **Vector & Fallback Behavior**
5. **Antigravity Consistency**

---

## 1. Memory Quality Tests

### 1.1 GOOD – Architectural Decision
**Context:** Repo `backend-api`

**User:**
> "Kita tidak akan pakai ORM di project ini, semua query pakai raw SQL."

**Expected Agent Behavior:**
- Detect as `decision`
- `importance = 5`
- `scope.repo = backend-api`
- Call `memory.store`

**Expected Stored Memory:**
```
Type: decision
Content: Do not use ORM; use raw SQL for all database access
```

### 1.2 BAD – Temporary Discussion
**User:**
> "Coba dulu pakai cara ini, nanti lihat hasilnya."

**Expected Behavior:**
- ❌ **DO NOT** store memory
- Continue task without memory

### 1.3 BAD – Opinion Only
**User:**
> "Menurutku style ini lebih enak dibaca."

**Expected Behavior:**
- ❌ **DO NOT** store memory

---

## 2. Repo / Git Scope Tests

### 2.1 GOOD – Same Repo Retrieval
**Repo:** `frontend-app`

**Existing Memory:**
`decision: Use React Query for data fetching`

**User Prompt:**
> "Buatkan hook untuk fetch user profile"

**Expected Behavior:**
- `memory.search` with `repo = frontend-app`
- Inject React Query constraint

### 2.2 BAD – Cross Repo Leakage
**Repo A:** `backend-api`
**Repo B:** `frontend-app`

**Existing Memory (Repo A):**
`decision: Do not use ORM`

**User Prompt (Repo B):**
> "Setup database access"

**Expected Behavior:**
- ❌ Memory from Repo A **NOT** retrieved

---

## 3. Auto-Memory Heuristics Tests

### 3.1 GOOD – Repeated Correction
**Agent Output:**
Uses default export

**User Correction:**
> "Jangan pakai default export di domain layer."

**Expected Behavior:**
- Detect as `mistake`
- Store memory after confirmation

### 3.2 BAD – Single Minor Correction
**User:**
> "Yang ini ganti nama variabel aja."

**Expected Behavior:**
- ❌ **DO NOT** store memory

---

## 4. Vector & Fallback Tests

### 4.1 Typo Tolerance
**Stored Memory:**
`decision: Do not use ORM`

**User Query:**
> "Jangan pake ormm ya"

**Expected Behavior:**
- `normalize(query)`
- `memory.search` returns `decision`

### 4.2 Vector Failure Fallback
**Condition:**
Vector index unavailable

**Expected Behavior:**
- Fallback to SQLite keyword search
- Agent still works

---

## 5. Antigravity Consistency Tests

### 5.1 Long Session Drift Prevention
**Day 1:**
Decision stored: `Use clean architecture`

**Day 5 User Prompt:**
> "Buat handler cepat aja tanpa layer ribet"

**Expected Behavior:**
- Agent retrieves decision
- Push back politely
- Follow clean architecture

### 5.2 Summary Usage
**Condition:**
`memory_summary` exists for repo

**Expected Behavior:**
- Agent reads summary **BEFORE** `memory.search`
- Uses summary to guide reasoning

---

## Failure Signals (Red Flags)

- 🚨 Memory count grows rapidly
- 🚨 Agent output inconsistent day-to-day
- 🚨 Same correction repeated often
- 🚨 Cross-project rules applied

*Jika muncul → heuristics atau scope resolver salah.*

---

## Final Take

Kalau semua test ini lulus:
- Memory kamu bersih
- Agent kamu stabil
- Antigravity behavior nyata

Test ini sebaiknya dijalankan manual di awal, lalu dijadikan automated regression tests.
