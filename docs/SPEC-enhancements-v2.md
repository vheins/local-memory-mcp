# Strict Specification: Enhanced Local Memory System (V2)

## 1. Recall & Utility Tracking (Anti-Hallucination Loop)
**Problem:** Agent seringkali "berasumsi" memori yang diberikan sudah cukup atau benar tanpa memberikan feedback.
**Strict Protocol:**
- **New Tool:** `memory-acknowledge`
  - `memory_id` (UUID): Harus ada di hasil `memory-search` sebelumnya.
  - `status` (enum): `used` | `irrelevant` | `contradictory`.
  - `application_context` (string): Bagaimana memori ini digunakan dalam kode.
- **Scoring Logic:** 
  - `UtilityRate = (UsedCount / HitCount)`.
  - Jika `UsedCount` rendah tapi `HitCount` tinggi, memori tersebut akan diberi **penalty score** (-0.2) dalam ranking pencarian untuk mencegah Agent terus-menerus disuapi informasi yang tidak relevan.
- **Agent Instruction:** "Jika Anda menggunakan fakta dari memori untuk menghasilkan kode, Anda WAJIB memanggil `memory-acknowledge` dengan status `used` segera setelah output selesai."

## 2. Local Semantic Engine (Transformers.js)
**Problem:** Pencarian kata kunci (keyword) rentan terhadap sinonim yang meleset, menyebabkan Agent merasa "tidak ada memori" padahal ada.
**Technical Constraints:**
- **Model:** `Xenova/all-MiniLM-L6-v2` (Quantized ONNX, <30MB).
- **Processing Pipeline:**
  1. `SQL FTS5` mencari Top 50 kandidat (Recall phase).
  2. `Transformers.js` menghitung Cosine Similarity pada Top 50 tersebut (Re-ranking phase).
- **Strict Threshold:** `SimilarityScore < 0.72` dianggap **No Match**. Sistem dilarang mengembalikan hasil di bawah threshold ini untuk mencegah Agent mencoba "mencocok-cocokkan" informasi yang tidak relevan (hallucination trigger).

## 3. Shadow Conflict Detection (Strict Consistency)
**Problem:** Menyimpan dua keputusan yang bertentangan (misal: "Gunakan Tab" dan "Gunakan Spasi") akan merusak logika Agent.
**Validation Rules:**
- Saat `memory-store` dipanggil:
  1. Lakukan `Vector Search` terhadap konten baru.
  2. Jika ditemukan memori dengan `Similarity > 0.85` pada repo yang sama:
     - Jika `type` sama tapi isi berbeda secara substansial: **REJECT** dengan Error `MEMORY_CONFLICT`.
     - Agent harus memanggil `memory-update` pada ID lama atau secara eksplisit menyatakan `supersedes: [ID_LAMA]`.
- **Constraint:** Tidak boleh ada dua memori dengan `type: "decision"` yang memiliki semantic overlap > 85% tanpa link `supersedes`.

## 4. Time-Based Decay & Archiving
**Problem:** Memori usang dari fase awal proyek (misal: "Kita pakai boilerplate X") mengganggu saat proyek sudah bermigrasi ke "Boilerplate Y".
**Math Formula:**
- `Score = (Importance * 2) + (LastUsedRecency) - (AgeFactor)`.
- `LastUsedRecency = 1 / (DaysSinceLastUsed + 1)`.
- **Archive Trigger:** Jika `Score < 1.5` dan memori sudah berumur > 90 hari:
  - Pindahkan ke `memories_archive`.
  - **Dilarang** muncul di `memory-search` default.
  - Hanya bisa diakses via `memory-search` dengan flag `include_archived: true`.

## 5. Workspace Context Enforcement
**Problem:** Agent sering mengambil memori dari modul "Auth" saat sedang mengerjakan modul "Payment".
**Strict Filtering:**
- **Tool Parameter:** `current_file_path` (Required in `memory-search`).
- **Logic:**
  - Jika `memory.scope.folder` adalah prefix dari `current_file_path`, berikan **Ranking Boost (+0.15)**.
  - Jika ekstensi file (`.ts`, `.py`) cocok dengan `memory.scope.language`, berikan **Ranking Boost (+0.1)**.
- Ini memaksa hasil pencarian menjadi sangat spesifik terhadap lokasi kerja Agent.

## 6. Audit Trail & Log Integrity
**Problem:** Tidak ada bukti mengapa Agent memilih memori tertentu.
**Logging Requirement:**
- Setiap `memory-search` harus mencatat:
  - `query_vector_hash`.
  - `top_3_match_ids`.
  - `system_threshold_applied`.
- Data ini diekspos di Dashboard dalam bentuk **Decision Tree** untuk audit manual oleh developer.

---

## Technical Tasks (Phase 1: Strict Foundation)

### 1.1 Schema Update (SQLite)
- [ ] Add `supersedes` column to `memories` (Self-referencing ID).
- [ ] Add `status` (active/archived) index.
- [ ] Add `vector_version` to `memory_vectors` (untuk tracking migrasi model embedding).

### 1.2 Tool Schema Enforcement (Zod)
- [ ] Update `MemorySearchSchema`: add `current_file_path` (string), `include_archived` (boolean).
- [ ] Create `MemoryAcknowledgeSchema`.
- [ ] Update `MemoryStoreSchema`: add `supersedes` (optional UUID).

### 1.3 Conflict Detection Logic
- [ ] Implement `checkConflicts(content, repo)` helper.
- [ ] Integrate conflict check into `handleMemoryStore`.

---

**Anti-Hallucination Guarantee:** Dengan sistem ini, jika Agent tidak menemukan data dengan skor kemiripan tinggi, sistem akan mengembalikan `null` atau `empty` secara tegas, alih-alih memberikan "kemiripan terdekat" yang menyesatkan.
