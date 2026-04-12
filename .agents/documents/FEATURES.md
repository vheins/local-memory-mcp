# Core Features & V2 Enhancements

This project is more than just text storage; it is a "brain" system for AI agents designed for long-term stability and project consistency.

## 🧠 Hybrid Semantic Search
The system uses a hybrid approach to find the most relevant memories:
1.  **Keyword Matching (TF-IDF):** Finds exact keyword matches in SQLite.
2.  **Semantic Vector Search:** Uses the `Transformers.js` AI model locally to understand the meaning behind the query.
3.  **Workspace Boost:** Provides additional ranking scores to memories located in the same folder as the file you are currently working on.

## 🔄 Tech-Stack Affinity
**Case:** You have knowledge about **Filament** in Project A. When you start Project B (also using Filament), your Agent can automatically pull those best practices if you tag that memory with `filament`.
- Memories can be **Local** (per repo), **Affinity-based** (per technology), or **Global** (universal rules).

## 🛡️ Anti-Hallucination Guard
One of the main issues with AI Agents is "matching" irrelevant information.
- **Strict Threshold (0.50):** If semantic similarity is below the threshold, the system strictly returns empty results, preventing the Agent from hallucinating based on wrong data.
- **Conflict Rejection:** If an Agent tries to store a decision that contradicts an existing one, the system rejects it and forces the Agent to use `update` or `supersede`.

## 📈 Memory Recall Tracking
Every time an Agent uses a memory, it is required to provide feedback via the `acknowledge` tool.
- We track the **Utility Rate** (how often a memory was actually helpful).
- Memories with low utility will gradually be "forgotten" through the decay system.

## 📉 Automatic Archiving (Natural Forgetting)
Just like humans, not everything needs to be remembered forever.
- **Expired Memories:** Memories with a TTL (Time-To-Live) are automatically archived.
- **Decay System:** Memories unused for 90 days with low importance are moved to the archive to keep the Agent's context clean.

## ⚠️ Disclaimer
All features are provided **"AS IS"** without any warranty of performance or accuracy.
