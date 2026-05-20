# Integrasi dengan Claude Code

Panduan lengkap menghubungkan **MCP Local Memory Service** ke [Claude Code](https://code.claude.com) — CLI AI agent dari Anthropic.

---

## Prasyarat

- **Node.js 18+** terinstal
- **Claude Code** terinstal (`npm install -g @anthropic-ai/claude-code`)
- Akses internet untuk instalasi pertama (model embedding di-download sekali)

---

## Instalasi

### Opsi 1: Quick Start (npx — tanpa instalasi permanen)

Cocok untuk percobaan pertama. Setiap kali Claude Code startup, `npx` akan menjalankan package dari npm:

```bash
claude mcp add --transport stdio --scope project local-memory -- npx -y @vheins/local-memory-mcp
```

### Opsi 2: Global Install (direkomendasikan)

Install package secara permanen — startup lebih cepat, tanpa download ulang:

```bash
npm install -g @vheins/local-memory-mcp
claude mcp add --transport stdio --scope project local-memory -- local-memory-mcp
```

### Opsi 3: Local Install (via package.json project)

Jika project kamu sudah punya `package.json`:

```bash
npm install --save-dev @vheins/local-memory-mcp
claude mcp add --transport stdio --scope project local-memory -- npx @vheins/local-memory-mcp
```

---

## Scope (Cakupan) Konfigurasi

Gunakan `--scope` sesuai kebutuhan:

| Scope | File | Dibagikan? | Cocok untuk |
|-------|------|------------|-------------|
| `project` | `.mcp.json` di root project | Ya (via git) | Semua anggota tim pakai memory yang sama |
| `local` | `~/.claude.json` | Tidak | Hanya untuk kamu |
| `user` | `~/.claude.json` (global) | Tidak | Kamu di semua project |

Contoh:
```bash
# Hanya untuk kamu, di project ini
claude mcp add --transport stdio --scope local local-memory -- npx -y @vheins/local-memory-mcp

# Semua anggota tim
claude mcp add --transport stdio --scope project local-memory -- npx -y @vheins/local-memory-mcp
```

---

## Verifikasi

### Cek daftar server MCP
```bash
claude mcp list
```
Output:
```
local-memory (project) — running
  Tools: memory-store, memory-search, memory-detail, memory-update, ...
```

### Cek status di dalam Claude Code
```
/mcp
```
Panel `/mcp` akan menunjukkan server `local-memory` dengan daftar tool yang tersedia.

### Test koneksi
Di dalam Claude Code, tanyakan:
> *"Cek memori lokal untuk project ini"*

Jika Claude merespon dengan "Tidak ada memori yang ditemukan" (bukan error), koneksi berhasil.

---

## Konfigurasi Manual (.mcp.json)

Jika kamu lebih suka mengedit file `.mcp.json` langsung (misalnya untuk version control), buat file di root project:

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"],
      "type": "stdio"
    }
  }
}
```

Atau untuk global install:
```json
{
  "mcpServers": {
    "local-memory": {
      "command": "local-memory-mcp",
      "type": "stdio"
    }
  }
}
```

---

## Environment Variables

Claude Code secara otomatis menetapkan `CLAUDE_PROJECT_DIR` ke root project. Server MCP Local Memory membaca environment ini untuk mendeteksi repository aktif.

Kamu bisa menambahkan env vars saat registrasi:
```bash
claude mcp add --transport stdio --scope project \
  --env STORAGE_PATH=/custom/path \
  local-memory -- npx -y @vheins/local-memory-mcp
```

Atau di `.mcp.json`:
```json
{
  "mcpServers": {
    "local-memory": {
      "command": "local-memory-mcp",
      "args": [],
      "env": {
        "PORT": "3456"
      }
    }
  }
}
```

---

## Workflow Harian dengan Claude Code

### Saat memulai sesi baru
```
Claude, cek task yang pending untuk project ini.
```
Claude akan memanggil `task-list` dan menampilkan task yang harus dikerjakan.

### Menyimpan knowledge
```
Catat bahwa kita memutuskan pakai Prisma ORM karena lebih mature.
```
Claude akan memanggil `memory-store` dengan type `decision`.

### Search memori lama
```
Apa yang kita tahu tentang autentikasi di project ini?
```
Claude akan memanggil `memory-search` dan `memory-synthesize` untuk memberikan jawaban.

### Menyelesaikan task
```
Task LOGIN-001 sudah selesai, commit ada di abc123.
```
Claude akan memanggil `task-update` dengan status `completed`.

---

## Menjalankan Dashboard

Claude Code juga bisa menjalankan dashboard web:

```bash
# Dari CLI (terpisah dari Claude Code)
npx @vheins/local-memory-mcp dashboard
# Buka http://localhost:3456
```

Atau minta Claude untuk menjalankannya:
> *"Jalankan dashboard memory"* — tapi perlu diingat, Claude Code harus tetap berjalan di terminal terpisah.

---

## Troubleshooting untuk Claude Code

### "local-memory" not found di `/mcp`
```bash
claude mcp list   # cek apakah terdaftar
claude mcp remove local-memory
# daftar ulang
claude mcp add --transport stdio --scope project local-memory -- npx -y @vheins/local-memory-mcp
```

### Server crashes / disconnected
```bash
# Cek log error
claude mcp get local-memory

# Coba jalankan langsung untuk lihat error
npx -y @vheins/local-memory-mcp
```

### Tool tidak muncul walau server running
Claude Code mendukung notifikasi `list_changed`, jadi tool baru seharusnya muncul otomatis. Kalau tidak:
```
/mcp   # refresh panel
```
Atau restart Claude Code.

### Slow startup
Jika pakai `npx`, setiap startup bisa lambat karena download/check cache. Solusi: **global install** (Opsi 2).

---

## Menonaktifkan / Menghapus

```bash
claude mcp remove local-memory
```

Untuk sementara, nonaktifkan dari dalam Claude Code via panel `/mcp`.

---

## Referensi

- [Claude Code MCP Documentation](https://code.claude.com/docs/id/mcp)
- [MCP Local Memory — Getting Started](getting-started.md)
- [Tool Reference & Usage Guide](tools-reference.md)
- [Troubleshooting Guide](troubleshooting.md)
