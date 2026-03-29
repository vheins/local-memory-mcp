# Core Features & V2 Enhancements

Proyek ini bukan sekadar penyimpanan teks, melainkan sistem "otak" untuk agen AI yang dirancang untuk stabilitas jangka panjang.

## 🧠 Hybrid Semantic Search
Sistem menggunakan pendekatan hibrida untuk menemukan memori yang paling relevan:
1.  **Keyword Matching (TF-IDF):** Mencari kata kunci yang persis sama di SQLite.
2.  **Semantic Vector Search:** Menggunakan model AI `Transformers.js` secara lokal untuk memahami makna dibalik query.
3.  **Workspace Boost:** Memberikan skor tambahan pada memori yang secara geografis berada di folder yang sama dengan file yang sedang Anda kerjakan.

## 🔄 Tech-Stack Affinity
Kasus: Anda memiliki pengetahuan tentang **Filament** di Proyek A. Saat Anda membuat Proyek B (juga menggunakan Filament), Agen Anda secara otomatis dapat menarik best-practices tersebut jika Anda memberikan tag `filament` pada memori tersebut.
- Memori dapat bersifat **Lokal** (per repo), **Affinity** (per teknologi), atau **Global** (seluruh sistem).

## 🛡️ Anti-Hallucination Guard
Salah satu masalah utama Agen AI adalah "mencocok-cocokkan" informasi yang tidak relevan.
- **Strict Threshold (0.50):** Jika kemiripan semantik di bawah ambang batas, sistem dengan tegas mengembalikan hasil kosong, mencegah Agen berhalusinasi dari data yang salah.
- **Conflict Rejection:** Jika Agen mencoba menyimpan keputusan yang bertentangan dengan memori lama, sistem akan menolak dan memaksa Agen untuk melakukan `update` atau `supersede`.

## 📈 Memory Recall Tracking
Setiap kali Agen menggunakan memori, Agen diwajibkan memberikan feedback melalui tool `acknowledge`.
- Kita dapat melacak **Utility Rate** (seberapa sering memori ini benar-benar berguna).
- Memori dengan utility rendah akan perlahan "terlupakan" melalui sistem decay.

## 📉 Automatic Archiving (Natural Forgetting)
Sama seperti manusia, tidak semua hal perlu diingat selamanya.
- **Expired Memories:** Memori dengan TTL (Time-To-Live) akan diarsipkan otomatis.
- **Decay System:** Memori yang tidak pernah digunakan dalam 90 hari dan memiliki tingkat kepentingan rendah akan dipindahkan ke arsip agar tidak membanjiri konteks Agen.
