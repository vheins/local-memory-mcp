# Pencarian Hibrida: Bagaimana Sistem "Berpikir"

MCP Local Memory Service menggunakan **Mesin Pencarian Hibrida** yang canggih untuk memastikan Agen AI Anda selalu menemukan informasi yang tepat, bahkan jika Anda menggunakan kata yang berbeda atau melakukan kesalahan ketik.

## 🔍 Cara Kerjanya

Pencarian dilakukan dalam tiga lapisan berbeda untuk menyeimbangkan kecepatan dan akurasi:

1.  **Pencocokan Tekstual (Presisi):** Menemukan kata kunci dan frasa yang tepat di SQLite. Ini memastikan bahwa kueri untuk "auth" segera menemukan memori yang mengandung istilah yang tepat tersebut.
2.  **Pencarian Vektor Semantik (Konteks):** Menggunakan model `all-MiniLM-L6-v2` secara lokal melalui `Transformers.js`. Ini memungkinkan Agen memahami bahwa "skema basis data" terkait dengan "migrasi," bahkan jika kata-katanya tidak cocok.
3.  **Afinitas Workspace (Relevansi):** Hasil ditingkatkan berdasarkan lokasi proyek Anda saat ini. Jika Anda bekerja di `src/auth/login.ts`, memori yang ditandai dengan `auth` atau terletak di folder `auth` mendapatkan prioritas peringkat.

## 🧠 Fitur Cerdas

- **Ambang Batas Dinamis:** Sistem secara otomatis menyesuaikan "ketelitiannya" berdasarkan ukuran basis data Anda. Lebih longgar saat Anda memulai proyek baru untuk membantu Agen belajar, dan lebih ketat seiring pertumbuhan proyek Anda untuk mencegah kebisingan.
- **Afinitas Tech-Stack:** Memori yang ditandai dengan nama teknologi (misalnya, `react`, `laravel`) dibagikan antar proyek. Pengalaman Agen Anda dengan sebuah pustaka di Proyek A akan mengikuti Anda ke Proyek B.
- **Pencegahan Konflik:** Sistem secara semantis mendeteksi jika memori baru bertentangan dengan memori lama dan memperingatkan Agen, memastikan basis pengetahuan Anda tetap menjadi sumber kebenaran tunggal.

## 📊 Rumus Penilaian
Setiap hasil pencarian diberi skor dari **0,0 hingga 1,0**:
- **50% Skor Semantik:** Relevansi berbasis makna.
- **50% Skor Tekstual:** Kecocokan kata kunci dan peningkatan kepentingan.

*Catatan: Hasil di bawah 0,50 biasanya disaring untuk mencegah halusinasi.*

## ⚠️ Penyangkalan
Kinerja pencarian semantik tergantung pada kemampuan CPU lokal dan kualitas teks yang disimpan. **PERANGKAT LUNAK INI DISEDIAKAN "SEBAGAIMANA ADANYA"**, tanpa jaminan keakuratan.
