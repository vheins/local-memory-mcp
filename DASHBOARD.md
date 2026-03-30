# Web Dashboard: Visual Memory Management

The **MCP Local Memory Dashboard** provides a modern, visual interface to inspect, audit, and manage what your AI Agent learns. It transforms raw database entries into actionable insights.

## ✨ Key Features

- **Project Timeline:** View a chronological log of every search, storage, and update action performed by your Agent.
- **Repository Exploration:** Browse memories filtered by project, technology tags, or importance levels.
- **Memory Auditing:** Inspect usage statistics like `hit_count` and `recall_rate` to see which memories are actually helping your Agent.
- **Version Control:** Visually track memory evolution via the `supersedes` links (seeing how one decision replaced another).
- **Interactive Editing:** Quickly correct, archive, or delete memories through a data-dense, "Glassy Futuristic" interface.

## 🚀 How to Use

### Starting the Dashboard
Run the following command from your terminal:
```bash
npx @vheins/local-memory-mcp dashboard
```
Then open **http://localhost:3456** in your browser.

### Auto-launch in VS Code
You can configure VS Code to automatically launch the dashboard when you open your project folder. Create or update `.vscode/tasks.json` with:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Launch Memory Dashboard",
      "type": "shell",
      "command": "npx -y @vheins/local-memory-mcp dashboard",
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

### Managing Memories
1. **Browse:** Use the search bar to find specific decisions or patterns.
2. **Audit:** Click on a memory to see its full content, scope, and utility stats.
3. **Archive:** Use the "Archive" action for old memories you want to keep for history but hide from the Agent's active context.
4. **Delete:** Permanently remove entries that are no longer accurate or relevant.

## 📊 Visual Insights
The dashboard provides real-time charts showing:
- **Knowledge Distribution:** A breakdown of memories by type (`decision`, `code_fact`, `mistake`, `pattern`).
- **Memory Density:** Identifying which projects or tech stacks have the most documented knowledge.

## ⚠️ Disclaimer
**THE DASHBOARD IS PROVIDED "AS IS"**, without warranty of any kind. It is intended for manual inspection and management of local data.
