# Auto-Start Dashboard di IDE

Panduan mengkonfigurasi IDE favorit kamu untuk **menjalankan Memory Dashboard secara otomatis** setiap kali project dibuka.

Dashboard berjalan di `http://localhost:3456` dan bisa diakses langsung dari browser.

---

## VS Code

### Metode 1: tasks.json (folderOpen)

Buat file `.vscode/tasks.json` di root project:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Launch Memory Dashboard",
      "type": "shell",
      "command": "npx -y @vheins/local-memory-mcp@latest dashboard",
      "isBackground": true,
      "problemMatcher": [],
      "runOptions": {
        "runOn": "folderOpen"
      },
      "presentation": {
        "reveal": "always",
        "panel": "new",
        "group": "memory"
      }
    }
  ]
}
```

Task ini otomatis jalan setiap folder dibuka. Dashboard berjalan di background dan siap digunakan.

### Metode 2: Command Palette

Atau jalankan manual via `Ctrl+Shift+P` → **Tasks: Run Task** → **Launch Memory Dashboard**.

---

## Cursor

Cursor kompatibel dengan format tasks VS Code. Buat file `.vscode/tasks.json` atau `.cursor/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Launch Memory Dashboard",
      "type": "shell",
      "command": "npx -y @vheins/local-memory-mcp@latest dashboard",
      "isBackground": true,
      "problemMatcher": [],
      "runOptions": {
        "runOn": "folderOpen"
      }
    }
  ]
}
```

---

## Windsurf

Windsurf juga kompatibel dengan format tasks VS Code. Buat file `.vscode/tasks.json` atau `.windsurf/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Launch Memory Dashboard",
      "type": "shell",
      "command": "npx -y @vheins/local-memory-mcp@latest dashboard",
      "isBackground": true,
      "problemMatcher": [],
      "runOptions": {
        "runOn": "folderOpen"
      }
    }
  ]
}
```

---

## Kiro

Kiro belum mendukung tasks.json auto-start. Kamu bisa menjalankan dashboard secara manual:

```bash
npx @vheins/local-memory-mcp dashboard
```

Atau via Kiro Panel → terminal → jalankan perintah di atas.

---

## Zed

Zed menggunakan format `.zed/tasks.json` dengan struktur berbeda. Buat file `.zed/tasks.json`:

```json
[
  {
    "label": "Launch Memory Dashboard",
    "command": "npx",
    "args": ["-y", "@vheins/local-memory-mcp@latest", "dashboard"],
    "tags": ["dashboard", "memory"],
    "use_new_terminal": false,
    "allow_concurrent_runs": false,
    "reveal": "always"
  }
]
```

Zed tidak mendukung `runOn: "folderOpen"`. Kamu harus menjalankan task manual:

1. `Ctrl+Shift+P` → **Tasks: Run** → **Launch Memory Dashboard**
2. Atau buka command palette dan ketik "task"

---

## Codex (OpenAI)

Codex belum mendukung tasks.json. Jalankan dashboard di terminal terpisah:

```bash
npx @vheins/local-memory-mcp dashboard
```

Atau minta Codex menjalankannya (Codex akan spawn terminal terpisah).

---

## JetBrains IDEs (IntelliJ, WebStorm, GoLand, dll.)

### Metode 1: Run Configuration

1. **Run** → **Edit Configurations** → **+** → **Shell Script**
2. Isi:
   - **Name**: `Launch Memory Dashboard`
   - **Script text**: `npx -y @vheins/local-memory-mcp@latest dashboard`
   - **Working directory**: project root
3. Centang **"Run with startup"** atau **"Before Launch"** jika diperlukan

### Metode 2: Save as file

Simpan konfigurasi ke `.run/launch-memory-dashboard.run.xml`:

```xml
<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Launch Memory Dashboard" type="ShConfigurationType">
    <option name="SCRIPT_TEXT" value="npx -y @vheins/local-memory-mcp@latest dashboard" />
    <option name="WORKING_DIRECTORY" value="$PROJECT_DIR$" />
    <envs />
    <method v="2" />
  </configuration>
</component>
```

Konfigurasi ini bisa di-commit ke git dan dipakai semua anggota tim.

---

## Terminal Multiplexer (Screen / Tmux)

Untuk power user yang ingin dashboard selalu berjalan di background:

### Tmux
```bash
# Di dalam sesi tmux
tmux new-session -d -s memory-dashboard 'npx -y @vheins/local-memory-mcp@latest dashboard'
```

Tambahkan ke `~/.tmux.conf` agar otomatis jalan:
```
set -g @plugin 'tmux-plugins/tpm'
run '~/.tmux/plugins/tpm/tpm'
```

### VS Code + Tmux integration
Pasang ekstensi **Tmux** di VS Code, lalu task bisa spawn di tmux session:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Launch Memory Dashboard (Tmux)",
      "type": "shell",
      "command": "tmux new-session -d -s memory-dashboard 'npx -y @vheins/local-memory-mcp@latest dashboard'",
      "isBackground": true,
      "runOptions": { "runOn": "folderOpen" }
    }
  ]
}
```

---

## Ringkasan

| IDE / Tool | Auto-start | File Konfigurasi | Metode |
|------------|-----------|------------------|--------|
| VS Code | ✅ | `.vscode/tasks.json` | `runOn: folderOpen` |
| Cursor | ✅ | `.vscode/tasks.json` / `.cursor/tasks.json` | `runOn: folderOpen` |
| Windsurf | ✅ | `.vscode/tasks.json` / `.windsurf/tasks.json` | `runOn: folderOpen` |
| Zed | ⚠️ Manual | `.zed/tasks.json` | Task palette |
| JetBrains | ✅ | `.run/*.run.xml` | Run on startup |
| Kiro | ❌ | — | Terminal manual |
| Codex | ❌ | — | Terminal manual |
| Tmux | ✅ | `~/.tmux.conf` | Session hook |
