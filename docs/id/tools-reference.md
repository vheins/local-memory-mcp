# Referensi Alat & Panduan Penggunaan

Panduan praktis untuk alat-alat yang diekspos server MCP ini kepada agen AI. Setiap alat dikelompokkan berdasarkan domain dengan pola penggunaan dan contoh.

> **`owner` & `repo` — persyaratan penting:** Sebagian besar alat memerlukan `owner` (organisasi/username GitHub) dan `repo` (nama proyek). Jika tidak disertakan, server akan mencoba menentukannya dari workspace roots — tetapi ini tidak dapat diandalkan. **Selalu berikan keduanya secara eksplisit** untuk menghindari kegagalan. Sebagai jalan pintas, Anda dapat menggunakan format `"owner/nama-repo"` untuk `repo` dan server akan mengekstrak `owner` secara otomatis.

---

## Alat Memori (Pengetahuan Tahan Lama)

Alat-alat ini mengelola memori jangka panjang proyek Anda: keputusan arsitektur, fakta kode, pola, dan kesalahan.

### `memory-store` — Menyimpan Memori Baru

Simpan apa yang Anda pelajari agar tetap ada di seluruh sesi.

```json
{
	"type": "decision",
	"title": "Use SQLite for local persistence",
	"content": "We chose SQLite over JSON files because...",
	"importance": 4,
	"agent": "assistant",
	"model": "gpt-4",
	"scope": { "owner": "my-org", "repo": "my-project" },
	"tags": ["database", "architecture"]
}
```

**Bidang (semua wajib kecuali disebutkan opsional):**

- `type` — `code_fact`, `decision`, `mistake`, `pattern`, atau `task_archive`
- `title` — judul pendek yang dapat dibaca manusia (3-255 karakter)
- `content` — isi memori (min 10 karakter)
- `importance` — angka 1-5; seberapa kritis ini (semakin tinggi = semakin lambat meluruh)
- `agent` — nama agen yang membuat memori ini
- `model` — model AI yang digunakan oleh agen
- `scope` — **objek** dengan `owner` (organisasi/username GitHub) dan `repo` (nama proyek) — keduanya wajib
- `tags` (opsional) — label teknologi untuk kemudahan ditemukan lintas proyek
- `code` (opsional) — dibuat otomatis sebagai `MEM-001`, `MEM-002`, dst. jika tidak diisi (berurutan per repo)
- `role` (opsional, default `"unknown"`) — peran agen yang membuat memori ini
- `metadata` (opsional) — konteks tambahan terstruktur
- `ttlDays` (opsional) — time-to-live dalam hari; setelah itu memori kedaluwarsa
- `supersedes` (opsional) — kode memori atau UUID yang digantikan oleh entri ini
- `is_global` (opsional, default `false`) — jika true, dibagikan ke semua repositori
- `structured` (opsional, default `false`) — jika true, mengembalikan JSON terstruktur dari memori yang disimpan

### `memory-search` — Menemukan Memori yang Relevan

Lapisan navigasi. Mengembalikan tabel kompak dari ID memori yang cocok (bukan konten lengkap).

```json
{
	"query": "authentication flow",
	"repo": "my-project",
	"limit": 5
}
```

**Tips pro:**

- Gunakan `current_tags: ["react", "typescript"]` untuk menemukan memori yang relevan dengan tech-stack dari proyek lain.
- Gunakan `types: ["decision", "pattern"]` untuk menyaring berdasarkan jenis pengetahuan.
- Gunakan `include_archived: true` untuk mencari juga memori yang diarsipkan/meluruh.

### `memory-detail` — Membaca Konten Memori Lengkap

Setelah pencarian mengembalikan baris pointer, ambil konten lengkap:

```json
{ "code": "MEM-001" }
```

Mendukung pencarian berdasarkan `id` (UUID) atau `code` (mis. `MEM-001`). Kode bersifat berurutan per repo.

### `memory-update` — Mengedit Memori yang Ada

```json
{
	"code": "MEM-001",
	"importance": 5,
	"status": "archived"
}
```

### `memory-acknowledge` — Melaporkan Kegunaan Memori

Wajib setelah menggunakan memori untuk menghasilkan kode. Membantu sistem peluruhan mengetahui apa yang berguna.

```json
{
	"code": "MEM-001",
	"status": "used",
	"application_context": "Used this pattern when implementing the auth middleware"
}
```

### `memory-delete` — Menghapus Memori

Tunggal atau massal:

```json
{ "code": "MEM-001" }
```

```json
{ "codes": ["MEM-001", "MEM-002"] }
```

### `memory-recap` — Ikhtisar Dasbor

Mengembalikan statistik (jumlah berdasarkan jenis) dan tabel pointer dari memori teratas.

```json
{ "repo": "my-project" }
```

### `memory-summarize` — Memperbarui Ringkasan Repo

Menjaga ringkasan proyek tingkat tinggi yang dapat dengan cepat dirujuk oleh agen:

```json
{
	"repo": "my-project",
	"signals": ["Microservices migration in progress", "PostgreSQL chosen as primary DB"]
}
```

### `memory-synthesize` — Mengajukan Pertanyaan Tentang Pengetahuan Anda

Menggunakan LLM klien AI Anda sendiri untuk menjawab pertanyaan yang didasarkan pada memori lokal:

```json
{
	"repo": "my-project",
	"objective": "What do we know about authentication?"
}
```

---

## Alat Tugas (Manajemen Pekerjaan)

Melacak item pekerjaan melalui siklus hidupnya: Backlog → Pending → In Progress → Completed.

### `task-create` — Mendaftarkan Tugas

`task_code` bersifat opsional. Jika tidak diisi, akan dibuat otomatis sebagai `TASK-001`, `TASK-002`, dst. (berurutan per repo).

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

Dengan `task_code` eksplisit dan `suggested_skills`:

```json
{
	"repo": "my-project",
	"task_code": "AUTH-001",
	"phase": "implementation",
	"title": "Implement JWT middleware",
	"description": "1. Create middleware class\n2. Add token validation\n3. Write tests",
	"priority": 4,
	"status": "pending",
	"suggested_skills": ["implement-feature"]
}
```

Mode massal (`task_code` opsional di setiap item):

```json
{
	"repo": "my-project",
	"tasks": [
		{ "task_code": "AUTH-001", "phase": "impl", "title": "...", "description": "..." },
		{ "phase": "impl", "title": "...", "description": "..." }
	]
}
```

Mode massal:

```json
{
	"repo": "my-project",
	"tasks": [
		{ "task_code": "AUTH-001", "phase": "impl", "title": "...", "description": "..." },
		{ "task_code": "AUTH-002", "phase": "impl", "title": "...", "description": "..." }
	]
}
```

### `task-list` — Menemukan Tugas

```json
{ "repo": "my-project" }
```

Secara default menyaring ke `in_progress` dan `pending`. Gunakan `status` untuk filter kustom:

```json
{ "repo": "my-project", "status": "backlog", "limit": 20 }
```

### `task-detail` — Membaca Tugas Lengkap

```json
{ "repo": "my-project", "task_code": "AUTH-001" }
```

Mengembalikan deskripsi lengkap, komentar, status koordinasi (klaim, handoff), dan riwayat status.

### `task-update` — Memajukan Tugas

```json
{
	"repo": "my-project",
	"task_code": "AUTH-001",
	"status": "in_progress",
	"comment": "Starting implementation"
}
```

Saat menyelesaikan:

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

**Transisi status yang diizinkan:**

- backlog → pending, in_progress
- pending → in_progress, blocked
- in_progress → completed, blocked, canceled
- blocked → in_progress
- completed/canceled → terminal (tidak ada keluar)

Pembaruan massal:

```json
{
	"repo": "my-project",
	"ids": ["uuid-1", "uuid-2"],
	"status": "blocked",
	"comment": "Blocked by missing API key"
}
```

### `task-delete` — Menghapus Tugas

```json
{ "repo": "my-project", "task_code": "AUTH-001" }
```

---

## Alat Standar (Pustaka Standar Koding)

Mengelola aturan koding yang dapat digunakan kembali yang diterapkan di seluruh proyek.

### `standard-search` — Menemukan Standar yang Berlaku

Panggilan WAJIB sebelum mengimplementasikan apa pun. Mengembalikan standar koding yang cocok:

```json
{ "stack": ["react", "typescript"] }
```

### `standard-detail` — Membaca Standar Lengkap

```json
{ "code": "STD-001" }
```

Kode dibuat otomatis sebagai `STD-001`, `STD-002`, dst. (berurutan per repo atau lingkup global).

### `standard-store` — Menyimpan Standar Baru

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

### `standard-update` — Memperbarui Standar

```json
{
	"code": "STD-001",
	"name": "React Component Naming (Updated)",
	"version": "2.0.0"
}
```

### `standard-delete` — Menghapus Standar

```json
{ "code": "STD-001" }
```

---

## Alat Koordinasi (Serah Terima Agen)

Digunakan ketika banyak agen perlu mentransfer konteks.

### `handoff-create` — Mentransfer Pekerjaan yang Belum Selesai

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

### `handoff-list` — Memeriksa Antrean Handoff

```json
{ "repo": "my-project", "status": "pending" }
```

### `handoff-update` — Menutup Handoff

```json
{ "id": "handoff-uuid", "status": "accepted" }
```

### `task-claim` — Mengambil Kepemilikan

```json
{
	"repo": "my-project",
	"task_code": "AUTH-001",
	"agent": "agent-b",
	"role": "maintainer"
}
```

### `claim-list` — Melihat Siapa Memiliki Apa

```json
{ "repo": "my-project" }
```

### `claim-release` — Melepaskan Kepemilikan

```json
{ "repo": "my-project", "task_code": "AUTH-001", "agent": "agent-b" }
```

---

## Alur Kerja Agen Umum

### Memulai Sesi Baru

```
1. task-list (repo: my-project)
2. Pilih SATU tugas dari daftar
3. task-claim (task_code: ..., agent: ..., role: ...)
4. task-detail (task_code: ...)
5. standard-search (stack: [teknologi relevan])
6. Kerjakan tugas
7. task-update (status: completed, est_tokens: N)
```

### Men-debug Bug

```
1. memory-search (query: deskripsi error, repo: ...)
2. memory-detail pada hasil yang relevan
3. Perbaiki masalah
4. memory-store (type: mistake, tentang apa yang salah)
5. task-update (jika ada tugas yang melacak perbaikan)
```

### Transfer Pengetahuan Antar Agen

```
1. task-detail / memory-search untuk mengumpulkan konteks
2. handoff-create dengan next_steps dan blockers
3. Agen penerima melihat handoff-list dan mengambilnya
4. Agen penerima memanggil handoff-update (status: accepted)
```

### Orientasi ke Proyek Baru

```
1. memory-synthesize (objective: "Tentang apa proyek ini?")
2. memory-recap untuk melihat memori teratas
3. task-list untuk melihat apa yang tertunda
4. standard-search untuk aturan koding
5. Mulai bekerja
```

---

## Ringkasan Grup Alat

| Grup         | Alat                                                                                | Tujuan                                     |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| Memory       | store, search, detail, update, acknowledge, delete, recap, summarize, synthesize    | Pengetahuan tahan lama jangka panjang      |
| Task         | create, list, detail, update, delete                                                | Siklus hidup item pekerjaan                |
| Standard     | store, search, detail, update, delete                                               | Aturan koding yang dapat digunakan kembali |
| Coordination | handoff-create, handoff-list, handoff-update, task-claim, claim-list, claim-release | Orkestrasi multi-agen                      |
| Knowledge    | create_entity, delete_entity, create_relation, delete_relation, delete_observation  | Graf entitas & relasi                      |

---

## Alat Knowledge Graph (Graf Pengetahuan)

Alat-alat ini mengelola data relasi entitas terstruktur untuk memetakan konsep domain.

### `create_entity` — Membuat Entitas Knowledge Graph

```json
{
	"name": "PaymentService",
	"type": "concept",
	"description": "Handles payment processing and invoicing",
	"repo": "my-project"
}
```

### `delete_entity` — Menghapus Entitas (Berkaskade)

Berkaskade untuk menghapus semua relasi dan observasi terkait.

```json
{ "name": "PaymentService" }
```

### `create_relation` — Menghubungkan Dua Entitas

```json
{
	"from_entity": "PaymentService",
	"to_entity": "User",
	"relation_type": "processes_payments_for",
	"repo": "my-project"
}
```

### `delete_relation` — Menghapus Relasi

```json
{
	"from_entity": "PaymentService",
	"to_entity": "User",
	"relation_type": "processes_payments_for"
}
```

### `delete_observation` — Menghapus Observasi

```json
{ "id": "<observation-uuid>" }
```

---

## Alat Agentic (Konteks Agen)

### `agent-context` — Konteks Sesi dalam Satu Panggilan

Mengembalikan memori yang relevan, tugas aktif, dan keputusan terbaru untuk sesi saat ini.

```json
{
	"owner": "my-org",
	"repo": "my-project",
	"objective": "implement auth",
	"limit": 5
}
```

### `decision-log` — Pencatatan Keputusan Terstruktur

Menyimpan keputusan dengan konteks, alasan, dan alternatif.

```json
{
	"summary": "Use SQLite over PostgreSQL",
	"context": "We need local-first storage without server setup",
	"rationale": "SQLite is embedded, zero-config, and sufficient for single-user agent workflows",
	"alternatives": ["PostgreSQL", "JSON files"]
}
```

### `session-summarize` — Mengarsipkan Ringkasan Sesi

```json
{
	"summary": "Implemented authentication flow with JWT tokens. Updated user model.",
	"key_decisions": ["Use JWT with 24h expiry"],
	"next_steps": ["Add refresh token rotation"],
	"repo": "my-project"
}
```

---

## Alias Kompatibilitas Hulu

Alat-alat ini cocok dengan antarmuka `Beledarian/mcp-local-memory` untuk kompatibilitas langsung:

| Hulu             | Dipetakan Ke            | Deskripsi               |
| :--------------- | :---------------------- | :---------------------- |
| `remember_fact`  | `memory-store`          | Menyimpan sebuah fakta  |
| `remember_facts` | `memory-store` (massal) | Menyimpan banyak fakta  |
| `recall`         | `memory-search`         | Mencari memori          |
| `forget`         | `memory-delete`         | Menghapus sebuah memori |
