# Referensi Protokol MCP (v2025-11-25)

Dokumen ini merinci antarmuka teknis yang diekspos oleh server `local-memory-mcp` untuk Agen AI, sepenuhnya sesuai dengan [Model Context Protocol (MCP) Specification v2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server).

## Siklus Hidup Server & Kemampuan

- **Protocol Version**: `2025-11-25`
- **Transport**: JSON-RPC 2.0 melalui standard input/output (stdio).
- **Supported Capabilities**:
  - `tools` (list, call)
  - `resources` (list, read, subscribe, listChanged notifications)
  - `prompts` (list, get, listChanged notifications)
  - `logging` (setLevel, message notifications)
  - `completions` (complete)

## Persyaratan Dasar Protokol (JSON-RPC 2.0)

Sesuai dengan [MCP Basic Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic), semua komunikasi dengan server ini harus mematuhi JSON-RPC 2.0 secara ketat:
- **Requests & Responses:** Semua permintaan WAJIB menyertakan `id` yang valid dan tidak null (string atau integer) yang BELUM pernah digunakan sebelumnya oleh pemohon dalam sesi aktif. Semua respons WAJIB menyertakan `id` yang cocok.
- **Notifications:** Pesan satu arah TIDAK BOLEH menyertakan kolom `id`. Penerima tidak boleh mengirim respons.
- **Schema Validation:** Semua skema input dan alat menggunakan JSON Schema draft **2020-12** secara default. Klien harus memvalidasi dialek skema yang sesuai.
- **Metadata (`_meta`):** Baik permintaan maupun notifikasi secara opsional dapat menyertakan objek `_meta` untuk melacak kemajuan atau melampirkan metadata di luar pita.
- **Authorization:** Karena server ini dirancang untuk **eksekusi lokal-first** melalui **stdio transport**, spesifikasi Otorisasi MCP (OAuth 2.1) **tidak berlaku**. Keamanan dikelola melalui izin filesystem lokal dan akses tingkat lingkungan.

## Manajemen Siklus Hidup

Sesuai dengan [MCP Lifecycle Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), server memberlakukan initialization handshake yang ketat dan proses siklus hidup:
- **Initialization Handshake:** Koneksi dimulai dengan klien mengirimkan permintaan `initialize`. Server WAJIB merespons dengan kemampuannya. Klien kemudian WAJIB mengirimkan notifikasi `notifications/initialized`. Tidak ada permintaan lain (kecuali `ping`) yang diizinkan sebelum handshake ini selesai.
- **Liveness (Ping):** Baik klien maupun server mendukung metode `ping` untuk memverifikasi ketersambungan. Ping dapat dikirim kapan saja, termasuk selama inisialisasi.
- **Disconnection:** Pada transport stdio, pemutusan ditangani melalui proses stream. Klien keluar dengan baik dengan menutup input stream ke server, dan server mati dengan baik.
- **Error Handling:** Jika negosiasi versi protokol gagal selama inisialisasi, server mengembalikan error eksplisit `-32602` yang berisi versi `supported` dan `requested`.

## Utilitas: Ping

Sesuai dengan [MCP Ping Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping), server dan klien dapat memverifikasi ketersambungan:
- **Request Format:** Permintaan JSON-RPC standar dengan metode `"ping"` dan tanpa parameter.
- **Response Format:** Penerima WAJIB segera mengembalikan respons JSON-RPC dengan objek hasil kosong (`"result": {}`).
- **Timeout & Error Handling:** Jika respons tidak diterima dalam batas waktu yang wajar, pengirim DAPAT menganggap koneksi basi, mencatat kegagalan, atau mengatur ulang koneksi. Ping yang sering namun ringan direkomendasikan untuk mencegah proses menggantung tanpa menyebabkan overhead jaringan/pemrosesan yang berlebihan.

## Utilitas: Progress

Sesuai dengan [MCP Progress Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress), server mendukung notifikasi progress di luar pita untuk permintaan yang berjalan lama:
- **Progress Token:** Permintaan dapat menyertakan `_meta.progressToken` (string atau integer) yang disediakan oleh klien.
- **Progress Notification:** Saat memproses permintaan, server DAPAT mengeluarkan pesan `notifications/progress`. Notifikasi ini WAJIB menyertakan `progressToken` yang cocok, nilai `progress` yang meningkat secara ketat (angka), dan DAPAT secara opsional menyertakan `total` (angka) atau `message` yang dapat dibaca manusia.
- **Completion:** Pelacakan progress berakhir secara implisit ketika server mengembalikan respons JSON-RPC final (hasil atau error) untuk permintaan yang sesuai.

## Utilitas: Cancellation

Sesuai dengan [MCP Cancellation Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation), server mendukung pembatalan permintaan yang sedang berlangsung:
- **Notification Method:** Klien dapat mengirim notifikasi `notifications/cancelled` yang berisi `requestId` dan `reason` opsional.
- **Behavior:** Setelah menerima notifikasi ini, server memicu `AbortController` internal untuk permintaan aktif yang sesuai.
- **Response:** Jika permintaan belum selesai, server membatalkan pemrosesan yang mendasarinya (mis., query SQLite, vector embeddings, eksekusi alat) dan membuang respons. Klien TIDAK BOLEH mengharapkan respons JSON-RPC `result` atau `error` untuk permintaan yang berhasil dibatalkan.

## Persyaratan Transport STDIO

Sesuai dengan [MCP STDIO Transport Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), server mematuhi batasan ketat berikut:
- **Encoding & Formatting:** Semua pesan JSON-RPC WAJIB dienkode dalam **UTF-8**.
- **Delimiters:** Pesan WAJIB dibatasi oleh satu karakter newline. Pesan TIDAK BOLEH mengandung newline yang tertanam dalam payload mereka.
- **I/O Channels:** Server membaca permintaan/notifikasi dari `stdin` dan menulis respons/notifikasinya secara eksklusif ke `stdout`. Server TIDAK BOLEH menulis apa pun ke `stdout` yang bukan pesan JSON-RPC MCP yang valid.
- **Diagnostics & Logging:** Server DAPAT menulis string berenkode UTF-8 ke `stderr` untuk pencatatan informasi, debugging, atau error. Klien SEBAIKNYA tidak berasumsi bahwa output di `stderr` secara inheren mengindikasikan kesalahan protokol atau kegagalan kritis.

## Fitur Klien: Roots

Sesuai dengan [MCP Roots Specification](https://modelcontextprotocol.io/specification/2025-11-25/client/roots), server mendukung pemahaman batasan filesystem yang ditentukan klien:
- **Capability:** Klien WAJIB mendeklarasikan kemampuan `roots` selama initialization handshake.
- **List Request (`roots/list`):** Server DAPAT mengeluarkan permintaan `roots/list` ke klien untuk mengambil workspace aktif saat ini. Klien mengembalikan larik objek `Root`, masing-masing berisi `uri` wajib (yang HARUS menggunakan skema `file://`) dan `name` opsional.
- **Notifications (`notifications/roots/list_changed`):** Jika klien mendeklarasikan `roots: { listChanged: true }`, ia WAJIB mengeluarkan notifikasi `notifications/roots/list_changed` setiap kali batasan workspace-nya berubah, mendorong server untuk menyegarkan konteksnya.

---

## 1. Tools (Kontrol Model)

Alat adalah fungsi yang dapat dieksekusi yang diekspos ke LLM untuk melakukan tindakan, berinteraksi dengan basis data SQLite lokal, atau mengambil data dinamis.

### Manajemen Pengetahuan (Memory)
- **`memory-store`**: Menyimpan entri pengetahuan baru yang dapat diaudit manusia (mis., `code_fact`, `decision`, `mistake`).
- **`memory-search`**: LAPISAN NAVIGASI: Mengembalikan tabel pointer dari ID memori yang cocok.
- **`memory-synthesize`**: Alat penalaran tingkat lanjut yang mensintesis jawaban berdasarkan bukti menggunakan LLM klien.
- **`memory-detail`**: Mengambil konten lengkap dan metadata untuk memori tertentu berdasarkan ID-nya.
- **`memory-acknowledge`**: (WAJIB) Mengakui penggunaan memori atau melaporkan ketidakrelevannya.
- **`memory-update`**: Memperbarui entri memori yang ada (mis., status, kepentingan, atau metadata).
- **`memory-delete`**: Menghapus lunak satu atau beberapa entri memori. Mendukung penghapusan tunggal `id` atau massal melalui `ids`.
- **`memory-summarize`**: Memperbarui ringkasan global tingkat tinggi untuk repositori.
- **`memory-recap`**: IKHTISAR TERAGREGASI: Mengembalikan statistik dan memori teratas dalam repo.

### Manajemen Tugas
- **`task-list`**: Alat navigasi dan pencarian UTAMA. Mengembalikan daftar tugas dalam bentuk tabel.
- **`task-create`**: Mendaftarkan satu atau beberapa tugas baru. Mendukung pembuatan tunggal atau massal. Mendukung fallback elicitation MCP untuk bidang yang hilang.
- **`task-create-interactive`**: Membuat tugas secara interaktif dengan meminta input pengguna melalui elicitation.
- **`task-detail`**: Mengambil deskripsi lengkap, fase, prioritas, status koordinasi, dan semua komentar untuk tugas tertentu.
- **`task-update`**: Memajukan satu atau beberapa tugas melalui siklus hidupnya (Backlog → Pending → In Progress → Completed). Mendukung pembaruan massal melalui `ids`.
- **`task-delete`**: Penghapusan permanen catatan tugas. Mendukung penghapusan tunggal `id` atau massal melalui `ids`.

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
- **`repository://{name}/tasks?status={status}&priority={priority}`**: Daftar tugas terbatas untuk repositori dengan penyaringan. Prioritas menggunakan semantik MCP: `1=Low`, `2=Normal`, `3=Medium`, `4=High`, `5=Critical`.
- **`task://{id}`**: Akses langsung ke tugas tertentu (deskripsi dan komentar lengkap) berdasarkan UUID-nya.
- **`repository://{name}/actions`**: Stream dengan paginasi dari semua tindakan alat agen yang dicatat dalam repositori.
- **`action://{id}`**: Akses langsung ke entri log audit tindakan tertentu berdasarkan ID integernya.

---

## 3. Prompts (Kontrol Pengguna)

Prompts adalah templat instruksi yang telah ditentukan yang memandu interaksi model.

### Prompts Siklus Hidup Inti
- **`memory-agent-core`**: Kontrak perilaku penting untuk agen yang sadar memori.
- **`project-briefing`**: Templat orientasi untuk memulai sesi baru dalam repositori.

### Prompts Alur Kerja Khusus
- **`task-orchestrator`**: Dikhususkan untuk mengelola inisiatif multi-tugas yang kompleks.
- **`senior-code-review`**: Templat tinjauan standar tinggi yang berfokus pada pola khusus proyek.
- **`root-cause-analysis`**: Templat debugging untuk melacak bug kembali ke asalnya.

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
