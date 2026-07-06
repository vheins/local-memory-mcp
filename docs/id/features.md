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

## 🕸️ Knowledge Graph (Graf Pengetahuan)

Memungkinkan agen untuk membangun dan menanyakan jaringan entitas, relasi, dan observasi:

- **Entitas:** Orang, tempat, organisasi, atau konsep yang muncul dalam sesi agen.
- **Relasi:** Hubungan berarah antar entitas (mis. `menggunakan`, `bergantung_pada`, `mengimplementasikan`).
- **Observasi:** Catatan yang menghubungkan entitas ke konteks tertentu (mis. "disebutkan dalam memori: ...").
- **Visualisasi:** Ditampilkan sebagai graf gaya-tarik (force-directed) di dashboard web.

Data graf disimpan dalam tabel SQLite khusus (`entities`, `relations`, `observations`) dengan integritas foreign key.

## 🕰️ Time Tunnel (Terowongan Waktu)

Filter temporal cerdas yang tertanam langsung dalam pencarian memori:

- **Frasa relatif:** `hari ini`, `kemarin`, `minggu ini`, `minggu lalu`, `bulan lalu`, `N hari terakhir`, `N minggu terakhir`.
- **Cara kerja:** Saat agen memanggil `memory-search`, sistem mendeteksi frasa waktu dalam kueri, menghapusnya dari kueri, lalu menerapkan filter sejak/sampai pada hasil.
- **Tanpa perubahan skema:** Filter diterapkan sebagai lapisan pasca-pencarian tanpa menyentuh indeks atau tabel.

## 🔮 Soul Maintenance (Pemeliharaan Jiwa)

Mesin decay biologis yang menjaga kualitas memori tetap tinggi:

- **Peluruhan Bertahap:** Memori yang tidak digunakan selama 7+ hari mengalami penurunan importance sebesar 0,5 per siklus.
- **Arsip Otomatis:** Memori dengan importance di bawah 1 dipindahkan ke arsip.
- **Imunitas Tag:** Tag tertentu (mis. `critical`, `never-forget`) dapat diimunisasi — memori dengan tag tersebut tidak akan pernah meluruh.

Sistem berjalan sebagai pekerjaan latar terjadwal yang terintegrasi dengan siklus maintenance server.

## 🧰 Agentic Tools (Alat Khusus Agen)

Tiga alat baru yang dirancang untuk alur kerja multi-agen:

- **`agent-context`:** Menggabungkan memori relevan, tugas aktif, dan keputusan terbaru menjadi satu blok konteks yang dapat digunakan agen untuk orientasi cepat.
- **`decision-log`:** Mencatat keputusan arsitektur dengan format terstruktur (ringkasan, konteks, alasan, alternatif) — disimpan sebagai memori tipe `decision`.
- **`session-summarize`:** Meringkas sesi kerja ke dalam memori tipe `task_archive`, termasuk keputusan utama dan langkah selanjutnya.

## 🔗 Upstream Aliases (Alias Hulu)

Untuk kompatibilitas dengan alat pihak ketiga yang sudah ada, sistem menyediakan alias:

| Alat Asli        | Tujuan                           |
| ---------------- | -------------------------------- |
| `remember_fact`  | Alias ke `memory-store`          |
| `remember_facts` | Alias ke `memory-store` (massal) |
| `recall`         | Alias ke `memory-search`         |
| `forget`         | Alias ke `memory-delete`         |

## ⚠️ Penyangkalan

Semua fitur disediakan **"SEBAGAIMANA ADANYA"** tanpa jaminan kinerja atau keakuratan apa pun.
