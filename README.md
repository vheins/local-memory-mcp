# @vheins/local-memory-mcp

[![npm version](https://img.shields.io/npm/v/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**MCP Local Memory Service** adalah server [Model Context Protocol (MCP)](https://modelcontextprotocol.io) yang menyediakan memori jangka panjang (*long-term memory*) berperforma tinggi untuk AI Agents (seperti Claude Desktop, Cursor, atau Windsurf). 

Dibangun dengan filosofi **Local-First**, layanan ini menyimpan keputusan arsitektur, pola kode, dan fakta penting secara lokal di mesin Anda menggunakan SQLite dan Pencarian Semantik berbasis AI.

## 🚀 Fitur Utama

- 🧠 **Semantic Search (V2):** Pencarian memori berdasarkan makna, bukan sekadar kata kunci, menggunakan model `all-MiniLM-L6-v2` secara lokal.
- 🔄 **Tech-Stack Affinity:** Berbagi pengetahuan antar repositori secara cerdas berdasarkan tag teknologi (misal: memori Filament di Repo A bisa diakses di Repo B).
- 🛡️ **Anti-Hallucination Guard:** Mencegah Agen berhalusinasi dengan ambang batas kemiripan ketat dan deteksi konflik keputusan.
- 📉 **Automatic Memory Decay:** Pengarsipan otomatis memori usang agar konteks tetap bersih dan relevan.
- 📊 **Glassy Dashboard:** Visualisasi memori, statistik penggunaan, dan audit log interaksi Agen melalui antarmuka web modern.

## 🛠️ Persiapan Cepat

### Instalasi
```bash
npm install -g @vheins/local-memory-mcp
```

### Konfigurasi MCP Client (misal: Claude Desktop)
Tambahkan konfigurasi berikut ke file pengaturan MCP Anda:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"]
    }
  }
}
```

## 📖 Dokumentasi Selengkapnya

- [Panduan Instalasi & Setup](docs/GETTING_STARTED.md)
- [Detail Fitur & Cara Kerja](docs/FEATURES.md)
- [Referensi MCP (Tools & Resources)](docs/MCP_PROTOCOL.md)
- [Dashboard & Debugging](docs/DASHBOARD_DEBUGGING.md)
- [Panduan Kontribusi](docs/CONTRIBUTING.md)

## ⚖️ Lisensi

MIT © Muhammad Rheza Alfin
