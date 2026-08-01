# Fitur Inti & Peningkatan V2

Proyek ini lebih dari sekadar penyimpanan teks; ini adalah sistem "otak" untuk agen AI yang dirancang untuk stabilitas jangka panjang dan konsistensi proyek.

## 🧠 Pencarian Semantik Hibrida

Sistem menggunakan pendekatan hibrida untuk menemukan memori yang paling relevan:

1.  **Pencocokan Kata Kunci (TF-IDF):** Menemukan kecocokan kata kunci yang tepat di SQLite.
2.  **Pencarian Vektor Semantik:** Menggunakan model AI `Transformers.js` secara lokal untuk memahami makna di balik kueri.
3.  **Workspace Boost:** Memberikan skor peringkat tambahan pada memori yang terletak di folder yang sama dengan berkas yang sedang Anda kerjakan.

## 🔄 Afinitas Tech-Stack

**Kasus:** Anda memiliki pengetahuan tentang **Filament** di Proyek A. Saat Anda memulai Proyek B (juga menggunakan Filament), Agen Anda dapat secara otomatis menarik praktik terbaik tersebut jika Anda menandai memori itu dengan `filament`.

- Memori dapat bersifat **Lokal** (per repo), **Berbasis Afinitas** (per teknologi), atau **Global** (aturan universal).

## 🛡️ Pengaman Anti-Hallusinasi

Salah satu masalah utama dengan Agen AI adalah "mencocokkan" informasi yang tidak relevan.

- **Ambang Batas Ketat (0,50):** Jika kesamaan semantik di bawah ambang batas, sistem secara ketat mengembalikan hasil kosong, mencegah Agen berhalusinasi berdasarkan data yang salah.
- **Penolakan Konflik:** Jika Agen mencoba menyimpan keputusan yang bertentangan dengan yang sudah ada, sistem akan menolaknya dan memaksa Agen untuk menggunakan `update` atau `supersede`.

## 📈 Pelacakan Penggunaan Memori

Setiap kali Agen menggunakan memori, ia diwajibkan memberikan umpan balik melalui alat `acknowledge`.

- Kami melacak **Tingkat Kegunaan** (seberapa sering sebuah memori benar-benar membantu).
- Memori dengan utilitas rendah secara bertahap akan "dilupakan" melalui sistem peluruhan.

## 📉 Pengarsipan Otomatis (Pelupaan Alami)

Seperti manusia, tidak semuanya perlu diingat selamanya.

- **Memori Kedaluwarsa:** Memori dengan TTL (Time-To-Live) secara otomatis diarsipkan.
- **Sistem Peluruhan:** Memori yang tidak digunakan selama 90 hari dengan kepentingan rendah dipindahkan ke arsip untuk menjaga konteks Agen tetap bersih.

## 🧩 Knowledge Graph (Graf Pengetahuan)

Penyimpanan relasi entitas terstruktur yang memetakan pengetahuan domain yang kompleks:

- **Entitas** dengan tipe (orang, tempat, organisasi, konsep) dan deskripsi
- **Relasi** dengan koneksi ber-tipe antar entitas
- **Observasi** yang menghubungkan konteks ke entitas
- **Ekstraksi otomatis**: NLP Archivist secara otomatis mengekstrak entitas saat memori disimpan
- **Dashboard**: Visualisasi graf gaya-tarik (force-directed) interaktif

## 🕰️ Time Tunnel (Pencarian Temporal)

Filter pencarian memori dengan referensi waktu berbahasa alami:

- "hari ini", "kemarin", "minggu ini"
- "minggu lalu", "bulan lalu"
- "N hari terakhir", "N jam terakhir"
- Terintegrasi mulus dengan pencarian yang ada — cukup tambahkan frasanya

## 🧬 Soul Maintenance (Mesin Decay)

Manajemen siklus hidup memori bergaya biologis:

- **Peluruhan:** Memori yang tidak digunakan kehilangan kepentingan seiring waktu
- **Imunisasi:** Memori yang dilindungi tag tidak akan pernah meluruh
- **Pengarsipan:** Memori di bawah ambang batas diarsipkan secara otomatis
- **Sapuan saat startup:** Menjalankan maintenance saat server dimulai (dedup 24 jam)

## 🤖 Alat Produktivitas Agentic

- **agent-context**: Konteks sesi dalam satu panggilan (memori relevan + tugas aktif + keputusan terbaru)
- **decision-log**: Persistensi keputusan terstruktur dengan konteks/alasan/alternatif
- **session-summarize**: Arsipkan ringkasan sesi sebagai memori `task_archive` yang dapat dicari

## ⚠️ Penyangkalan

Semua fitur disediakan **"SEBAGAIMANA ADANYA"** tanpa jaminan kinerja atau keakuratan apa pun.
