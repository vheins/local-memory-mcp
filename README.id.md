# @vheins/local-memory-mcp

[![npm version](https://img.shields.io/npm/v/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![npm total downloads](https://img.shields.io/npm/dt/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**MCP Local Memory Service** adalah server [Model Context Protocol (MCP)](https://modelcontextprotocol.io) berkinerja tinggi yang menyediakan memori jangka panjang untuk AI Agent (seperti Claude Desktop, Cursor, atau Windsurf).

Dibangun dengan filosofi **Local-First**, layanan ini menyimpan keputusan arsitektur, pola kode, dan fakta kritis secara lokal di mesin Anda menggunakan SQLite dan Pencarian Semantik berbasis AI.

## Fitur Utama

- **Pencarian Semantik (V2):** Temukan memori berdasarkan makna, bukan hanya kata kunci, menggunakan model `all-MiniLM-L6-v2` secara lokal.
- **Tech-Stack Affinity:** Bagikan pengetahuan antar repositori secara cerdas berdasarkan tag teknologi (misalnya memori Filament di Repo A dapat diakses di Repo B).
- **Anti-Hallusinasi:** Mencegah Agent berhalusinasi dengan batas kemiripan yang ketat dan deteksi konflik keputusan.
- **Decay Memori Otomatis:** Mengarsipkan memori usang secara otomatis untuk menjaga konteks tetap bersih dan relevan.
- **Dashboard Modern:** Visualisasikan memori, statistik penggunaan, dan log audit melalui antarmuka web.

## Penggunaan & Konfigurasi MCP

Tambahkan layanan ini ke AI Agent Anda menggunakan salah satu metode di bawah.

> **Rekomendasi:** Jika MCP Anda sering berjalan, hindari `npx` dan gunakan instalasi global. Ini mengurangi unduhan NPM dan mempercepat startup Agent.

### Quick Start (Zero Setup)

Cocok untuk **pengguna pertama** atau **pengujian cepat**.

```json
"local-memory": {
  "command": "npx",
  "args": ["-y", "@vheins/local-memory-mcp"],
  "type": "stdio"
}
```

### Direkomendasikan untuk Produksi

1. **Install secara global:**
   ```bash
   npm install -g @vheins/local-memory-mcp
   ```

2. **Tambahkan ke konfigurasi:**
   ```json
   "local-memory": {
     "command": "local-memory-mcp",
     "type": "stdio"
   }
   ```

## Dashboard

Jalankan dashboard web untuk visualisasi memori dan task:

```bash
local-memory-mcp dashboard
```
*Jika belum install global:* `npx @vheins/local-memory-mcp dashboard`

Buka `http://localhost:3456` di browser.

### Auto-Start Dashboard di IDE

Dashboard bisa otomatis menyala saat project dibuka di VS Code, Cursor, Windsurf, Zed, atau JetBrains.

📖 **[Panduan auto-start dashboard →](docs/id/auto-start-dashboard.md)**

## Dokumentasi

- [Memulai & Instalasi](docs/id/getting-started.md) — Instalasi dan konfigurasi klien
- [Panduan Penggunaan Tools](docs/id/tools-reference.md) — Dokumentasi tools lengkap dengan contoh dan alur kerja
- [Panduan Pemecahan Masalah](docs/id/troubleshooting.md) — Mengatasi masalah umum
- [Fitur & Cara Kerja](docs/id/features.md) — Semantic search, anti-hallusinasi, decay memori
- [Logika Hybrid Search](docs/id/hybrid-search.md) — Cara kerja skoring pencarian
- [Panduan Dashboard](docs/id/dashboard-guide.md) — UI web untuk manajemen memori & task
- [Referensi Protokol MCP](docs/id/mcp-concepts.md) — Detail teknis protokol
- [Integrasi dengan Claude Code](docs/id/claude-code-integration.md) — Panduan setup untuk Claude Code CLI
- [Integrasi dengan Codex (OpenAI)](docs/id/codex-integration.md) — Panduan setup untuk Codex CLI
- [Integrasi dengan Kiro](docs/id/kiro-integration.md) — Panduan setup untuk Kiro IDE
- [Auto-Start Dashboard di IDE](docs/id/auto-start-dashboard.md) — tasks.json untuk VS Code, Cursor, Windsurf, Zed, JetBrains

> 🇬🇧 **English version available:** [`README.md`](README.md) & docs in [`docs/en/`](docs/en/)

- [Panduan Kontribusi](CONTRIBUTING.md)

## Penyangkalan

**PERANGKAT LUNAK INI DISEDIAKAN "SEBAGAIMANA ADANYA", TANPA JAMINAN DALAM BENTUK APAPUN**, baik tersurat maupun tersirat, termasuk namun tidak terbatas pada jaminan kepatutan, kesesuaian untuk tujuan tertentu, dan tidak melanggar hak pihak ketiga. Dalam hal apa pun penulis atau pemegang hak cipta tidak bertanggung jawab atas klaim, kerusakan, atau kewajiban lainnya, baik dalam tindakan kontrak, gugatan, atau lainnya, yang timbul dari, di luar, atau sehubungan dengan perangkat lunak ini.

## Lisensi

MIT © Muhammad Rheza Alfin
