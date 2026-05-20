# Auto-Start Dashboard in IDE

Guide for configuring your favorite IDE to **automatically run the Memory Dashboard** every time a project is opened.

The dashboard runs at `http://localhost:3456` and can be accessed directly from the browser.

---

## VS Code

### Method 1: tasks.json (folderOpen)

Create a `.vscode/tasks.json` file in the project root:

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

This task automatically runs every time the folder is opened. The dashboard runs in the background and is ready to use.

### Method 2: Command Palette

Alternatively, run manually via `Ctrl+Shift+P` → **Tasks: Run Task** → **Launch Memory Dashboard**.

---

## Cursor

Cursor is compatible with the VS Code tasks format. Create a `.vscode/tasks.json` or `.cursor/tasks.json` file:

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

Windsurf is also compatible with the VS Code tasks format. Create a `.vscode/tasks.json` or `.windsurf/tasks.json` file:

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

Kiro does not yet support tasks.json auto-start. You can run the dashboard manually:

```bash
npx @vheins/local-memory-mcp dashboard
```

Or via Kiro Panel → terminal → run the command above.

---

## Zed

Zed uses the `.zed/tasks.json` format with a different structure. Create a `.zed/tasks.json` file:

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

Zed does not support `runOn: "folderOpen"`. You must run the task manually:

1. `Ctrl+Shift+P` → **Tasks: Run** → **Launch Memory Dashboard**
2. Or open the command palette and type "task"

---

## Codex (OpenAI)

Codex does not yet support tasks.json. Run the dashboard in a separate terminal:

```bash
npx @vheins/local-memory-mcp dashboard
```

Or ask Codex to run it (Codex will spawn a separate terminal).

---

## JetBrains IDEs (IntelliJ, WebStorm, GoLand, etc.)

### Method 1: Run Configuration

1. **Run** → **Edit Configurations** → **+** → **Shell Script**
2. Fill in:
   - **Name**: `Launch Memory Dashboard`
   - **Script text**: `npx -y @vheins/local-memory-mcp@latest dashboard`
   - **Working directory**: project root
3. Check **"Run with startup"** or **"Before Launch"** if needed

### Method 2: Save as file

Save the configuration to `.run/launch-memory-dashboard.run.xml`:

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

This configuration can be committed to git and used by all team members.

---

## Terminal Multiplexer (Screen / Tmux)

For power users who want the dashboard to always run in the background:

### Tmux
```bash
# Inside a tmux session
tmux new-session -d -s memory-dashboard 'npx -y @vheins/local-memory-mcp@latest dashboard'
```

Add to `~/.tmux.conf` to auto-start:
```
set -g @plugin 'tmux-plugins/tpm'
run '~/.tmux/plugins/tpm/tpm'
```

### VS Code + Tmux integration
Install the **Tmux** extension in VS Code, then tasks can spawn in a tmux session:

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

## Summary

| IDE / Tool | Auto-start | Configuration File | Method |
|------------|-----------|-------------------|--------|
| VS Code | ✅ | `.vscode/tasks.json` | `runOn: folderOpen` |
| Cursor | ✅ | `.vscode/tasks.json` / `.cursor/tasks.json` | `runOn: folderOpen` |
| Windsurf | ✅ | `.vscode/tasks.json` / `.windsurf/tasks.json` | `runOn: folderOpen` |
| Zed | ⚠️ Manual | `.zed/tasks.json` | Task palette |
| JetBrains | ✅ | `.run/*.run.xml` | Run on startup |
| Kiro | ❌ | — | Manual terminal |
| Codex | ❌ | — | Manual terminal |
| Tmux | ✅ | `~/.tmux.conf` | Session hook |
