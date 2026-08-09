# Referensi Alat & Panduan Penggunaan

Panduan praktis untuk alat-alat yang diekspos server MCP ini kepada agen AI. Setiap alat dikelompokkan berdasarkan domain dengan pola penggunaan dan contoh.

> **`owner` & `repo` — persyaratan penting:** Sebagian besar alat menerima `owner` (organisasi/username GitHub) dan `repo` (nama proyek). Jika tidak disertakan, server akan mencoba menentukannya dari workspace roots / direktori kerja — tetapi ini tidak dapat diandalkan. **Selalu berikan keduanya secara eksplisit** untuk menghindari kegagalan. Sebagai jalan pintas, Anda dapat menggunakan format `"owner/nama-repo"` untuk `repo` dan server akan mengekstrak `owner` secara otomatis. Anda juga dapat mengirim `scope: { owner, repo }`.

> **Satu alat, banyak mode:** Server mengekspos **17 alat terpadu**. Setiap alat mendeteksi otomatis apa yang Anda inginkan dari parameter yang Anda kirim (lihat catatan "Auto-infer" per alat). Nama lama bertitik seperti `memory-store`, `memory-search`, atau `task-create` **bukan** alat terpisah — di sini dijelaskan sebagai _mode_ dari alat terpadu.

---

## Alat Memori (Pengetahuan Tahan Lama)

Alat-alat ini mengelola memori jangka panjang proyek Anda: keputusan arsitektur, fakta kode, pola, dan kesalahan.

### `memory-write` — Menyimpan / Memperbarui / Mengakui Memori

Empat mode, terdeteksi otomatis:

| Mode            | Pemicunya                     | Gunakan untuk                                           |
| --------------- | ----------------------------- | ------------------------------------------------------- |
| **Create**      | `content` ada                 | Menyimpan memori baru (dulu `memory-store`)             |
| **Update**      | `id` / `code` + bidang        | Mengedit memori yang ada (dulu `memory-update`)         |
| **Acknowledge** | `id` / `code` + `acknowledge` | Melaporkan memori berguna (dulu `memory-acknowledge`)   |
| **Bulk**        | `memories: [...]`             | Campuran create/update/acknowledge dalam satu panggilan |

**Contoh Create:**

```json
{
	"type": "decision",
	"title": "Use SQLite for local persistence",
	"content": "We chose SQLite over JSON files because...",
	"importance": 4,
	"scope": { "owner": "my-org", "repo": "my-project" },
	"tags": ["database", "architecture"]
}
```

**Bidang Create:**

- `type` — `code_fact`, `decision`, `mistake`, `pattern`, atau `task_archive`
- `title` — judul pendek yang dapat dibaca manusia (3-255 karakter)
- `content` — isi memori (min 10 karakter)
- `importance` — angka 1-5; seberapa kritis ini (semakin tinggi = semakin lambat meluruh)
- `scope` — **objek** dengan `owner` dan `repo` (atau kirim `owner`/`repo` di level atas)
- `tags` (opsional) — label teknologi untuk kemudahan ditemukan lintas proyek
- `code` (opsional) — dibuat otomatis sebagai `MEM-001`, `MEM-002`, dst. jika tidak diisi (berurutan per repo)
- `agent` / `model` (opsional) — otomatis ditangkap dari sesi jika tidak diisi
- `role` (opsional, default `"unknown"`) — peran agen yang membuat memori ini
- `metadata` (opsional) — konteks tambahan terstruktur
- `ttlDays` (opsional) — time-to-live dalam hari; setelah itu memori kedaluwarsa
- `supersedes` (opsional) — kode memori atau UUID yang digantikan oleh entri ini
- `is_global` (opsional, default `false`) — jika true, dibagikan ke semua repositori
- `status` (opsional) — `active` (default) atau `archived`

**Kemudahan keputusan (dulu `decision-log`):** tambahkan `type: "decision"` dengan `context` + `rationale` + `alternatives`, konten diformat otomatis (importance default 4):

```json
{
	"type": "decision",
	"title": "Use SQLite over PostgreSQL",
	"context": "We need local-first storage without server setup",
	"rationale": "SQLite is embedded, zero-config, and sufficient for single-user agent workflows",
	"alternatives": ["PostgreSQL", "JSON files"],
	"scope": { "owner": "my-org", "repo": "my-project" }
}
```

**Arsip sesi (dulu `session-summarize`):** tambahkan `type: "task_archive"` dengan `key_decisions` + `next_steps`, konten diformat otomatis (importance default 3):

```json
{
	"type": "task_archive",
	"title": "Session: authentication flow",
	"key_decisions": ["Use JWT with 24h expiry"],
	"next_steps": ["Add refresh token rotation"],
	"scope": { "owner": "my-org", "repo": "my-project" }
}
```

**Contoh Update:**

```json
{
	"code": "MEM-001",
	"importance": 5,
	"status": "archived"
}
```

**Contoh Acknowledge** — wajib setelah menggunakan memori untuk menghasilkan kode. Membantu sistem peluruhan mengetahui apa yang berguna:

```json
{
	"code": "MEM-001",
	"acknowledge": "used",
	"application_context": "Used this pattern when implementing the auth middleware"
}
```

**Penolakan konflik (Pengaman Anti-Hallusinasi):** membuat memori yang isinya tumpang tindih dengan memori yang ada di atas ambang konflik ditolak dengan error `MEMORY_CONFLICT`. Petunjuknya menyuruh Anda mengirim `id`/`code` untuk update, `acknowledge`, atau `supersedes` jika entri baru menggantikan yang lama.

### `memory-read` — Cari / Detail / Recap

Tiga mode, terdeteksi otomatis:

| Mode       | Pemicunya                            | Gunakan untuk                                             |
| ---------- | ------------------------------------ | --------------------------------------------------------- |
| **Search** | `query`                              | Menemukan memori yang relevan (dulu `memory-search`)      |
| **Detail** | `id` / `code` (atau `ids` / `codes`) | Konten lengkap satu/lebih memori (dulu `memory-detail`)   |
| **Recap**  | tidak ada parameter lain             | Statistik ikhtisar + memori teratas (dulu `memory-recap`) |

**Contoh Search:**

```json
{
	"query": "authentication flow",
	"repo": "my-project",
	"limit": 5
}
```

**Tips pro:**

- Gunakan `current_tags: ["react", "typescript"]` untuk menarik memori yang relevan dengan tech-stack dari proyek lain (Tech-Stack Affinity).
- Gunakan filter `type` (mis. `"decision"`, `"pattern"`), rentang importance (`min`/`max`), dan `include_archived: true` untuk menyertakan memori yang diarsipkan/meluruh.
- Tanggal bahasa alami bekerja di query: `"yesterday"`, `"last week"`, `"last 3 days"` (Time Tunnel).

**Contoh Detail** — pencarian berdasarkan `id` (UUID) atau `code` (mis. `MEM-001`):

```json
{ "code": "MEM-001" }
```

**Contoh Recap:**

```json
{ "repo": "my-project" }
```

### `memory-delete` — Menghapus Memori

Tunggal atau massal:

```json
{ "code": "MEM-001" }
```

```json
{ "codes": ["MEM-001", "MEM-002"] }
```

**Perilaku saat tidak ditemukan:** penghapusan satu target (`id`/`code`) melempar error jika target tidak ada; penghapusan massal (`ids`/`codes`) melewati target yang tidak ada, menghapus sisanya, dan melaporkannya di `errors`/`skippedCount` (eksekusi parsial). Berlaku seragam untuk `memory-delete`, `standard-delete`, dan `task-delete`.

### `repo-summarize` — Memperbarui Ringkasan Repo (dulu `memory-summarize`)

Menjaga ringkasan proyek tingkat tinggi yang dapat dengan cepat dirujuk oleh agen:

```json
{
	"repo": "my-project",
	"signals": ["Microservices migration in progress", "PostgreSQL chosen as primary DB"]
}
```

### `synthesize` — Mengajukan Pertanyaan Tentang Pengetahuan Anda (dulu `memory-synthesize`)

Menggunakan LLM klien AI Anda sendiri (sampling) untuk menjawab pertanyaan yang didasarkan pada memori lokal:

```json
{
	"repo": "my-project",
	"objective": "What do we know about authentication?"
}
```

> Catatan: `synthesize` hanya terdaftar jika klien mengiklankan dukungan sampling.

---

## Alat Tugas (Manajemen Pekerjaan)

### `task-write` — Membuat / Memperbarui Tugas (dulu `task-create` & `task-update`)

Mode, terdeteksi otomatis dalam urutan ini:

1. `tasks: [...]` → **Bulk** — setiap item menebak create vs update secara independen
2. `interactive: true` → **Interaktif** — menggali bidang yang kurang dari pengguna
3. `phase` + `title` + `description` → **Create**
4. `id` atau `code`/`task_code` ada → **Update**

**Contoh Create** (`task_code` opsional — dibuat otomatis sebagai `TASK-001`, `TASK-002`, dst. berurutan per repo):

```json
{
	"repo": "my-project",
	"phase": "implementation",
	"title": "Implement JWT middleware",
	"description": "1. Create middleware class\n2. Add token validation\n3. Write tests",
	"priority": 4,
	"status": "pending",
	"suggested_skills": ["fix-bug", "implement-feature"]
}
```

**Contoh Bulk Create:**

```json
{
	"repo": "my-project",
	"tasks": [
		{ "task_code": "AUTH-001", "phase": "impl", "title": "...", "description": "..." },
		{ "task_code": "AUTH-002", "phase": "impl", "title": "...", "description": "..." }
	]
}
```

**Contoh Update / progres:**

```json
{
	"repo": "my-project",
	"task_code": "AUTH-001",
	"status": "in_progress",
	"comment": "Starting implementation"
}
```

**Saat menyelesaikan:**

```json
{
	"repo": "my-project",
	"task_code": "AUTH-001",
	"status": "completed",
	"est_tokens": 1500,
	"commit_id": "abc123",
	"changed_files": ["src/middleware/auth.ts", "tests/auth.test.ts"],
	"comment": "All tests passing"
}
```

**Aturan status:**

- Tugas baru harus dimulai sebagai `backlog` atau `pending`.
- Setiap perubahan status **wajib menyertakan `comment`** kecuali `force: true` diberikan.
- Anda tidak bisa langsung melompat ke `completed` dari `backlog`/`pending`/`blocked` — tugas harus melewati `in_progress` dulu.
- `completed` / `canceled` bersifat terminal: klaim dilepas otomatis, handoff tertunda yang terhubung kedaluwarsa, dan tugas yang selesai diarsipkan ke memori.

### `task-read` — Cari / Detail / List (dulu `task-list` & `task-detail`)

Mode, terdeteksi otomatis:

| Mode       | Pemicunya                       | Contoh                                                            |
| ---------- | ------------------------------- | ----------------------------------------------------------------- |
| **Search** | `query` ada                     | pencarian kata kunci + semantik di seluruh tugas                  |
| **Detail** | `task_code` / `id` (atau array) | tugas lengkap incl. komentar + status koordinasi (klaim, handoff) |
| **List**   | tidak ada parameter lain        | daftar halaman, difilter oleh `status`                            |

**Contoh List:**

```json
{ "repo": "my-project" }
```

Secara default menyaring ke `in_progress` dan `pending`. Gunakan `status` untuk filter kustom:

```json
{ "repo": "my-project", "status": "backlog", "limit": 20 }
```

**Contoh Detail** — mengembalikan deskripsi lengkap, komentar, status koordinasi (klaim, handoff), dan riwayat status:

```json
{ "repo": "my-project", "task_code": "AUTH-001" }
```

### `task-delete` — Menghapus Tugas

```json
{ "repo": "my-project", "task_code": "AUTH-001" }
```

**Perilaku saat tidak ditemukan:** kontrak eksekusi parsial yang sama seperti dijelaskan di `memory-delete` (referensi tunggal melempar error, massal melewati + melaporkan).

---

## Alat Standar (Pustaka Standar Koding)

### `standard-write` — Menyimpan / Memperbarui Standar (dulu `standard-store` & `standard-update`)

**Create** (wajib `name` + `content` + `tags` + `metadata`):

```json
{
	"name": "React Component Naming",
	"content": "Use PascalCase for component filenames matching the export name.",
	"tags": ["naming", "react"],
	"metadata": { "source": "team-agreement" },
	"stack": ["react"],
	"language": "typescript",
	"is_global": true
}
```

**Update** (`code` + bidang):

```json
{
	"code": "STD-001",
	"name": "React Component Naming (Updated)",
	"version": "2.0.0"
}
```

Kode dibuat otomatis sebagai `STD-001`, `STD-002`, dst. (berurutan per repo atau lingkup global).

### `standard-read` — Cari / Detail / List (dulu `standard-search` & `standard-detail`)

Mode, terdeteksi otomatis:

| Mode       | Pemicunya                  | Contoh                                                    |
| ---------- | -------------------------- | --------------------------------------------------------- |
| **Search** | `query` / `stack` ada      | WAJIB sebelum implementasi — temukan standar yang berlaku |
| **Detail** | `id` / `code` (atau array) | konten standar lengkap                                    |
| **List**   | tidak ada parameter lain   | daftar halaman                                            |

**Contoh Search:**

```json
{ "stack": ["react", "typescript"] }
```

**Contoh Detail:**

```json
{ "code": "STD-001" }
```

### `standard-delete` — Menghapus Standar

```json
{ "code": "STD-001" }
```

**Perilaku saat tidak ditemukan:** kontrak penghapusan parsial yang sama dengan `memory-delete`.

---

## Alat Koordinasi (Serah Terima Multi-Agen)

### `handoff-write` — Membuat atau Memperbarui Handoff (dulu `handoff-create` & `handoff-update`)

**Create** (wajib `summary` + `from_agent`, di-scope oleh owner/repo):

```json
{
	"repo": "my-project",
	"from_agent": "agent-a",
	"to_agent": "agent-b",
	"task_code": "AUTH-001",
	"summary": "Auth middleware needs review",
	"context": {
		"next_steps": ["Review the JWT validation logic", "Add refresh token endpoint"],
		"blockers": ["Awaiting secrets manager access"]
	}
}
```

**Update** (`id` + `status`):

```json
{ "id": "handoff-uuid", "status": "accepted" }
```

### `handoff-read` — Memeriksa Antrean Handoff (dulu `handoff-list`)

Mode, terdeteksi otomatis:

| Mode           | Pemicunya                  | Contoh                                                        |
| -------------- | -------------------------- | ------------------------------------------------------------- |
| **Detail**     | `id` ada                   | satu handoff                                                  |
| **List klaim** | `claim: true` atau `agent` | klaim aktif                                                   |
| **Search**     | `query` ada                | pencarian handoff dengan filter                               |
| **List**       | tidak ada parameter lain   | semua handoff, filter dengan `status`/`to_agent`/`from_agent` |

```json
{ "repo": "my-project", "status": "pending" }
```

### `claim-manage` — Mengambil / Melepas / Memeriksa Kepemilikan (dulu `task-claim`, `claim-list`, `claim-release`)

Mode, terdeteksi otomatis:

| Mode              | Pemicunya                       | Contoh                        |
| ----------------- | ------------------------------- | ----------------------------- |
| **Claim**         | `task_id`/`task_code` + `agent` | mengambil kepemilikan tugas   |
| **Release**       | `release: true` + referensi     | melepas kepemilikan yang basi |
| **List per agen** | hanya `agent`                   | klaim untuk satu agen         |
| **List semua**    | tidak ada parameter lain        | semua klaim aktif             |

**Contoh Claim:**

```json
{
	"repo": "my-project",
	"task_code": "AUTH-001",
	"agent": "agent-b",
	"role": "maintainer"
}
```

**Contoh Release:**

```json
{ "repo": "my-project", "task_code": "AUTH-001", "release": true }
```

**Contoh List:**

```json
{ "repo": "my-project" }
```

---

## Alur Kerja Agen Umum

### Memulai Sesi Baru

```
1. task-read (repo: my-project, status: pending)
2. Pilih SATU tugas dari daftar
3. claim-manage (task_code: ..., agent: ..., role: ...)
4. task-read (task_code: ...) — detail lengkap
5. standard-read (stack: [teknologi relevan])
6. Kerjakan tugas teknis
7. task-write (task_code: ..., status: completed, est_tokens: N, comment: ...)
```

### Men-debug Bug

```
1. memory-read (query: deskripsi error, repo: ...)
2. memory-read (code: <kode hasil>) — konten lengkap
3. Perbaiki masalah
4. memory-write (type: mistake, tentang apa yang salah)
5. task-write (jika ada tugas yang melacak perbaikan)
```

### Transfer Pengetahuan Antar Agen

```
1. task-read / memory-read untuk mengumpulkan konteks
2. handoff-write dengan next_steps dan blockers
3. Agen penerima melihat handoff-read (status: pending) dan mengambilnya
4. Agen penerima memanggil handoff-write (id: ..., status: accepted)
```

### Orientasi ke Proyek Baru

```
1. synthesize (objective: "Tentang apa proyek ini?")
2. memory-read (repo: ...) — recap memori teratas
3. task-read (repo: ...) — apa yang tertunda
4. standard-read (stack: [...]) — aturan koding
5. Mulai bekerja
```

---

## Ringkasan Grup Alat

| Grup         | Alat                                                                           | Tujuan                                     |
| ------------ | ------------------------------------------------------------------------------ | ------------------------------------------ |
| Memory       | `memory-read`, `memory-write`, `memory-delete`, `repo-summarize`, `synthesize` | Pengetahuan tahan lama jangka panjang      |
| Task         | `task-read`, `task-write`, `task-delete`                                       | Siklus hidup item pekerjaan                |
| Standard     | `standard-read`, `standard-write`, `standard-delete`                           | Aturan koding yang dapat digunakan kembali |
| Coordination | `handoff-read`, `handoff-write`, `claim-manage`                                | Orkestrasi multi-agen                      |

| Alat              | Tujuan                                       |
| ----------------- | -------------------------------------------- |
| `memory-read`     | Cari / detail / recap memori                 |
| `memory-write`    | Buat / perbarui / akui memori                |
| `memory-delete`   | Hapus memori (tunggal atau massal)           |
| `repo-summarize`  | Perbarui ringkasan proyek singkat repo       |
| `synthesize`      | Tanya-jawab berbasis LLM atas memori lokal   |
| `task-read`       | Cari / detail / list tugas                   |
| `task-write`      | Buat / perbarui / operasi massal tugas       |
| `task-delete`     | Hapus tugas (tunggal atau massal)            |
| `standard-read`   | Cari / detail / list standar koding          |
| `standard-write`  | Buat / perbarui standar                      |
| `standard-delete` | Hapus standar (tunggal atau massal)          |
| `handoff-read`    | Periksa handoff atau klaim aktif             |
| `handoff-write`   | Buat / perbarui handoff                      |
| `claim-manage`    | Klaim, lepas, atau list kepemilikan tugas    |
| `agent-context`   | Konteks sesi dalam satu panggilan            |
| `codebase-index`  | Bangun / segarkan / status indeks codebase   |
| `codebase-read`   | Cari / telusuri / simbol berkas / arsitektur |

---

## Alat Agentic (Konteks Agen)

### `agent-context` — Konteks Sesi dalam Satu Panggilan

Mengembalikan memori yang relevan, tugas aktif, dan keputusan terbaru untuk sesi saat ini:

```json
{ "owner": "my-org", "repo": "my-project", "objective": "implement auth", "limit": 5 }
```

### Pencatatan Keputusan Terstruktur

Bukan alat terpisah — gunakan `memory-write` dengan `type: "decision"` plus `context`, `rationale`, dan `alternatives` (lihat [Alat Memori](#memory-write--menyimpan--memperbarui--mengakui-memori)).

### Ringkasan Sesi

Gunakan `memory-write` dengan `type: "task_archive"` plus `key_decisions` dan `next_steps`, atau `repo-summarize` untuk ringkasan proyek per-repo yang persisten.

---

## Knowledge Graph (Dikelola via Dasbor)

Knowledge Graph menyimpan entitas, relasi ber-tipe, dan observasi, dengan ekstraksi entitas otomatis saat memori, standar, dan tugas disimpan serta saat indeks codebase dijalankan (NLP offline, melalui worker outbox embedding).

- **Buat / edit / hapus** entitas, relasi, dan observasi dilakukan di **Web Dashboard → tab Knowledge Graph** (dan via API dasbor) — satu-satunya permukaan edit manual.
- Graf **diisi otomatis dari domain memory, standard, task, dan codebase** — entitas/relasi ditulis oleh outbox embedding dari penulisan memory/standard/task dan eksekusi indeks codebase. Entitas KG codebase berasal dari data simbol/referensi terindeks (bukan dari API simbol terpisah).

> **Keputusan (2026-08-09): TIDAK ADA alat MCP KG.** KG adalah infrastruktur yang diisi otomatis (ADR-006): entitas/relasi ditulis oleh outbox embedding dari penulisan memory/standard/task dan eksekusi indeks codebase; pembacaan terjadi melalui field `kg` tertanam di memory-read/task-read/standard-read. Tab Knowledge Graph dasbor tetap menjadi satu-satunya permukaan edit manual (API CRUD).
>
> Nama alat `create_entity`, `delete_entity`, `create_relation`, `delete_relation`, dan `delete_observation` hanyalah **niat desain lama (legacy design intent)** — tidak pernah dirilis sebagai alat MCP kanonik (sesuai hasil ADR-006 "nol alat KG"; pemetaan gaya "formerly" tidak berlaku).
>
> **Catatan (terverifikasi 2026-08-09):** `source_domain` pada konteks `kg` tertanam dihias oleh pemanggil — mencerminkan domain pemanggil (`memory` / `task` / `standard`), bukan provensi tersimpan. Entitas codebase dapat dijangkau melalui pencocokan nama dan dapat muncul dengan label domain pemanggil saat nama bertumpang tindih; tidak ada API KG codebase terpisah.

---

## Inspirasi Hulu

Fitur **Knowledge Graph** **terinspirasi dari** [Beledarian/mcp-local-memory](https://github.com/Beledarian/mcp-local-memory) — konsep grafik entitas/relasi terstruktur diimplementasikan ulang dengan skema sendiri dan ekstraksi NLP offline.

Proyek ini **bukan** kompatibel drop-in: nama hulu `remember_fact`, `remember_facts`, `recall`, dan `forget` tidak disediakan sebagai alat maupun alias. Gunakan nama alat kanonik yang didokumentasikan di atas (`memory-write`, `memory-read`, `memory-delete`, dst.).
