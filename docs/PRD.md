# PRD – MCP Local Memory Service

## TL;DR

Membangun **MCP Local Memory Service** berbasis Node.js yang menyediakan *long-term, high-signal memory* untuk coding copilot & antigravity agent. Sistem ini menyimpan keputusan, fakta kode, kesalahan, dan pola penting menggunakan SQLite + vector similarity search, sehingga agent tetap konsisten, tidak mengulang kesalahan, dan tahan terhadap typo / variasi query.

---

## Problem Statement

Coding copilot dan agent saat ini:
- Mudah kehilangan konteks keputusan sebelumnya
- Mengulang kesalahan yang sama
- Overfit ke prompt terakhir (*gravity problem*)
- Lemah terhadap typo atau phrasing berbeda

Tanpa memory terstruktur, agent terasa "pintar sesaat" tapi tidak reliable untuk penggunaan jangka panjang.

---

## Goals

### Business Goals
- Meningkatkan kualitas dan konsistensi output coding copilot
- Mengurangi user correction berulang
- Menjadikan agent usable untuk long-running projects

### User Goals
- Agent mengingat keputusan & constraint penting
- Agent tidak mengulang kesalahan lama
- Agent tetap relevan walau prompt berubah atau typo

### Non-Goals
- Bukan chat history logger
- Bukan audit trail
- Tidak mendukung distributed / cloud sync (local-first)

---

## Target Users
- Developer menggunakan coding copilot lokal
- Power user / engineer yang menginginkan agent “punya ingatan”
- Pengguna MCP-based agent system

---

## User Stories
1. **Sebagai developer**, saya ingin agent mengingat keputusan arsitektur agar tidak perlu menjelaskannya berulang kali.
2. **Sebagai developer**, saya ingin agent tidak mengulang kesalahan yang sudah saya koreksi sebelumnya.
3. **Sebagai developer**, saya ingin agent tetap menemukan memory relevan walau saya salah ketik atau pakai istilah berbeda.
4. **Sebagai agent**, saya ingin memory yang ringkas dan relevan agar tidak membanjiri prompt.

---

## Memory Types (Core Concept)

### 1. code_fact
Fakta stabil tentang codebase.
*Contoh:*
- Project pakai clean architecture
- Semua API pakai zod validation

### 2. decision
Keputusan desain atau arsitektur.
*Contoh:*
- Tidak menggunakan ORM
- Menggunakan raw SQL demi performa

### 3. mistake
Kesalahan yang tidak boleh diulang.
*Contoh:*
- Jangan pakai default export
- Jangan gunakan `any` di domain layer

### 4. pattern
Pola kode atau konvensi yang sering dipakai.
*Contoh:*
- Struktur handler
- Pola error handling

---

## User Experience (End-to-End Flow)

### 1. Normal Interaction
1. User meminta agent generate / modify code
2. Agent membaca project summary (jika ada)
3. Agent mencari memory relevan via semantic search
4. Memory terpilih diinjeksi ke prompt
5. Agent menghasilkan code sesuai constraint

### 2. Memory Creation Flow
1. User memberi constraint / koreksi penting
2. Agent mendeteksi sinyal *memory-worthy*
3. Agent menyimpan memory via MCP tool
4. Agent (opsional) update project summary

---

## Narrative (Executive Story)

Bayangkan seorang developer bekerja di codebase selama berminggu-minggu. Ia sudah menetapkan aturan: arsitektur tertentu, larangan tertentu, dan pola kode yang disepakati.

Tanpa memory, setiap hari agent kembali seperti "intern baru" — pintar, tapi lupa segalanya.

Dengan **MCP Local Memory Service**, agent berubah menjadi rekan tim yang belajar:
- Mengingat keputusan
- Menghindari kesalahan lama
- Berpikir di level arsitektur

Ini bukan soal membuat agent lebih pintar — tapi membuatnya lebih dapat dipercaya.

---

## Functional Requirements

### Memory Storage
- Menyimpan memory bertipe: `code_fact`, `decision`, `mistake`, `pattern`
- Mendukung metadata scope (repo, language, folder)
- Mendukung importance score (1–5)

### Memory Retrieval
- Semantic similarity search (vector-based)
- Tahan typo & variasi bahasa
- Mendukung filtering by type, scope, importance

### Memory Summary
- Ringkasan high-level per repo
- Digunakan sebagai *antigravity anchor*

---

## MCP Interface

### Resources
- `memory://entries`
- `memory://summary`

### Tools
- `memory.search`
- `memory.store`
- `memory.summarize`

Agent tidak mengetahui detail database atau vector engine.

---

## Success Metrics

### Quantitative
- Penurunan jumlah user correction berulang
- Peningkatan reuse memory dalam prompt
- Latency memory search < 100ms (local)

### Qualitative
- Agent terasa konsisten
- Agent tidak mengulang kesalahan lama
- User trust meningkat

---

## Technical Considerations
- Node.js MCP server
- SQLite sebagai primary storage
- Vector similarity via sqlite extension atau embedded index
- Local embedding model (via Ollama / llama.cpp)
- Normalization layer untuk typo handling

---

## Milestones & Sequencing
1. MCP contract & interface definition (XX weeks)
2. SQLite schema + vector indexing (XX weeks)
3. Memory search & ranking logic (XX weeks)
4. Agent prompt integration (XX weeks)
5. Heuristic-based auto memory rules (XX weeks)

---

## Risks & Mitigations
- **Risk: Memory pollution**
  - *Mitigasi:* strict store rules + importance threshold
- **Risk: Prompt bloat**
  - *Mitigasi:* limit memory injection + summary usage
- **Risk: Overfitting memory**
  - *Mitigasi:* relevance threshold + scope filtering

---

## Open Questions
- Perlu manual memory deletion UI?
- Perlu memory versioning?
- Perlu cross-repo inference di masa depan?

---

## Final Take
Produk ini bukan tentang database atau vector search.
Ini tentang mendisiplinkan ingatan agent agar ia benar-benar berguna untuk kerja nyata.
