# Getting Started

Panduan ini membantu Anda menginstal dan mengkonfigurasi MCP Local Memory Service di mesin lokal Anda.

## Prasyarat
- **Node.js:** Versi 18 atau lebih tinggi.
- **MCP Client:** Satu atau lebih klien MCP terpasang (misal: Claude Desktop, Cursor, Windsurf).

## Instalasi

### Menggunakan NPM (Rekomendasi)
Anda dapat menginstal secara global untuk penggunaan yang lebih mudah:
```bash
npm install -g @vheins/local-memory-mcp
```

Atau gunakan langsung via `npx` tanpa instalasi permanen:
```bash
npx @vheins/local-memory-mcp
```

## Konfigurasi Klien

### Claude Desktop
Tambahkan entri berikut ke file konfigurasi Anda (biasanya di `~/Library/Application Support/Claude/claude_desktop_config.json` atau `%APPDATA%\Claude\claude_desktop_config.json`):

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

### Cursor / VS Code Extensions
Jika menggunakan ekstensi MCP di Cursor, tambahkan server dengan perintah:
- **Command:** `npx`
- **Arguments:** `-y @vheins/local-memory-mcp`

## Lokasi Data
Secara default, database memori Anda disimpan di:
- **Linux/macOS:** `~/.config/local-memory-mcp/memory.db`
- **Windows:** `%USERPROFILE%\.config\local-memory-mcp\memory.db`

Anda dapat mengubah lokasi ini dengan menyetel variabel lingkungan `MEMORY_DB_PATH`.

## Menjalankan Web Dashboard
Server memori dilengkapi dengan dashboard visual untuk mengelola ingatan agen Anda.
```bash
# Menjalankan dashboard (default port 3456)
npx @vheins/local-memory-mcp-dashboard
```
Buka browser Anda di `http://localhost:3456`.
