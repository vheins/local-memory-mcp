# Spec – Auto-Memory Heuristics & Scoping

## Purpose

Dokumen ini mendefinisikan aturan resmi kapan agent **BOLEH** dan **TIDAK BOLEH** menyimpan memory ke MCP Local Memory Service, serta bagaimana memory di-scope ke project / git repository aktif.

**Tujuan utama:**
- Menjaga kualitas memory (high-signal only)
- Mencegah memory pollution
- Mendukung antigravity behavior
- Membuat agent konsisten lintas sesi

---

## Core Principle (WAJIB Dipatuhi)

1. **Memory adalah commit, bukan log**
2. **Lebih baik tidak menyimpan apa-apa daripada menyimpan memory buruk**
3. **Agent tidak menyimpan memory untuk dirinya sendiri, tapi untuk future agent**
4. **Memory selalu ter-scope ke konteks kerja aktif**

---

## Active Project / Git Scope

### Definisi
"Active Project" adalah project / repository tempat agent sedang bekerja saat ini.

**Scope diturunkan dari:**
- Git repository root (preferred)
- Project folder (fallback)

### Scope Object (WAJIB)
```json
scope: {
  repo: string,       // git repo name atau hash
  branch?: string,    // opsional
  language?: string,  // ts, js, go, dll
  folder?: string     // jika decision lokal
}
```

### Hard Rules
- ❌ Memory **TANPA** repo **DILARANG**
- ❌ Memory lintas repo **TIDAK BOLEH** digabung
- ✅ Memory hanya dipakai jika repo cocok

*Ini mencegah agent mencampur constraint antar project.*

---

## Memory Types & Eligibility Rules

### 1. decision
**Definisi:** Keputusan desain / arsitektur yang berdampak jangka panjang.

**Boleh Disimpan Jika:**
- User menyatakan keputusan eksplisit
- Ada tradeoff yang disepakati
- Keputusan memengaruhi future code

**Contoh Valid:**
- "Kita tidak pakai ORM di project ini"
- "Semua handler harus pure function"

**Contoh Tidak Valid:**
- "Aku prefer cara ini aja"

**Default Importance:** `importance = 5`

### 2. mistake
**Definisi:** Kesalahan yang dikoreksi dan tidak boleh diulang.

**Boleh Disimpan Jika:**
- User mengoreksi agent
- Kesalahan terjadi lebih dari sekali
- User bilang "jangan lakukan ini lagi"

**Contoh Valid:**
- "Jangan pakai default export di domain"
- "Ini bug karena async tidak di-await"

**Default Importance:** `importance = 4`

### 3. code_fact
**Definisi:** Fakta stabil tentang codebase.

**Boleh Disimpan Jika:**
- Fakta bersifat objektif
- Tidak tergantung task

**Contoh Valid:**
- "Project ini pakai clean architecture"
- "Validasi pakai zod"

**Default Importance:** `importance = 3`

### 4. pattern
**Definisi:** Pola implementasi berulang.

**Boleh Disimpan Jika:**
- Pola muncul ≥ 2 kali
- Pola disetujui user atau implicit standard

**Contoh Valid:**
- Struktur controller
- Cara error handling

**Default Importance:** `importance = 2`

---

## Auto-Memory Triggers

Agent **BOLEH** mempertimbangkan menyimpan memory jika mendeteksi salah satu sinyal berikut:

### Explicit User Signals
- "ingat ini"
- "ke depannya"
- "jangan ulangi"
- "selalu lakukan seperti ini"

### Implicit Signals
- Correction berulang
- Constraint eksplisit (must / never)
- Architecture-level instruction

---

## Auto-Memory Guardrails (HARUS ADA)

Sebelum memanggil `memory.store`, agent **WAJIB** menjawab **YA** untuk semua pertanyaan ini:

1. Apakah ini masih relevan 1 minggu ke depan?
2. Apakah ini berlaku untuk seluruh repo (atau folder jelas)?
3. Apakah ini akan mengubah perilaku agent di masa depan?
4. Apakah ini bebas dari konteks sementara?

**Jika salah satu jawabannya TIDAK → JANGAN simpan.**

---

## Confirmation Pattern (WAJIB)

Agent **HARUS** transparan saat menyimpan memory.

**Template:**
> "Aku akan menyimpan ini sebagai [decision/mistake/etc] untuk project [repo] supaya aku konsisten ke depannya."

User boleh membatalkan.

---

## Memory Update vs New Memory

**Update Existing Memory Jika:**
- Decision lama dipertegas
- Pola diperjelas

**Create New Memory Jika:**
- Decision lama dibatalkan
- Constraint baru bertentangan

*Catatan: Jangan overwrite history tanpa alasan eksplisit.*

---

## Summary Update Rule (Antigravity)

Agent **WAJIB** memanggil `memory.summarize` jika:
- Menyimpan decision importance ≥ 4
- Ada ≥ 2 memory baru dalam repo yang sama

**Summary HARUS:**
- High-level
- Bebas detail implementasi
- Maksimal 3–5 bullet implisit

---

## Anti-Patterns (DILARANG)

- ❌ Menyimpan opini subjektif
- ❌ Menyimpan solusi sementara
- ❌ Menyimpan hasil brainstorming
- ❌ Menyimpan memory tanpa scope repo

---

## Final Take

Disiplin memory lebih penting dari kecanggihan vector DB.

**Auto-memory yang ketat:**
- Membuat agent terasa dewasa
- Meningkatkan trust
- Menjaga antigravity

Kalau aturan ini dipatuhi, memory system akan tetap kecil, bersih, dan bernilai tinggi.
