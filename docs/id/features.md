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

## ⚠️ Penyangkalan
Semua fitur disediakan **"SEBAGAIMANA ADANYA"** tanpa jaminan kinerja atau keakuratan apa pun.
