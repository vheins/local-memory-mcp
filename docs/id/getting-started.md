# Memulai & Pengaturan

Panduan ini memberikan petunjuk untuk menghidupkan MCP Local Memory Service dari dua sudut pandang penting.

---

## 🧑‍💻 Sebagai Pengembang: "Saya sedang menyiapkan infrastruktur."

Sebagai pengembang, tugas Anda adalah menginstal biner dan mendaftarkan server di lingkungan Anda.

### 1. Instalasi
Instal service secara global di mesin Anda:
```bash
npm install -g @vheins/local-memory-mcp
```

### 2. Konfigurasi (Level Pengguna)
Daftarkan server di alat AI pilihan Anda. Berikut adalah konfigurasi standar:

#### 🏠 Claude Desktop
- **Lokasi Berkas:** 
  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- **JSON:** Format standar `mcpServers`.

#### 🛸 Cursor & 🌊 Windsurf
- **Berkas Cursor:** `~/.cursor/mcp.json`
- **Berkas Windsurf:** `~/.codeium/windsurf/mcp_config.json`
- Keduanya menggunakan objek JSON standar `mcpServers`.

#### ♊ Gemini CLI & 🪐 Antigravity
- **Berkas:** `~/.gemini/settings.json` (atau `.gemini/settings.json` di root proyek)
- **Cuplikan JSON:**
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

#### ⚡ Trae & 👻 Kiro AI
- **Trae:** Buka **Settings > MCP > Add Manually**.
- **Kiro AI:** Klik ikon MCP di sidebar dan tambahkan ke `mcp-servers.json`.
- Keduanya mendukung definisi server JSON standar.

#### 📐 Zed Editor
- **Lokasi Berkas:** `~/.config/zed/settings.json`
- **Konfigurasi:**
```json
"context_servers": {
  "local-memory": {
    "command": {
      "path": "npx",
      "args": ["-y", "@vheins/local-memory-mcp"]
    }
  }
}
```

#### 🔓 OpenCode
- Tambahkan server melalui pengaturan ekstensi OpenCode menggunakan perintah dan argumen `npx` standar.

---

## 🤖 Sebagai Agen AI: "Saya sedang menemukan memori baru saya."

Setelah pengembang mendaftarkan server, saya (Agen) mengambil alih proses integrasi.

### 1. Handshake & Discovery
Saat Anda memulai sesi baru, saya secara otomatis melakukan "handshake" dengan server MCP. Saya menemukan kemampuan berikut:
*   **Tools:** Saya melihat `memory-store`, `memory-search`, dll.
*   **Resources:** Saya menemukan URI `memory://index` untuk menelusuri pengetahuan yang ada.
*   **Prompts:** Saya membaca prompt `memory-agent-core` untuk memahami kontrak perilaku baru saya.

### 2. Aktivasi Konteks
Saya tidak hanya "diam saja." Saya secara aktif mencari konteks proyek Anda:
*   Saya menyelesaikan nama **Git Repository** Anda saat ini untuk mengisolasi memori.
*   Saya mendeteksi **Tech Stack** Anda (misalnya, React, Python, Filament) untuk menarik memori yang relevan dari proyek lain melalui tag afinitas.

### 3. Ritual Validasi
Untuk memastikan saya terhubung dengan benar, Anda dapat bertanya kepada saya:
> *"Apa yang kamu ingat tentang proyek ini?"* atau *"Periksa memori lokalmu untuk standar koding apa pun yang terkait dengan tech stack ini."*

Jika saya merespons dengan daftar fakta atau pesan "Belum ada memori ditemukan" (bukan error), berarti saya berhasil terintegrasi dan siap bekerja.

---

## ⚠️ Penyangkalan
**PERANGKAT LUNAK INI DISEDIAKAN "SEBAGAIMANA ADANYA"**, tanpa jaminan apa pun. Baik pengembang maupun agen harus bekerja sama untuk memastikan kualitas dan keakuratan data yang disimpan.
