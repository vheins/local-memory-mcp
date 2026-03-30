# System Architecture: Built for Reliability

The **MCP Local Memory Service** is engineered to be a lightweight yet powerful foundation for AI-assisted development. It prioritizes data integrity, privacy, and speed.

## 🧱 Core Pillars

### 1. Local-First Persistence (SQLite)
Your data never leaves your machine. We use **SQLite** as the source of truth because it is:
- **Zero-Config:** Works out of the box without complex database servers.
- **Robust:** Atomic transactions ensure your memories are never corrupted.
- **Portable:** Your knowledge base is a single `.db` file that you can back up or move easily.

### 2. Semantic Intelligence (Transformers.js)
We use **ONNX Runtime** locally to generate vector embeddings.
- **Privacy:** Semantic understanding happens on your CPU, not in the cloud.
- **Offline Ready:** Once initialized, the system requires no internet connection.
- **Efficiency:** The `all-MiniLM-L6-v2` model is optimized for high-speed search on consumer hardware.

### 3. Smart Knowledge Lifecycle
Memories aren't just stored; they are managed:
- **Supersedes:** A built-in versioning system that archives old decisions when new ones are made.
- **Decay & Archive:** Automatically hides low-signal information after 90 days of inactivity.
- **Conflict Detection:** Acts as a gatekeeper to prevent the Agent from storing contradicting rules.

## 🛠️ Security & Isolation
- **Git Scoping:** Memories are automatically isolated by repository using local `.git` metadata.
- **Encryption Ready:** Since it uses SQLite, you can encrypt your entire database file at rest if needed.
- **Audit Trails:** Every internal interaction is logged, allowing you to trace why an Agent made a specific decision.

## 🚀 Performance
- **Query Latency:** Typically < 50ms for databases with thousands of entries.
- **Minimal Footprint:** Uses less than 100MB of RAM during typical usage.

## ⚠️ Disclaimer
**THE ARCHITECTURE IS PROVIDED "AS IS"**, without warranty of any kind. Reliability depends on the local environment and hardware performance.
