# Ringkasan Spesifikasi Model Context Protocol (MCP) 2025-11-25

Dokumen ini merupakan hasil pembelajaran dan sintesis dari spesifikasi resmi MCP versi 2025-11-25, mencakup fitur server, klien, serta aspek keamanan dan transportnya.

## 1. Fitur Server (Server Features)

### A. Prompts (Templat Instruksi)
- **Fungsi:** Standarisasi cara server mengekspos templat pesan/instruksi kepada klien.
- **Persyaratan Teknis:**
  - Server harus mendeklarasikan kapabilitas `prompts` saat inisialisasi.
  - Mendukung metode `prompts/list` (dengan paginasi) dan `prompts/get`.
  - Tipe konten pesan mencakup: teks, gambar, audio (base64-encoded), dan sumber daya tersemat (*embedded resources*).
- **Kendala Utama:**
  - **Validasi:** Server wajib memvalidasi argumen prompt sebelum diproses.
  - **Keamanan:** Implementasi harus waspada terhadap serangan injeksi melalui input prompt.

### B. Resources (Sumber Data)
- **Fungsi:** Berbagi data (file, skema DB, dll.) sebagai konteks untuk LLM melalui URI unik.
- **Persyaratan Teknis:**
  - Mendukung metode `resources/list`, `resources/read`, dan `resources/templates/list`.
  - Fitur opsional: `subscribe` (langganan perubahan) dan `listChanged` (notifikasi perubahan daftar).
  - Anotasi sumber daya: `audience` (user/assistant), `priority` (0.0 - 1.0), dan `lastModified`.
- **Kendala Utama:**
  - **Skema URI:** Skema `https://` hanya digunakan jika klien bisa mengambil data sendiri. Untuk data internal, gunakan skema kustom atau `file://`.
  - **Keamanan:** Server wajib memvalidasi semua URI sumber daya dan menerapkan kontrol akses.

### C. Tools (Alat Eksekusi)
- **Fungsi:** Fungsi yang dapat dipanggil oleh LLM untuk berinteraksi dengan sistem eksternal (API, DB).
- **Persyaratan Teknis:**
  - Mendukung metode `tools/list` dan `tools/call`.
  - Input menggunakan JSON Schema (default versi 2020-12).
  - Hasil alat dapat berupa konten terstruktur atau tidak terstruktur.
- **Kendala Utama:**
  - **Human-in-the-loop:** Sangat disarankan adanya konfirmasi manusia sebelum alat dijalankan (terutama operasi sensitif).
  - **Penamaan:** Nama alat harus 1-128 karakter, *case-sensitive*, dan hanya menggunakan karakter ASCII tertentu (A-Z, a-z, 0-9, `_`, `-`, `.`).
  - **Error Handling:** Membedakan antara *Protocol Error* (masalah JSON-RPC) dan *Tool Execution Error* (masalah logika bisnis).

### D. Utilities: Completion (Autolengkap)
- **Fungsi:** Menyediakan saran autolengkap untuk argumen prompt dan templat sumber daya.
- **Persyaratan Teknis:**
  - Metode: `completion/complete`.
  - Mendukung referensi tipe `ref/prompt` dan `ref/resource`.
- **Kendala Utama:**
  - **Limitasi:** Maksimal 100 saran per respons.
  - **Performa:** Klien harus melakukan *debouncing* pada permintaan yang cepat, dan server harus mengurutkan saran berdasarkan relevansi.

---

## 2. Fitur Klien (Client Features)

### A. Roots (Batasan Filesystem)
- **Fungsi:** Klien mengekspos dan menentukan batas direktori kerja (*workspace roots*) yang dapat diakses oleh server.
- **Deklarasi Kapabilitas:** Klien wajib mendeklarasikan kapabilitas `roots` pada saat fase *initialization handshake*.
- **Metode Utama:** `roots/list`. Server dapat mengirimkan permintaan ini ke klien untuk mengambil daftar direktori aktif. Klien wajib mengembalikan _array_ berisi objek `Root`.
- **Objek Root:** Masing-masing objek `Root` berisi:
  - `uri` (Wajib): URI yang menunjukkan lokasi direktori (harus menggunakan skema `file://`).
  - `name` (Opsional): Nama referensi dari direktori tersebut.
- **Notifikasi Perubahan:** Jika klien mendukung `roots: { listChanged: true }`, klien wajib mengirimkan notifikasi satu arah `notifications/roots/list_changed` kepada server setiap kali struktur atau daftar _workspace root_ berubah.
- **Kendala Utama:**
  - **URI:** Saat ini hanya mendukung skema `file://`.
  - **Keamanan:** Klien harus memvalidasi URI untuk mencegah serangan *path traversal*. Server harus menghormati batasan *root* yang diberikan.

### B. Sampling (Akses LLM)
- **Fungsi:** Server meminta klien untuk melakukan generasi teks/media dari LLM tanpa perlu kunci API di sisi server.
- **Persyaratan Teknis:**
  - Metode: `sampling/createMessage`.
  - Mendukung preferensi model melalui *hints* (saran nama model) dan prioritas (biaya, kecepatan, kecerdasan).
  - Mendukung *multi-turn tool loop* (LLM memanggil alat di dalam proses sampling).
- **Kendala Utama:**
  - **Integritas Pesan:** Pesan dengan tipe `tool_result` **tidak boleh** dicampur dengan tipe konten lain (teks/gambar) dalam satu pesan yang sama.
  - **Keamanan:** Harus ada kontrol persetujuan pengguna untuk setiap permintaan sampling.

### C. Elicitation (Permintaan Informasi Pengguna)
- **Fungsi:** Server meminta informasi tambahan dari pengguna melalui klien.
- **Mode Operasi:**
  1. **Form Mode:** Pengumpulan data terstruktur (teks, angka, boolean) menggunakan subset JSON Schema yang dibatasi (hanya objek datar).
  2. **URL Mode:** Mengarahkan pengguna ke URL eksternal untuk interaksi sensitif (OAuth, pembayaran).
- **Kendala Utama:**
  - **Larangan Data Sensitif:** **Dilarang keras** menggunakan *Form Mode* untuk meminta password, kunci API, atau data kartu kredit. Gunakan *URL Mode* untuk hal ini.
  - **Keamanan URL:** Klien dilarang melakukan *pre-fetch* URL secara otomatis dan harus menampilkan URL lengkap sebelum pengguna memberikan persetujuan.
  - **Phishing:** Server harus memverifikasi bahwa pengguna yang membuka URL adalah pengguna yang sama yang memicu permintaan (misalnya melalui session cookie).

---

## 3. Manajemen Siklus Hidup (Lifecycle Management)

### A. Inisialisasi (Initialization)
- **Fungsi:** Handshake tiga langkah yang wajib dilakukan sebelum operasi apa pun berjalan.
- **Tahapan:**
  1. Klien mengirim request `initialize` dengan kapabilitas dan versinya.
  2. Server merespons dengan kapabilitas dan konfirmasi protokol versinya.
  3. Klien wajib merespons balik dengan notifikasi `notifications/initialized`.
- **Kendala Utama:** Tidak boleh ada _request_ selain `ping` yang dikirim sebelum proses ini berhasil dipertukarkan. Jika ada ketidakcocokan versi, server membalas dengan *Protocol Error* (`-32602`) lalu memutuskan koneksi.

### B. Liveness (Ping)
- **Fungsi:** Mengecek status koneksi secara dua arah (dikirim oleh klien maupun server kapan saja) tanpa menginterupsi jalannya *handshake* atau _request_ utama.
- **Format Pesan:** *Request* JSON-RPC standar dengan metode `"ping"` tanpa parameter (`"params"` tidak diisi/dikosongkan).
- **Format Respons:** Pihak yang menerima pesan `ping` WAJIB sesegera mungkin membalas dengan objek JSON-RPC standar yang berisi *result* kosong (`"result": {}`).
- **Kendala Utama:** Jika respons tidak diterima dalam batas waktu (_timeout_) yang wajar, pengirim BERHAK memutuskan bahwa koneksi telah terputus (stale) dan dapat memutuskan sambungan atau melakukan upaya penyambungan ulang. _Ping_ disarankan rutin namun tidak boleh terlalu sering agar tak membebani komputasi jaringan.

### C. Pemutusan Koneksi (Disconnection)
- **Transport Stdio:** Klien harus menutup *input stream* (stdin) dan menunggu server mati dengan mulus sebelum menggunakan instruksi _shutdown_ paksa (seperti SIGTERM/SIGKILL).
- **Transport HTTP:** Pemutusan secara langsung dilakukan melalui penutupan koneksi web/socket.

---

## 4. Spesifikasi Transport (STDIO)

### Aturan Format & Kanal (I/O)
- **Format Pesan:** Protokol menggunakan JSON-RPC yang wajib di-_encode_ menggunakan **UTF-8**.
- **Delimitasi Newline:** Setiap pesan JSON wajib dipisahkan oleh satu karakter *newline* (`\n`). Pesan sama sekali tidak boleh mengandung *newline* di dalam *payload* atau datanya (*embedded newlines*).
- **Kanal Utama:** Server membaca seluruh instruksi dari `stdin` dan mengirim balik respons/notifikasi hanya melalui `stdout`. Server tidak boleh mengirim apa pun ke `stdout` selain pesan JSON-RPC yang valid menurut MCP.

### Penggunaan Stderr
- **Logging/Error:** Server dapat menggunakan saluran `stderr` untuk mencetak _string_ UTF-8 yang berisi log diagnostik, informasi, maupun _error_.
- **Asumsi Klien:** Klien tidak boleh mengasumsikan bahwa keluaran pada saluran `stderr` menandakan kerusakan (crash) atau kegagalan protokol secara absolut.

---

## 5. Spesifikasi Utilities (Progress & Cancellation)

### A. Pelaporan Kemajuan (Progress: `notifications/progress`)
- **Fungsi:** Menyediakan pembaruan status atau metrik _progress_ _out-of-band_ untuk _request_ yang membutuhkan waktu komputasi panjang (misalnya pembuatan *embedding* atau ekstraksi data massal).
- **Mekanisme Klien:** Klien wajib melampirkan atribut `progressToken` (dapat berupa string atau angka) pada objek `_meta` di *request* aslinya.
- **Mekanisme Server:** Secara berkala, server mengirimkan notifikasi satu arah (`notifications/progress`) kembali ke klien.
- **Format Pesan:** Parameter wajib meliputi `progressToken` yang sama dan angka `progress` (yang harus selalu naik/meningkat). Parameter opsional meliputi estimasi batas `total` (angka) dan `message` (teks yang bisa dibaca manusia). Notifikasi progres dianggap berakhir secara otomatis ketika server akhirnya memberikan balasan final berupa `result` atau `error` untuk *request* aslinya.

### B. Pembatalan Request (`notifications/cancelled`)
- **Fungsi:** Memungkinkan klien untuk membatalkan proses *request* yang sedang berlangsung (*in-flight*) di sisi server, menghemat sumber daya sistem (contohnya membatalkan *embedding* vektor atau _query_ database yang memakan waktu lama).
- **Mekanisme Klien:** Klien mengirimkan notifikasi satu arah dengan nama metode `notifications/cancelled`. Parameter yang wajib ada adalah `requestId` (menunjuk ID dari *request* asli yang ingin dibatalkan), dan klien dapat menyertakan parameter `reason` sebagai alasan opsional.
- **Mekanisme Server:** Saat menerima notifikasi ini, server akan memicu `AbortController` yang terkait dengan `requestId` tersebut.
- **Respons:** Proses yang diinterupsi oleh pembatalan ini akan dihentikan secara prematur, dan server **tidak akan** mengirimkan `result` maupun balasan pesan ke klien.

---

## 6. Spesifikasi Otorisasi (Authorization)

### Otorisasi Berbasis OAuth 2.1
- **Fungsi:** Mengamankan akses ke server MCP (khusus untuk transport HTTP).
- **Transport HTTP:** Wajib menggunakan skema otorisasi bearer (`Authorization: Bearer <token>`). Token harus divalidasi audiensnya (Audience Binding) untuk mencegah *confused deputy*. Mendukung *Step-up Flow* (merespons dengan HTTP 403 jika *scope* kurang dan memberikan *header* `WWW-Authenticate`).
- **Transport STDIO:** Spesifikasi otorisasi ini **tidak boleh** digunakan. Kredensial untuk akses harus disediakan melalui lingkungan lokal (misal: *environment variables*).

---

## 7. Ringkasan Kendala Teknis & Keamanan Global

1. **Validasi Ketat:** Semua input (URI, argumen, skema JSON) harus divalidasi oleh kedua belah pihak untuk mencegah eksploitasi (seperti path traversal dan injeksi command).
2. **Negosiasi Kapabilitas:** Klien dan server harus saling menghormati kapabilitas yang dideklarasikan saat inisialisasi. Tidak boleh mengirim permintaan untuk fitur yang tidak dideklarasikan.
3. **Privasi & Persetujuan:** Protokol ini sangat menekankan kontrol pengguna (*human-in-the-loop*), terutama untuk eksekusi alat, sampling LLM, dan pengumpulan data sensitif.
4. **Paginasi:** Untuk daftar yang besar (prompts, resources, tools), implementasi harus mendukung kursor paginasi untuk efisiensi memori dan transport.
5. **Transport:** MCP dirancang berjalan secara utuh di atas JSON-RPC 2.0 (stdio, SSE, dll.), sehingga setiap request/response harus patuh pada format tersebut, serta memisahkan *protocol error* dari *domain error*.