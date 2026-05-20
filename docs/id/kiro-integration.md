# Integrasi dengan Kiro

Panduan lengkap menghubungkan **MCP Local Memory Service** ke [Kiro](https://kiro.dev) — AI-powered IDE.

---

## Prasyarat

- **Node.js 18+** terinstal
- **Kiro** terinstal ([download](https://kiro.dev/downloads))
- Akses internet untuk instalasi pertama

---

## Instalasi

### Opsi 1: Quick Start (npx)

Cocok untuk percobaan pertama. `npx` otomatis mendownload dan menjalankan package:

```bash
npm install -g @vheins/local-memory-mcp
```

Lalu konfigurasi MCP server di Kiro (lihat bagian konfigurasi di bawah).

### Opsi 2: Global Install (direkomendasikan)

Startup lebih cepat, tanpa download ulang setiap kali Kiro restart:

```bash
npm install -g @vheins/local-memory-mcp
```

---

## Konfigurasi MCP Server

Kiro membaca konfigurasi MCP dari file JSON. Ada dua level:

### Workspace Level (per project)

Buat file `.kiro/settings/mcp.json` di root project kamu:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "disabled": false
    }
  }
}
```

Atau jika sudah global install:
```json
{
  "mcpServers": {
    "local-memory": {
      "command": "local-memory-mcp",
      "args": [],
      "disabled": false
    }
  }
}
```

### User Level (semua project)

Buat file `~/.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "disabled": false
    }
  }
}
```

> **Prioritas**: Workspace level menimpa user level. Jika kedua file ada, konfigurasi workspace diutamakan.

---

## Setup via Command Palette

1. Buka Kiro
2. Buka command palette:
   - Mac: `Cmd + Shift + P`
   - Windows/Linux: `Ctrl + Shift + P`
3. Cari **"MCP"**
4. Pilih salah satu:
   - **Kiro: Open workspace MCP config (JSON)** — untuk project ini saja
   - **Kiro: Open user MCP config (JSON)** — untuk semua project
5. Tambahkan konfigurasi `local-memory` seperti di atas
6. **Simpan file** — Kiro otomatis reconnect ke server

---

## Setup via Kiro Panel

1. Buka **Kiro Panel** (sidebar)
2. Klik ikon **Open MCP Config**
3. Tambahkan konfigurasi `local-memory`
4. Simpan file

---

## Auto-Approve Tools (Opsional)

Agar Kiro tidak meminta konfirmasi setiap kali agent memanggil tool memory, kamu bisa auto-approve:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "autoApprove": [
        "memory-search",
        "memory-detail",
        "memory-recap",
        "task-list",
        "task-detail",
        "standard-search",
        "standard-detail"
      ]
    }
  }
}
```

Tool read-only aman untuk auto-approve. Tool write (`memory-store`, `task-update`, dll.) sebaiknya tetap minta konfirmasi.

Untuk auto-approve semua tool (tidak direkomendasikan):
```json
"autoApprove": ["*"]
```

---

## Nonaktifkan Tool Tertentu

Jika ada tool yang tidak ingin digunakan:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "disabledTools": ["memory-delete", "task-delete"]
    }
  }
}
```

---

## Environment Variables

Kamu bisa menambahkan environment variable untuk server:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "env": {
        "PORT": "3456"
      }
    }
  }
}
```

Atau pakai variable expansion dari system:
```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "env": {
        "STORAGE_PATH": "${HOME}/my-custom-path/memory"
      }
    }
  }
}
```

---

## Nonaktifkan Sementara

Untuk mematikan server tanpa menghapus konfigurasi:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "disabled": true
    }
  }
}
```

---

## Verifikasi

1. Simpan file konfigurasi MCP
2. Buka **Kiro Panel**
3. Cek apakah server `local-memory` muncul dengan status **running**
4. Coba tanyakan ke agent Kiro:
   > *"Apa yang kamu tahu tentang project ini?"*

Jika agent merespon dengan daftar memori atau "Belum ada memori" (bukan error), koneksi berhasil.

---

## Menjalankan Dashboard

Kiro bisa menjalankan dashboard web memory:

```bash
npx @vheins/local-memory-mcp dashboard
# Buka http://localhost:3456
```

Atau minta agent Kiro untuk menjalankannya — tapi dashboard akan berjalan di terminal terpisah.

---

## Troubleshooting untuk Kiro

### Server tidak muncul di panel

**Cek JSON syntax:**
```bash
# Validasi JSON file
cat .kiro/settings/mcp.json | python3 -m json.tool
```

**Cek PATH:**
```bash
which npx
which local-memory-mcp   # jika global install
```

Pastikan command bisa dijalankan dari terminal.

### Server error / disconnect

Coba jalankan langsung untuk lihat error:
```bash
npx -y @vheins/local-memory-mcp
```

### Perubahan konfigurasi tidak生效

Kiro auto-reconnect saat file disimpan. Jika tidak:
1. Buka command palette
2. Cari **"Kiro: Reload Window"**
3. Atau restart Kiro

### Slow startup

Jika pakai `npx`, setiap restart Kiro bisa download ulang package. Solusi: **global install**.

---

## Referensi

- [Kiro MCP Configuration Docs](https://kiro.dev/docs/mcp/configuration)
- [Kiro MCP Security](https://kiro.dev/docs/mcp/security)
- [MCP Local Memory — Getting Started](getting-started.md)
- [Tool Reference & Usage Guide](tools-reference.md)
- [Troubleshooting Guide](troubleshooting.md)
