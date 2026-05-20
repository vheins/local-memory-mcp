# Integrasi dengan Codex (OpenAI)

Panduan lengkap menghubungkan **MCP Local Memory Service** ke [Codex](https://developers.openai.com/codex) — AI coding agent dari OpenAI.

---

## Prasyarat

- **Node.js 18+** terinstal
- **Codex CLI** terinstal ([download](https://developers.openai.com/codex))
- Akses internet untuk instalasi pertama

---

## Instalasi

### Opsi 1: Quick Start (npx)

Cocok untuk percobaan pertama:

```bash
npm install -g @vheins/local-memory-mcp
```

Lalu konfigurasi MCP server di Codex (lihat bagian konfigurasi di bawah).

### Opsi 2: Global Install (direkomendasikan)

Startup lebih cepat, tanpa download ulang:

```bash
npm install -g @vheins/local-memory-mcp
```

---

## Konfigurasi MCP Server

Codex menyimpan konfigurasi MCP di **`config.toml`** (format TOML, bukan JSON). Ada dua level:

### User Level (semua project)

Buka `~/.codex/config.toml` dan tambahkan:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
```

Jika sudah global install:

```toml
[mcp_servers.local-memory]
command = "local-memory-mcp"
args = []
```

### Project Level (per project, trusted projects only)

Buat `.codex/config.toml` di root project:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
```

---

## Setup via CLI

Codex juga bisa dikonfigurasi langsung dari CLI:

```bash
# Tambah server MCP
codex mcp add local-memory -- npx -y @vheins/local-memory-mcp
```

```bash
# Lihat daftar server
codex mcp list
```

```bash
# Hapus server
codex mcp remove local-memory
```

---

## Setup via TUI (Terminal UI)

Di dalam sesi Codex, gunakan:

```
/mcp
```

Panel `/mcp` akan menampilkan semua server MCP yang aktif termasuk `local-memory`.

---

## Environment Variables

Codex menggunakan TOML untuk env vars:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]

[mcp_servers.local-memory.env]
PORT = "3456"
STORAGE_PATH = "/custom/path"
```

### Forwarding env vars dari system

Gunakan `env_vars` untuk mewarisi variable dari environment Codex:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
env_vars = ["HOME", "USER"]
```

Atau dengan source spesifik:

```toml
env_vars = [
  "LOCAL_TOKEN",
  { name = "REMOTE_TOKEN", source = "remote" }
]
```

---

## Tool Approval Mode

Kontrol apakah Codex perlu minta izin sebelum memanggil tool:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
default_tools_approval_mode = "prompt"
```

| Mode | Behavior |
|------|----------|
| `auto` | Auto-approve semua tool |
| `prompt` | Tanya user setiap kali (default) |
| `approve` | Selalu approve tanpa prompt |

### Per-tool approval

Atur approval mode untuk tool tertentu:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
default_tools_approval_mode = "prompt"

[mcp_servers.local-memory.tools.memory-search]
approval_mode = "auto"

[mcp_servers.local-memory.tools.memory-store]
approval_mode = "prompt"

[mcp_servers.local-memory.tools.task-delete]
approval_mode = "approve"
```

---

## Filter Tool (Allow/Deny List)

Batasi tool mana yang tersedia:

```toml
# Hanya tool ini yang boleh dipakai
enabled_tools = ["memory-search", "memory-detail", "memory-recap", "task-list", "task-detail"]

# Tool yang dilarang (diterapkan setelah enabled_tools)
disabled_tools = ["memory-delete", "task-delete"]
```

---

## Nonaktifkan Sementara

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
enabled = false
```

---

## Timeout Konfigurasi

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
startup_timeout_sec = 30
tool_timeout_sec = 60
```

---

## Verifikasi

```bash
# Cek daftar server
codex mcp list
```

Output:
```
local-memory — running
  Tools: memory-store, memory-search, memory-detail, ...
```

Di dalam TUI Codex, buka `/mcp` untuk melihat status server.

Test koneksi dengan bertanya ke Codex:

> *"Cek memori lokal untuk project ini"*

Jika Codex merespon dengan "Tidak ada memori" (bukan error), koneksi berhasil.

---

## Menjalankan Dashboard

```bash
npx @vheins/local-memory-mcp dashboard
# Buka http://localhost:3456
```

---

## Contoh Konfigurasi Lengkap

Berikut contoh konfigurasi lengkap untuk `~/.codex/config.toml` atau `.codex/config.toml`:

```toml
[mcp_servers.local-memory]
command = "npx"
args = ["-y", "@vheins/local-memory-mcp"]
enabled = true
startup_timeout_sec = 20
tool_timeout_sec = 45
default_tools_approval_mode = "prompt"
enabled_tools = [
  "memory-store", "memory-search", "memory-detail",
  "memory-update", "memory-acknowledge", "memory-recap",
  "task-list", "task-detail", "task-update",
  "standard-search", "standard-detail"
]
disabled_tools = ["memory-delete", "task-delete"]

# Tool-specific approval overrides
[mcp_servers.local-memory.tools.memory-search]
approval_mode = "auto"

[mcp_servers.local-memory.tools.memory-detail]
approval_mode = "auto"

[mcp_servers.local-memory.tools.task-list]
approval_mode = "auto"

[mcp_servers.local-memory.tools.task-detail]
approval_mode = "auto"

[mcp_servers.local-memory.tools.memory-store]
approval_mode = "prompt"

[mcp_servers.local-memory.tools.task-update]
approval_mode = "prompt"
```

---

## Troubleshooting untuk Codex

### Server not found

```bash
# Cek apakah server terdaftar
codex mcp list

# Cek PATH
which npx
which local-memory-mcp

# Tambah ulang
codex mcp add local-memory -- npx -y @vheins/local-memory-mcp
```

### Server error / disconnect

Jalankan langsung untuk lihat error:
```bash
npx -y @vheins/local-memory-mcp
```

### Konfigurasi tidak生效

Codex membaca `config.toml` — pastikan format TOML valid (bukan JSON).

### Slow startup

Global install lebih cepat daripada `npx`. Codex juga support `startup_timeout_sec` — naikkan jika server butuh waktu lebih lama.

---

## Referensi

- [Codex MCP Documentation](https://developers.openai.com/codex/mcp)
- [Codex Config Reference](https://developers.openai.com/codex/config-reference)
- [MCP Local Memory — Getting Started](getting-started.md)
- [Tool Reference & Usage Guide](tools-reference.md)
- [Troubleshooting Guide](troubleshooting.md)
