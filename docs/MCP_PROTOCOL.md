# MCP Protocol Reference

Dokumen ini merinci interface teknis yang diekspos oleh server ini untuk Agen AI.

## Tools (Fungsi Agen)

### `memory-store`
Menyimpan memori baru.
- **Input:** `type`, `title`, `content`, `importance` (1-5), `scope`, `tags`, `is_global`, `supersedes` (optional).
- **Behavior:** Melakukan deteksi konflik otomatis sebelum menyimpan.

### `memory-search`
Mencari memori yang relevan.
- **Input:** `query`, `repo`, `current_file_path`, `current_tags`, `include_archived`.
- **Output:** Hasil yang diurutkan berdasarkan relevansi semantik dan kedekatan workspace.

### `memory-acknowledge`
Mencatat penggunaan memori. **WAJIB** dipanggil oleh agen setelah menggunakan memori untuk menulis kode.
- **Input:** `memory_id`, `status` (`used` | `irrelevant` | `contradictory`).

### `memory-update` / `memory-delete`
Manajemen siklus hidup memori.

---

## Resources (Data Introspeksi)

### `memory://index?repo={repo}`
Melihat daftar memori aktif dalam format JSON untuk repositori tertentu.

### `memory://tags/{tag}`
Melihat memori berdasarkan teknologi tertentu lintas proyek.

### `memory://summary/{repo}`
Snapshot ringkas (high-level) dari seluruh keputusan arsitektur proyek.

### `memory://{id}`
Detail lengkap satu entri memori beserta statistik penggunaannya.

---

## Prompts (Instruksi Agen)

Server ini menyediakan template instruksi untuk memastikan Agen berperilaku disiplin:
- **`memory-agent-core`:** Aturan perilaku dasar Agen yang sadar memori.
- **`memory-index-policy`:** Kebijakan tentang apa yang boleh dan tidak boleh disimpan.
- **`tool-usage-guidelines`:** Panduan teknis penggunaan tool MCP.
