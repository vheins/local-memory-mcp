# Specification: Enhanced Local Memory System (V2)

Dokumen ini merinci persyaratan, desain arsitektur, dan daftar tugas untuk peningkatan fungsionalitas MCP Local Memory Server.

---

## 1. Recall Tracking (Feedback Loop)
**Requirement:**
- Mengetahui memori mana yang benar-benar bermanfaat bagi Agent.
- Menyediakan metrik "Utility Rate" (Recall Count / Hit Count).

**Design:**
- **Tool Baru:** `memory-acknowledge(id: string, feedback?: string)`.
- **Database:** Memperbarui kolom `recall_count` di tabel `memories`.
- **Dashboard:** Menampilkan badge "High Utility" pada memori dengan recall rate > 50%.

---

## 2. Time-Based Memory Decay (Natural Forgetting)
**Requirement:**
- Membersihkan memori usang secara otomatis agar konteks tetap bersih.
- Menghindari penghapusan permanen dengan mekanisme *archiving*.

**Design:**
- **Algoritma Decay:** `Score = Importance / (Days Since Last Used + 1)`.
- **Background Task:** Fungsi `archiveLowScoreMemories()` yang berjalan saat server dimulai.
- **Database:** Memindahkan data dari `memories` ke `memories_archive`.

---

## 3. Timeline & Audit Trail (Dashboard)
**Requirement:**
- Developer dapat melihat histori interaksi Agent dengan memori.
- Transparansi mengenai apa yang dicari dan ditemukan Agent.

**Design:**
- **UI Component:** Tab "Timeline" di Dashboard.
- **Data Source:** Tabel `action_log`.
- **Visualisasi:** List kronologis berisi: `Action (Search/Store)`, `Query`, `Result Count`, dan `Timestamp`.

---

## 4. Semantic Search via Transformers.js (Local-First)
**Requirement:**
- Pencarian semantik sejati tanpa dependensi eksternal (Ollama/OpenAI).
- Mendukung variasi kata dan sinonim.

**Design:**
- **Library:** `@xenova/transformers`.
- **Model:** `Xenova/all-MiniLM-L6-v2` (ringan dan cepat).
- **Storage:** Simpan vektor (float array) di tabel `memory_vectors`.
- **Search:** Ganti `vectors.stub.ts` dengan implementasi pencarian vektor berbasis *dot product* atau *cosine similarity*.

---

## 5. Workspace-Aware Context
**Requirement:**
- Memprioritaskan memori yang relevan dengan file/folder yang sedang dikerjakan.

**Design:**
- **Schema Update:** Menambahkan parameter opsional `currentFile` dan `currentLanguage` pada `memory-search`.
- **Scoring Boost:** Memberikan bobot tambahan (+20%) jika `scope.folder` atau `scope.language` cocok dengan konteks saat ini.

---

## 6. Shadow Conflict Detection
**Requirement:**
- Mencegah Agent menyimpan informasi yang bertentangan dengan keputusan lama.

**Design:**
- **Logic:** Saat `memory-store` dipanggil, lakukan pencarian semantik terhadap `content` baru.
- **Threshold:** Jika skor kemiripan > 0.8 tapi ada indikasi negasi (misal: "Use" vs "Don't use"), berikan respon peringatan (Warning) kepada Agent.

---

## implementation Roadmap & Tasks

### Phase 1: Foundation & Tracking (Fitur 1 & 3)
- [ ] Implementasi tool `memory-acknowledge`.
- [ ] Update `SQLiteStore.incrementRecallCount`.
- [ ] Tambahkan tab "Timeline" di Dashboard UI.
- [ ] Ekspos API `/api/actions` untuk dashboard.

### Phase 2: Intelligence & Semantics (Fitur 4 & 6)
- [ ] Instalasi `@xenova/transformers`.
- [ ] Implementasi `VectorStore` sungguhan di `src/storage/vectors.ts`.
- [ ] Integrasi embedding ke `memory-store`.
- [ ] Logika deteksi konflik pada `handleMemoryStore`.

### Phase 3: Optimization & Context (Fitur 2 & 5)
- [ ] Implementasi filter `folder` dan `language` di `memory-search`.
- [ ] Implementasi *background archiver* untuk memori usang.
- [ ] Update Dashboard untuk menampilkan memori yang di-archive.

---

**Prinsip Utama:** Tetap Local-First, Zero-Config, dan Ringan.
