# Dashboard & Debugging

MCP Local Memory Service menyediakan alat visual untuk memastikan Anda memiliki kontrol penuh atas apa yang diingat oleh Agen AI Anda.

## Web Dashboard
Dashboard dapat diakses untuk melakukan inspeksi manual:
- **Visualisasi Memori:** Melihat, mengedit, dan menghapus memori per repository.
- **Audit Log:** Melihat histori pencarian Agen (apa yang dicari, hasil apa yang ditemukan, dan skor kemiripannya).
- **Statistik:** Melihat memori mana yang paling sering membantu Agen (Recall Rate).

### Cara Menjalankan
```bash
npx @vheins/local-memory-mcp-dashboard
```

## Debugging MCP Server
Jika Agen Anda tidak menemukan memori yang diharapkan:

1.  **Cek Log:** Server mencatat setiap aksi ke `stdout` (JSON-RPC) dan log internal. Gunakan [MCP Inspector](https://github.com/modelcontextprotocol/inspector) untuk melihat interaksi secara real-time.
2.  **Verifikasi Threshold:** Jika skor kemiripan semantik memori di bawah `0.50`, server akan mengembalikan hasil kosong. Anda bisa menurunkan threshold ini di konfigurasi jika dirasa terlalu ketat (namun risiko halusinasi meningkat).
3.  **Tags & Repo:** Pastikan Agen mengirimkan `repo` yang benar dan `current_tags` jika ingin menarik memori dari stack teknologi lain.

## Troubleshooting Database
Jika database `memory.db` korup atau ingin direset:
1. Lokasi file default: `~/.config/local-memory-mcp/memory.db`.
2. Anda bisa membuka file ini dengan alat SQLite manapun (misal: DB Browser for SQLite) untuk melakukan perbaikan manual.
