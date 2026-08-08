# Fitur Inti

Proyek ini lebih dari sekadar penyimpanan teks; ini adalah sistem "otak" untuk agen AI yang dirancang untuk stabilitas jangka panjang dan konsistensi proyek.

## 🧠 Pencarian Semantik Hibrida

Sistem memadukan empat sinyal untuk menemukan memori yang paling relevan:

1. **Kesamaan semantik (40%)** — embedding `all-MiniLM-L6-v2` dihitung secara lokal via Transformers.js.
2. **Kecocokan kata kunci (30%)** — token tepat via FTS SQLite.
3. **Kebaruan / recency (15%)** — entri yang lebih baru berperingkat lebih tinggi (decay eksponensial, setengah-umur ±30 hari).
4. **Afinitas domain / workspace (15%)** — penguatan saat repo atau folder memori cocok dengan konteks kerja Anda saat ini.

Ambang batasnya **adaptif**: kumpulan hasil kecil menggunakan batas longgar (0,10 untuk memori) sehingga proyek baru tetap mendapat hasil; kumpulan lebih besar menggunakan batas lebih ketat (0,40). Jika semua kandidat di bawah ambang, hasil terbaik tunggal tetap dikembalikan (garansi-minimal-satu). Detail lengkap: [Logika Pencarian Hibrida](hybrid-search.md).

## 🔄 Afinitas Tech-Stack

**Kasus:** Anda memiliki pengetahuan tentang **Filament** di Proyek A. Saat Anda memulai Proyek B (juga menggunakan Filament), Agen Anda dapat secara otomatis menarik praktik terbaik tersebut dengan mengirim `current_tags: ["filament"]` saat mencari — atau karena memori itu ditandai `filament`.

- Memori dapat di-scope **per-repo**, dibagikan lintas **tag** (afinitas), atau **Global** (`is_global: true`).

## 🛡️ Pengaman Anti-Hallusinasi

Salah satu masalah utama dengan Agen AI adalah "mencocokkan" informasi yang tidak relevan.

- **Penolakan Konflik:** menyimpan memori yang secara semantik tumpang tindih dengan memori yang ada lebih dari **0,85** kesamaan kosinus ditolak dengan error `MEMORY_CONFLICT`. Respons menyuruh Agen mengirim `id`/`code` untuk update, `acknowledge`, atau `supersedes` jika entri baru menggantikan yang lama.
- **Ambang Relevansi Adaptif:** pencarian menyaring kecocokan lemah (ambang set kecil 0,10, set besar 0,40) alih-alih mengembalikan kebisingan.

## 📈 Pelacakan Penggunaan Memori

Setiap kali Agen menggunakan memori, ia melaporkan umpan balik melalui `memory-write` dengan `acknowledge` (mis. `"acknowledge": "used"`).

- Kami melacak **Tingkat Kegunaan** (seberapa sering sebuah memori benar-benar membantu).
- Memori tanpa recall meskipun banyak hit (`hit_count > 10` dan `recall_count = 0`) diarsipkan sebagai bernilai rendah.

## 📉 Pengarsipan Otomatis (Pelupaan Alami)

Seperti manusia, tidak semuanya perlu diingat selamanya.

- **Memori Kedaluwarsa:** Memori dengan TTL (`ttlDays`) otomatis diarsipkan begitu `expires_at` terlewat.
- **Memori Berskor Rendah:** Memori yang tidak digunakan selama **90 hari** dengan `importance < 3` dipindahkan ke arsip untuk menjaga konteks Agen tetap bersih.

## 🧩 Knowledge Graph (Graf Pengetahuan)

Penyimpanan relasi entitas terstruktur yang memetakan pengetahuan domain yang kompleks:

- **Entitas** dengan tipe (orang, tempat, organisasi, konsep) dan deskripsi
- **Relasi** dengan koneksi ber-tipe antar entitas
- **Observasi** yang menghubungkan konteks ke entitas
- **Ekstraksi otomatis**: NLP offline (compromise.js) mengekstrak entitas bernama saat memori dan tugas disimpan
- **Dashboard**: visualisasi graf gaya-tarik (force-directed) interaktif dengan tambah/edit/hapus (lihat [Panduan Dasbor](dashboard-guide.md))

> Alat MCP khusus untuk CRUD graf langsung adalah **roadmap — belum diimplementasikan**. Pengelolaan graf dilakukan di tab Knowledge Graph dasbor.

## 🕰️ Time Tunnel (Pencarian Temporal)

Filter pencarian memori dengan referensi waktu berbahasa alami — cukup tambahkan frasa ke kueri Anda:

- `today` (hari ini), `yesterday` (kemarin)
- `this week` (minggu ini), `last week` (minggu lalu)
- `last month` (bulan lalu)
- `last N days` / `past N days`, `last N weeks` / `past N weeks`
- `last_hour` / `past_hour`

Terintegrasi mulus dengan pencarian yang ada — frasa temporal dipisah dari kueri dan diterapkan sebagai jendela tanggal.

## 🧬 Soul Maintenance (Mesin Decay)

Manajemen siklus hidup memori bergaya biologis:

- **Peluruhan:** memori yang tidak digunakan selama 7+ hari (default `decayAfterDays`) kehilangan kepentingan dengan laju tetap per siklus (dibulatkan ke bawah, minimum 1).
- **Imunisasi:** memori dengan tag yang dilindungi tidak pernah meluruh.
- **Pengarsipan:** memori yang importance pasca-peluruhannya di bawah ambang diarsipkan.
- **Sapuan saat startup:** berjalan saat server dimulai dengan pengaman dedup 24 jam (kedaluwarsa + skor rendah + meluruh).

## 🤖 Alat Produktivitas Agentic

- `agent-context` — Konteks sesi dalam satu panggilan (memori relevan + tugas aktif + keputusan terbaru)
- `memory-write` (`type: "decision"`) — Persistensi keputusan terstruktur dengan context/rationale/alternatives
- `memory-write` (`type: "task_archive"`) — Ringkasan sesi yang dapat dicari via `key_decisions`/`next_steps`
- `synthesize` — ajukan pertanyaan yang didasarkan pada memori lokal menggunakan LLM Anda sendiri
- `repo-summarize` — simpan ringkasan proyek singkat per-repo

## Disclaimer

Semua fitur disediakan **"SEBAGAIMANA ADANYA"** tanpa jaminan kinerja atau keakuratan apa pun.
