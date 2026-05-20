# Referensi Alat & Panduan Penggunaan

Panduan praktis untuk alat-alat yang diekspos server MCP ini kepada agen AI. Setiap alat dikelompokkan berdasarkan domain dengan pola penggunaan dan contoh.

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
  "scope": { "repo": "my-project" },
  "tags": ["database", "architecture"]
}
```

**Bidang:**
- `type` (`code_fact`, `decision`, `mistake`, `pattern`, `task_archive`) — jenis pengetahuan ini
- `importance` (1-5) — seberapa kritis ini; semakin tinggi = semakin lambat meluruh
- `scope.repo` — proyek tempat ini berada
- `tags` — label teknologi untuk kemudahan ditemukan lintas proyek

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
{ "code": "Q7PXYE" }
```

Mendukung pencarian berdasarkan `id` (UUID) atau `code` (kode pendek seperti `Q7PXYE`).

### `memory-update` — Mengedit Memori yang Ada

```json
{
  "code": "Q7PXYE",
  "importance": 5,
  "status": "archived"
}
```

### `memory-acknowledge` — Melaporkan Kegunaan Memori

Wajib setelah menggunakan memori untuk menghasilkan kode. Membantu sistem peluruhan mengetahui apa yang berguna.

```json
{
  "code": "Q7PXYE",
  "status": "used",
  "application_context": "Used this pattern when implementing the auth middleware"
}
```

### `memory-delete` — Menghapus Memori

Tunggal atau massal:

```json
{ "code": "Q7PXYE" }
```

```json
{ "codes": ["Q7PXYE", "ZZUHFH"] }
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

```json
{
  "repo": "my-project",
  "task_code": "AUTH-001",
  "phase": "implementation",
  "title": "Implement JWT middleware",
  "description": "1. Create middleware class\n2. Add token validation\n3. Write tests",
  "priority": 4,
  "status": "pending"
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
{ "code": "J78C5E" }
```

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
  "code": "J78C5E",
  "name": "React Component Naming (Updated)",
  "version": "2.0.0"
}
```

### `standard-delete` — Menghapus Standar

```json
{ "code": "J78C5E" }
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

| Grup | Alat | Tujuan |
|-------|-------|---------|
| Memory | store, search, detail, update, acknowledge, delete, recap, summarize, synthesize | Pengetahuan tahan lama jangka panjang |
| Task | create, list, detail, update, delete | Siklus hidup item pekerjaan |
| Standard | store, search, detail, update, delete | Aturan koding yang dapat digunakan kembali |
| Coordination | handoff-create, handoff-list, handoff-update, task-claim, claim-list, claim-release | Orkestrasi multi-agen |
