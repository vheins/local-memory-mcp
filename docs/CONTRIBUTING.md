# Contributing Guidelines

Terima kasih telah tertarik untuk berkontribusi pada MCP Local Memory Service! 

## Cara Melaporkan Isu
Jika Anda menemukan bug atau memiliki ide fitur:
1. Periksa apakah isu serupa sudah dilaporkan di [GitHub Issues](https://github.com/vheins/local-memory-mcp/issues).
2. Jika belum, buat issue baru dengan label `bug` atau `enhancement`.
3. Sertakan detail OS, versi Node.js, dan langkah-langkah untuk mereproduksi bug.

## Alur Kontribusi Kode
1. Fork repositori ini.
2. Buat branch baru (`feat/nama-fitur` atau `fix/deskripsi-bug`).
3. Pastikan kode Anda mengikuti standar TypeScript proyek ini.
4. **Wajib:** Tambahkan unit test di `src/` atau update `src/e2e.test.ts` jika menambahkan fitur baru.
5. Jalankan tes: `npm run test`.
6. Kirim Pull Request (PR) ke branch `main`.

## Standar Kualitas (Strict Rules)
- **Local-First:** Jangan tambahkan dependensi cloud atau API eksternal tanpa diskusi mendalam.
- **SQLite Only:** Seluruh persistensi data harus menggunakan SQLite.
- **Strict Anti-Hallucination:** Jangan menurunkan threshold pencarian semantik di bawah standar keamanan proyek.

## Lisensi
Dengan berkontribusi, Anda menyetujui bahwa kontribusi Anda akan dilisensikan di bawah Lisensi MIT proyek ini.
