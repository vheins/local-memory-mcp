# Pencarian Hibrida: Bagaimana Sistem "Berpikir"

MCP Local Memory Service menggunakan **Mesin Pencarian Hibrida** untuk memastikan Agen AI Anda selalu menemukan informasi yang tepat, bahkan jika Anda menggunakan kata yang berbeda atau melakukan kesalahan ketik.

## 🔍 Cara Kerjanya

Setiap hasil pencarian adalah paduan berbobot dari empat sinyal:

1. **Kesamaan semantik (40%)** — relevansi berbasis makna menggunakan model `all-MiniLM-L6-v2` secara lokal via Transformers.js. Ini memungkinkan Agen memahami bahwa "skema basis data" terkait dengan "migrasi", meskipun kata-katanya tidak cocok.
2. **Kecocokan kata kunci (30%)** — token dan frasa tepat yang ditemukan di teks tersimpan. Kueri "auth" langsung menemukan konten yang memuat istilah persis itu.
3. **Kebaruan / recency (15%)** — entri yang lebih baru berskor lebih tinggi; sinyalnya setengah-umur setiap ±30 hari.
4. **Afinitas domain / workspace (15%)** — penguatan saat repo atau folder memori cocok dengan konteks kerja Anda saat ini (mis. bekerja di `src/auth/` menguatkan memori yang di-scope ke folder `auth` atau repo).

Paduannya dihitung: `skorAkhir = kesamaan·0,40 + kataKunci·0,30 + recency·0,15 + domain·0,15`.

## 🧠 Fitur Cerdas

- **Ambang Batas Adaptif:** ketelitian menyesuaikan ukuran kumpulan hasil — longgar untuk kumpulan kecil (0,10 untuk memori) agar proyek baru tetap mendapat hasil, lebih ketat untuk kumpulan besar (0,40) untuk memangkas kebisingan. Jika semua kandidat di bawah ambang, hasil terbaik tunggal tetap dikembalikan, jadi cold start tidak pernah kosong.
- **Afinitas Tech-Stack:** kirim `current_tags` (mis. `["react", "laravel"]`) untuk menyertakan memori yang ditandai teknologi itu dari proyek lain. Pengalaman Agen dengan pustaka di Proyek A mengikuti ke Proyek B.
- **Pencegahan Konflik:** menyimpan memori yang bertentangan dengan yang ada (kesamaan kosinus ≥ 0,85) ditolak dengan error `MEMORY_CONFLICT`, menjaga basis pengetahuan Anda tetap sumber kebenaran tunggal.

## ⚠️ Penyangkalan

Kinerja pencarian semantik tergantung pada kemampuan CPU lokal dan kualitas teks yang disimpan. **PERANGKAT LUNAK INI DISEDIAKAN "SEBAGAIMANA ADANYA"**, tanpa jaminan keakuratan.
