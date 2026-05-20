# Dasbor Web: Pusat Komando Global + Ruang Kerja Repo

**MCP Local Memory Dashboard** kini melayani dua tugas sekaligus:

- **Orkestrasi global** untuk koordinator agen.
- **Eksekusi per-repository** untuk pekerjaan detail di dalam satu repo.

Dasbor tetap selaras dengan model koordinasi yang sama yang diekspos oleh alat MCP: tasks, claims, handoffs, standards, dan memories semuanya berbagi satu alur operasional.

## Kemampuan Utama

- **Pusat Komando Global:** Tab `Dashboard` menunjukkan beban kerja lintas-repositori, tekanan koordinasi, throughput, dan repo yang perlu mendapat perhatian pertama.
- **Pulse Repo Terpilih:** Tab `Dashboard` yang sama menyimpan metrik memori, tugas, dan eksekusi khusus repo untuk repositori yang saat ini dipilih.
- **Visibilitas Koordinasi Tugas:** Kartu papan tugas dan laci detail tugas kini menampilkan klaim aktif dan handoff tertunda secara langsung.
- **Operasi Klaim:** Tab `Handoffs` menampilkan klaim aktif dan memungkinkan Anda melepaskan kepemilikan yang basi tanpa meninggalkan dasbor.
- **Operasi Handoff:** Baris handoff kini mengekspos konteks transfer yang lebih kaya termasuk `task_code`, `updated_at`, `expires_at`, dan `context` terstruktur.
- **Keselarasan Referensi:** Tindakan dasbor dan alat MCP kini mengikuti alur yang sama untuk pembaruan status tugas dan pembersihan koordinasi.

## Cara Memulai

Jalankan dasbor dari root repositori:

```bash
npx @vheins/local-memory-mcp dashboard
```

Kemudian buka `http://localhost:3456`.

## Cara Menggunakan

### 1. Mode Orkestrator
Gunakan tab `Dashboard` sebelum masuk ke dalam repo.

- Tinjau **Pusat Komando Global** untuk jumlah repo, repo aktif, tugas terblokir, klaim aktif, dan handoff tertunda.
- Gunakan **Papan Perhatian** untuk mengidentifikasi repositori mana yang memiliki tekanan tertinggi dari pekerjaan terblokir, penumpukan antrean, atau overhead koordinasi.
- Pertahankan satu repositori terpilih di sidebar untuk menjaga pulse repo langsung di bawah gambaran global.

### 2. Mode Eksekusi Repositori
Setelah repo dipilih:

- Buka tab `Tasks` untuk papan kanban.
- Perhatikan kartu tugas untuk lencana koordinasi aktif yang menunjukkan pemilik klaim saat ini atau handoff tertunda.
- Buka laci tugas untuk memeriksa status koordinasi terperinci sebelum memindahkan tugas atau mengambil kepemilikan.

### 3. Klaim dan Handoff
Gunakan tab `Handoffs` sebagai konsol koordinasi.

- **Klaim:** Periksa kepemilikan aktif di seluruh repo yang dipilih dan lepaskan klaim basi ketika penugasan ulang diperlukan.
- **Handoff:** Buat konteks transfer untuk pekerjaan yang belum selesai, periksa konteks terstruktur, dan tutup handoff yang sudah dikonsumsi atau basi.
- **Pembersihan:** Menyelesaikan atau membatalkan tugas melalui dasbor kini mengikuti `task-update` MCP, sehingga klaim aktif dilepaskan dan handoff tertunda yang terkait kedaluwarsa secara otomatis.

## Model Koordinasi

Dasbor mencerminkan alur alat MCP:

- `task-claim` membuat kepemilikan
- `claim-list` memeriksa kepemilikan
- `claim-release` membersihkan kepemilikan basi
- `handoff-create` mentransfer pekerjaan yang belum selesai
- `handoff-list` memeriksa status antrean
- `handoff-update` menutup transfer yang basi atau telah dikonsumsi
- `task-update` adalah jalur transisi status yang otoritatif

Ini berarti dasbor bukan lagi jalur mutasi terpisah untuk tugas. Pembersihan koordinasi dan aturan siklus hidup tugas tetap konsisten antara UI dan pemanggil MCP.

## Catatan

- Sebagian besar tab tetap **per-repositori**.
- Tab `Dashboard` sengaja bersifat **hibrida**: gambaran global terlebih dahulu, pulse repositori terpilih kedua.
- Jika tidak ada repositori yang dipilih, tab `Dashboard` tetap berfungsi dalam mode global.

## Penyangkalan

**DASBOR INI DISEDIAKAN "SEBAGAIMANA ADANYA"**, tanpa jaminan apa pun. Ini dimaksudkan untuk inspeksi manual dan pengelolaan data lokal.
