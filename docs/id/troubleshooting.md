# Panduan Pemecahan Masalah

Masalah umum saat menginstal atau menjalankan MCP Local Memory Service.

---

## Server Tidak Mau Mulai / Handshake MCP Gagal

### Gejala
Klien AI Anda menampilkan error seperti `MCP server disconnected` atau `Failed to initialize`.

### Pemeriksaan 1: Versi Node.js
```bash
node --version   # membutuhkan >= 18
```
Server ini menggunakan `fetch`, `AbortController`, dan API modern lainnya. Node 18+ diperlukan.

### Pemeriksaan 2: Instalasi Rusak
```bash
npm uninstall -g @vheins/local-memory-mcp
npm install -g @vheins/local-memory-mcp
```

### Pemeriksaan 3: Masalah Cache npx
Jika menggunakan `npx`, bersihkan cache:
```bash
npx clear-npx-cache 2>/dev/null || rm -rf ~/.npm/_npx
```
Kemudian coba lagi. Pengunduhan pertama mengunduh paket dan bisa memakan waktu 10-30 detik.

### Pemeriksaan 4: Biner Tidak Ditemukan Setelah Instalasi Global
```bash
which local-memory-mcp   # seharusnya menunjukkan jalur
```
Jika kosong, bin global npm Anda mungkin tidak ada di `$PATH`:
```bash
npm bin -g   # menunjukkan direktori
# Tambahkan ke profil shell Anda:
export PATH="$(npm bin -g):$PATH"
```

---

## Dasbor Tidak Mau Muat

### Gejala
`localhost:3456` menunjukkan koneksi ditolak atau halaman kosong.

### Pemeriksaan 1: Apakah Server Berjalan?
```bash
npx @vheins/local-memory-mcp dashboard
```
Anda akan melihat:
```
MCP Memory Dashboard running on http://localhost:3456
```

### Pemeriksaan 2: Konflik Port
```bash
lsof -i :3456   # macOS/Linux
netstat -ano | findstr :3456   # Windows
```
Jika ada sesuatu yang menggunakan port 3456, matikan atau gunakan port yang berbeda melalui env `PORT`:
```bash
PORT=3457 npx @vheins/local-memory-mcp dashboard
```

### Pemeriksaan 3: Dasbor Terbuka tetapi Tidak Menampilkan Data
Dasbor memuat data dari basis data SQLite yang sama yang digunakan server MCP. Jika server MCP tidak pernah dijalankan, belum ada data. Buat beberapa aktivitas terlebih dahulu, atau jalankan skrip seed:

```bash
node seed-data.mjs
```

---

## Error "Transformers.js" / ONNX Model

### Gejala
Error yang menyebutkan `Transformers.js`, `ONNX`, atau `all-MiniLM-L6-v2` saat pencarian.

### Penyebab
Saat pertama kali Anda mencari, server mengunduh model embedding (~23MB) ke direktori cache Hugging Face (`~/.cache/huggingface/`). Ini memerlukan koneksi internet dan bisa memakan waktu 30-60 detik.

### Perbaikan
Pastikan akses internet pada saat pertama kali dijalankan. Model akan di-cache secara lokal setelahnya — pencarian berikutnya bersifat offline dan cepat.

Jika pengunduhan terus gagal, unduh secara manual:
```bash
# Model akan diunduh ke:
# ~/.cache/huggingface/hub/models--Xenova--all-MiniLM-L6-v2/
```
Kemudian mulai ulang server.

---

## Basis Data Terkunci / Error SQLite

### Gejala
```
SQLITE_BUSY: database is locked
```
atau
```
SQLITE_ERROR: no such table: memories
```

### Penyebab
- **Terkunci:** Dua proses mengakses berkas SQLite yang sama secara bersamaan (misalnya, server MCP + dasbor yang menunjuk ke DB yang sama).
- **Tabel hilang:** Basis data tidak dimigrasi (seharusnya tidak terjadi dalam alur normal, tetapi bisa terjadi jika berkas DB rusak secara manual atau terhapus di tengah operasi).

### Perbaikan
1. Matikan semua proses `local-memory-mcp` yang berjalan:
   ```bash
   pkill -f local-memory-mcp   # macOS/Linux
   ```
2. Hapus basis data untuk memulai dari awal (data Anda akan hilang):
   ```bash
   rm -f storage/memory.db
   ```
3. Mulai ulang server — tabel dibuat otomatis saat startup.

---

## "Memory not found" / Pencarian Tidak Menghasilkan Apa pun

### Pemeriksaan 1: Apakah Anda Menggunakan Repo yang Benar?
Memori dibatasi pada repositori. Jika proyek Anda saat ini adalah `my-app`, cari memori di `my-app`:
```json
{
  "repo": "my-app",
  "query": "pencarian Anda"
}
```

### Pemeriksaan 2: Ambang Batas Kemiripan Rendah
Sistem menyaring hasil di bawah kemiripan 0,50. Jika memori Anda sangat berbeda dari kueri Anda, coba ubah kata-katanya. Pencocokan kata kunci masih berfungsi untuk istilah yang tepat.

### Pemeriksaan 3: Agen Belum Menyimpan Apa pun
Tanyakan kepada agen Anda: *"Apa yang kamu ingat tentang proyek ini?"* Jika ia mengatakan "Tidak ada memori ditemukan," basis data kosong — ini normal untuk pengaturan baru.

---

## Error Izin npm/npx

### Gejala
```
Error: EACCES: permission denied
```

### Perbaikan (macOS/Linux)
Hindari `sudo`. Sebagai gantinya, perbaiki izin npm:
```bash
npm config set prefix ~/.npm-global
mkdir -p ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc
npm install -g @vheins/local-memory-mcp
```

Atau gunakan manajer versi Node seperti `nvm` atau `fnm` yang sepenuhnya menghindari masalah izin.

---

## Agen Mengatakan "Tool not found"

### Gejala
Agen AI merespons dengan *"Saya tidak memiliki alat yang disebut memory-store"* atau serupa.

### Penyebab
Server MCP tidak terdaftar di konfigurasi klien Anda, atau klien tidak dimulai ulang setelah konfigurasi ditambahkan.

### Perbaikan
1. Periksa kembali JSON `mcpServers` Anda cocok persis dengan contoh di README.
2. Mulai ulang klien AI Anda sepenuhnya (bukan hanya percakapan).
3. Verifikasi server muncul di daftar server MCP klien:
   - Claude Desktop: Klik ikon plug → seharusnya menampilkan "local-memory"
   - Cursor: Settings → MCP → seharusnya menampilkan "local-memory"
   - Windsurf: Panel konfigurasi MCP

---

## Error "EPIPE" atau Broken Pipe

### Gejala
Server mogok dengan `Error: write EPIPE` atau `stdout is not a TTY`.

### Penyebab
Proses induk (klien AI Anda) menutup koneksi stdio secara tidak terduga.

Ini biasanya tidak berbahaya — server mati ketika klien terputus. Jika terjadi berulang kali, klien mungkin memulai ulang server terlalu agresif. Periksa pengaturan keepalive server MCP klien Anda.

---

## Masih Macet?

- Buka [GitHub Issue](https://github.com/vheins/local-memory-mcp/issues) dengan:
  - OS dan versi Node.js Anda
  - Pesan error yang tepat
  - Klien MCP dan JSON konfigurasi Anda
- Sertakan log dari stderr (biasanya terlihat di panel output MCP klien).
