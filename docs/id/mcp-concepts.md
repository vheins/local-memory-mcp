# Referensi Protokol MCP (v2025-03-26)

Dokumen ini merinci antarmuka teknis yang diekspos oleh server `local-memory-mcp` untuk Agen AI, sepenuhnya sesuai dengan [Model Context Protocol (MCP) Specification v2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26/server).

> **Sumber versi protokol:** server mengiklankan `2025-03-26` — lihat `MCP_PROTOCOL_VERSION` di `src/mcp/capabilities.ts`. Tautan spesifikasi di bawah mengarah ke versi tersebut.

## Siklus Hidup Server & Kemampuan

- **Protocol Version**: `2025-03-26`
- **Transport**: JSON-RPC 2.0 melalui standard input/output (stdio).
- **Supported Capabilities**:
  - `tools` (list, call)
  - `resources` (list, read, subscribe, listChanged notifications)
  - `prompts` (list, get, listChanged notifications)
  - `logging` (setLevel, message notifications)
  - `completions` (complete)

## Persyaratan Dasar Protokol (JSON-RPC 2.0)

Sesuai dengan [MCP Basic Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic), semua komunikasi dengan server ini harus mematuhi JSON-RPC 2.0 secara ketat:

- **Requests & Responses:** Semua permintaan WAJIB menyertakan `id` yang valid dan tidak null (string atau integer) yang BELUM pernah digunakan sebelumnya oleh pemohon dalam sesi aktif. Semua respons WAJIB menyertakan `id` yang cocok.
- **Notifications:** Pesan satu arah TIDAK BOLEH menyertakan kolom `id`. Penerima tidak boleh mengirim respons.
- **Schema Validation:** Semua skema input dan alat menggunakan JSON Schema draft **2020-12** secara default. Klien harus memvalidasi dialek skema yang sesuai.
- **Metadata (`_meta`):** Baik permintaan maupun notifikasi secara opsional dapat menyertakan objek `_meta` untuk melacak kemajuan atau melampirkan metadata di luar pita.
- **Authorization:** Karena server ini dirancang untuk **eksekusi lokal-first** melalui **stdio transport**, spesifikasi Otorisasi MCP (OAuth 2.1) **tidak berlaku**. Keamanan dikelola melalui izin filesystem lokal dan akses tingkat lingkungan.

## Manajemen Siklus Hidup

Sesuai dengan [MCP Lifecycle Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle), server memberlakukan initialization handshake yang ketat dan proses siklus hidup:

- **Initialization Handshake:** Koneksi dimulai dengan klien mengirimkan permintaan `initialize`. Server WAJIB merespons dengan kemampuannya. Klien kemudian WAJIB mengirimkan notifikasi `notifications/initialized`. Tidak ada permintaan lain (kecuali `ping`) yang diizinkan sebelum handshake ini selesai.
- **Liveness (Ping):** Baik klien maupun server mendukung metode `ping` untuk memverifikasi ketersambungan. Ping dapat dikirim kapan saja, termasuk selama inisialisasi.
- **Disconnection:** Pada transport stdio, pemutusan ditangani melalui proses stream. Klien keluar dengan baik dengan menutup input stream ke server, dan server mati dengan baik.
- **Error Handling:** Jika negosiasi versi protokol gagal selama inisialisasi, server mengembalikan error eksplisit `-32602` yang berisi versi `supported` dan `requested`.

## Utilitas: Ping

Sesuai dengan [MCP Ping Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/ping), server dan klien dapat memverifikasi ketersambungan:

- **Request Format:** Permintaan JSON-RPC standar dengan metode `"ping"` dan tanpa parameter.
- **Response Format:** Penerima WAJIB segera mengembalikan respons JSON-RPC dengan objek hasil kosong (`"result": {}`).
- **Timeout & Error Handling:** Jika respons tidak diterima dalam batas waktu yang wajar, pengirim DAPAT menganggap koneksi basi, mencatat kegagalan, atau mengatur ulang koneksi. Ping yang sering namun ringan direkomendasikan untuk mencegah proses menggantung tanpa menyebabkan overhead jaringan/pemrosesan yang berlebihan.

## Utilitas: Progress

Sesuai dengan [MCP Progress Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/progress), server mendukung notifikasi progress di luar pita untuk permintaan yang berjalan lama:

- **Progress Token:** Permintaan dapat menyertakan `_meta.progressToken` (string atau integer) yang disediakan oleh klien.
- **Progress Notification:** Saat memproses permintaan, server DAPAT mengeluarkan pesan `notifications/progress`. Notifikasi ini WAJIB menyertakan `progressToken` yang cocok, nilai `progress` yang meningkat secara ketat (angka), dan DAPAT secara opsional menyertakan `total` (angka) atau `message` yang dapat dibaca manusia.
- **Completion:** Pelacakan progress berakhir secara implisit ketika server mengembalikan respons JSON-RPC final (hasil atau error) untuk permintaan yang sesuai.

## Utilitas: Cancellation

Sesuai dengan [MCP Cancellation Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/cancellation), server mendukung pembatalan permintaan yang sedang berlangsung:

- **Notification Method:** Klien dapat mengirim notifikasi `notifications/cancelled` yang berisi `requestId` dan `reason` opsional.
- **Behavior:** Setelah menerima notifikasi ini, server memicu `AbortController` internal untuk permintaan aktif yang sesuai.
- **Response:** Jika permintaan belum selesai, server membatalkan pemrosesan yang mendasarinya (mis., query SQLite, vector embeddings, eksekusi alat) dan membuang respons. Klien TIDAK BOLEH mengharapkan respons JSON-RPC `result` atau `error` untuk permintaan yang berhasil dibatalkan.

## Persyaratan Transport STDIO

Sesuai dengan [MCP STDIO Transport Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), server mematuhi batasan ketat berikut:

- **Encoding & Formatting:** Semua pesan JSON-RPC WAJIB dienkode dalam **UTF-8**.
- **Delimiters:** Pesan WAJIB dibatasi oleh satu karakter newline. Pesan TIDAK BOLEH mengandung newline yang tertanam dalam payload mereka.
- **I/O Channels:** Server membaca permintaan/notifikasi dari `stdin` dan menulis respons/notifikasinya secara eksklusif ke `stdout`. Server TIDAK BOLEH menulis apa pun ke `stdout` yang bukan pesan JSON-RPC MCP yang valid.
- **Diagnostics & Logging:** Server DAPAT menulis string berenkode UTF-8 ke `stderr` untuk pencatatan informasi, debugging, atau error. Klien SEBAIKNYA tidak berasumsi bahwa output di `stderr` secara inheren mengindikasikan kesalahan protokol atau kegagalan kritis.

## Fitur Klien: Roots

Sesuai dengan [MCP Roots Specification](https://modelcontextprotocol.io/specification/2025-03-26/client/roots), server mendukung pemahaman batasan filesystem yang ditentukan klien:

- **Capability:** Klien WAJIB mendeklarasikan kemampuan `roots` selama initialization handshake.
- **List Request (`roots/list`):** Server DAPAT mengeluarkan permintaan `roots/list` ke klien untuk mengambil workspace aktif saat ini. Klien mengembalikan larik objek `Root`, masing-masing berisi `uri` wajib (yang HARUS menggunakan skema `file://`) dan `name` opsional.
- **Notifications (`notifications/roots/list_changed`):** Jika klien mendeklarasikan `roots: { listChanged: true }`, ia WAJIB mengeluarkan notifikasi `notifications/roots/list_changed` setiap kali batasan workspace-nya berubah, mendorong server untuk menyegarkan konteksnya.

---

## 1. Tools (Kontrol Model)

Alat adalah fungsi yang dapat dieksekusi yang diekspos ke LLM untuk melakukan tindakan, berinteraksi dengan basis data SQLite lokal, atau mengambil data dinamis.

### Manajemen Pengetahuan (Memory)

> **Nama alat:** server mendaftarkan **17 alat kanonik** (lihat `buildExecutors` di `src/mcp/tools/index.ts`). Nama lama bertitik (`memory-store`, `task-create`, …) **tidak** terdaftar; fungsinya digabung ke dalam alat terpadu di bawah dengan mode yang diinfersikan secara otomatis. Catatan "dulu" memberi pemetaan lama.

- **`memory-write`**: Alat tulis terpadu — menyimpan entri baru yang dapat diaudit manusia (`content` + `type` + `title`; dulu `memory-store`), memperbarui entri (`id`/`code` + field; dulu `memory-update`), atau mengakui penggunaan (`acknowledge: "used" | "irrelevant" | "contradictory"`; dulu `memory-acknowledge`). Mode praktis: `type: "decision"` dengan `context`/`rationale`/`alternatives` memformat otomatis entri keputusan importance-4; `type: "task_archive"` dengan `key_decisions`/`next_steps` memformat otomatis arsip importance-3.
- **`memory-read`**: Alat baca terpadu — pencarian (`query`; dulu `memory-search`), detail berdasarkan `id`/`code`/`ids`/`codes` (dulu `memory-detail`), atau rekap statistik + memori teratas (tanpa parameter; dulu `memory-recap`).
- **`memory-delete`**: Menghapus lunak satu atau beberapa entri memori. Mendukung `id` tunggal atau massal melalui `ids`.
- **`synthesize`**: Alat penalaran tingkat lanjut yang mensintesis jawaban berdasarkan bukti menggunakan LLM klien (dulu `memory-synthesize`). Hanya didaftarkan jika klien mendeklarasikan kapabilitas `sampling`.
- **`repo-summarize`**: Memperbarui ringkasan tingkat tinggi untuk repositori (dulu `memory-summarize`).

### Manajemen Tugas

- **`task-read`**: Alat baca terpadu — daftar (tanpa parameter; dulu `task-list`), detail berdasarkan `id`/`task_code` (dulu `task-detail`), atau pencarian (`query`).
- **`task-write`**: Alat tulis terpadu — membuat satu atau beberapa tugas baru (`phase` + `title` + `description`; dulu `task-create`), pembuatan interaktif via elicitation (`interactive: true`; dulu `task-create-interactive`), pembaruan (`id`/`code`; dulu `task-update`), atau massal (`tasks[]`). Memajukan tugas melalui `backlog → pending → in_progress → completed/canceled/blocked`; `comment` wajib saat perubahan status, dan `completed` mensyaratkan semua anak selesai lebih dulu.
- **`task-delete`**: Penghapusan permanen catatan tugas. Mendukung `id` tunggal atau massal melalui `ids`.

---

## 2. Resources (Kontrol Aplikasi)

Resources menyediakan akses hanya-baca ke tampilan data khusus dan pengetahuan global menggunakan skema URI yang terbatas pada repositori. Server mendukung pembaruan waktu nyata melalui `resources/subscribe`.

### Resources Global

- **`repository://index`**: Daftar semua repositori yang tersedia dalam sistem.
- **`session://roots`**: Daftar root workspace aktif yang disediakan oleh sesi klien saat ini.

### Resources Repositori (Templat)

- **`repository://{name}/memories`**: Daftar semua memori aktif untuk repositori tertentu (dengan paginasi).
- **`repository://{name}/memories?search={search}&type={type}&tag={tag}`**: Daftar memori yang difilter berdasarkan repositori.
- **`memory://{id}`**: Akses langsung ke entri memori tertentu (detail dan statistik lengkap) berdasarkan UUID-nya.
- **`repository://{name}/summary`**: Mengambil ringkasan/sinyal global tingkat tinggi untuk repositori.
- **`repository://{name}/tasks`**: Daftar semua tugas untuk repositori tertentu (dengan paginasi).
- **`repository://{name}/tasks?status={status}&priority={priority}`**: Daftar tugas terbatas untuk repositori dengan penyaringan. Filter prioritas (`priority` 1–5) memakai semantik tugas local-memory-mcp: `1=Low`, `2=Normal`, `3=Medium`, `4=High`, `5=Critical` — label yang sama dengan dashboard (`getPriorityLabel` di `src/dashboard/ui/src/lib/utils.ts`); ini bukan field yang ditentukan spesifikasi MCP.
- **`task://{id}`**: Akses langsung ke tugas tertentu (deskripsi dan komentar lengkap) berdasarkan UUID-nya.
- **`repository://{name}/actions`**: Stream dengan paginasi dari semua tindakan alat agen yang dicatat dalam repositori.
- **`action://{id}`**: Akses langsung ke entri log audit tindakan tertentu berdasarkan ID integernya.

---

## 3. Prompts (Kontrol Pengguna)

Prompts adalah templat instruksi yang telah ditentukan yang memandu interaksi model.

### Batasan: Dukungan MCP Prompts oleh Agent

Tidak semua coding agent mendukung MCP **prompts** (kemampuan untuk mendaftar/mendapatkan templat prompt). Berikut matriks kompatibilitasnya:

| Agent                    | MCP Prompts           | Catatan                                          |
| ------------------------ | --------------------- | ------------------------------------------------ |
| Claude Desktop           | ✅ Didukung           | Muncul sebagai perintah slash                    |
| Claude Code              | ✅ Didukung           | Dipanggil sebagai `/mcp__servername__promptname` |
| Cursor                   | ✅ Didukung           | Prompts didukung, Resources TIDAK didukung       |
| Windsurf                 | ✅ Didukung           | Semua: Tools, Prompts, Resources                 |
| GitHub Copilot (VS Code) | ✅ Didukung           | Gunakan `/<server>.<prompt>` di chat             |
| Continue.dev             | ✅ Didukung           | Muncul sebagai slash command di agent mode       |
| Zed                      | ✅ Didukung           | Sebagai slash command                            |
| Gemini CLI               | ✅ Didukung           |                                                  |
| **Codex CLI (OpenAI)**   | ❌ **Tidak Didukung** | Hanya Tools + Resources                          |
| Cline                    | ❌ Tidak Didukung     | Hanya Tools + Resources                          |

Jika agent Anda tidak mendukung prompts, Anda tetap bisa menggunakan perilaku yang sama melalui **Tools** (misalnya instruksi `memory-agent-core` bisa di-prompt secara manual), atau memicu prompts melalui **Dashboard** UI.

### Prompts Siklus Hidup Inti

- **`memory-agent-core`**: Kontrak perilaku penting untuk agen yang sadar memori.
- **`project-briefing`**: Templat orientasi untuk memulai sesi baru dalam repositori.

### Prompts Alur Kerja Khusus

- **`task-management-guidelines`**: Kontrak siklus hidup dan koordinasi tugas untuk mengelola inisiatif multi-tugas yang kompleks (menggantikan prompt `task-orchestrator` lama, yang tidak terdaftar).
- **`senior-code-review`**: Templat tinjauan standar tinggi yang berfokus pada pola khusus proyek.
- **`root-cause-analysis`**: Templat debugging untuk melacak bug kembali ke asalnya.

> Set prompt terdaftar lengkap dimuat dari `src/mcp/prompts/definitions/` (mis., `session-planner`, `create-task`, `memory-agent-core`, `project-briefing`) dan disajikan melalui `prompts/list` + `prompts/get`.

---

## 4. Dukungan Kemampuan Tingkat Lanjut

Fitur-fitur berikut sesuai dengan spesifikasi MCP standar.

- **Completions**: Didukung melalui `completion/complete` untuk menyediakan pelengkapan otomatis untuk argumen prompt atau input alat.
- **Logging**: Server mendukung penyesuaian level log dinamis melalui `logging/setLevel` dan mengeluarkan log terstruktur melalui `notifications/message`.
- **Sampling**: Memanfaatkan kemampuan klien `sampling/createMessage` untuk menghasilkan ringkasan memori yang disintesis.
- **Elicitation**: Memanfaatkan kemampuan klien `elicitation/create` untuk formulir pembuatan tugas interaktif.

---

## ⚠️ Tanpa Jaminan

Antarmuka dan respons MCP disediakan **"SEBAGAIMANA ADANYA"** tanpa jaminan apa pun.
