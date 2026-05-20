# Hybrid Search: How the System "Thinks"

The MCP Local Memory Service uses a sophisticated **Hybrid Search Engine** to ensure your AI Agent always finds the right information, even if you use different words or make typos.

## 🔍 How it Works

Search is performed in three distinct layers to balance speed and accuracy:

1.  **Textual Matching (Precision):** Finds exact keywords and phrases in SQLite. This ensures that a query for "auth" immediately finds memories containing that exact term.
2.  **Semantic Vector Search (Context):** Uses the `all-MiniLM-L6-v2` model locally via `Transformers.js`. This allows the Agent to understand that "database schema" is related to "migrations," even if the words don't match.
3.  **Workspace Affinity (Relevance):** Results are boosted based on your current project location. If you are working in `src/auth/login.ts`, memories tagged with `auth` or located in the `auth` folder get a ranking priority.

## 🧠 Smart Features

- **Dynamic Thresholding:** The system automatically adjusts its "strictness" based on your database size. It's more lenient when you're starting a new project to help the Agent learn, and more strict as your project grows to prevent noise.
- **Tech-Stack Affinity:** Memories tagged with technology names (e.g., `react`, `laravel`) are shared across projects. Your Agent's experience with a library in Project A will follow you to Project B.
- **Conflict Prevention:** The system semantically detects if a new memory contradicts an old one and warns the Agent, ensuring your knowledge base remains a single source of truth.

## 📊 Scoring Formula
Every search result is scored from **0.0 to 1.0**:
- **50% Semantic Score:** Meaning-based relevance.
- **50% Textual Score:** Keyword match and importance boost.

*Note: Results below 0.50 are typically filtered out to prevent hallucinations.*

## ⚠️ Disclaimer
Semantic search performance depends on local CPU capabilities and the quality of the stored text. **THE SOFTWARE IS PROVIDED "AS IS"**, without warranty of accuracy.
