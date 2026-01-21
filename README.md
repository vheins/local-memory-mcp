PRD – MCP Local Memory Service

TL;DR

Membangun MCP Local Memory Service berbasis Node.js yang menyediakan long-term, high-signal memory untuk coding copilot & antigravity agent. Sistem ini menyimpan keputusan, fakta kode, kesalahan, dan pola penting menggunakan SQLite + vector similarity search, sehingga agent tetap konsisten, tidak mengulang kesalahan, dan tahan terhadap typo / variasi query.


---

Problem Statement

Coding copilot dan agent saat ini:

Mudah kehilangan konteks keputusan sebelumnya

Mengulang kesalahan yang sama

Overfit ke prompt terakhir (gravity problem)

Lemah terhadap typo atau phrasing berbeda


Tanpa memory terstruktur, agent terasa "pintar sesaat" tapi tidak reliable untuk penggunaan jangka panjang.


---

Goals

Business Goals

Meningkatkan kualitas dan konsistensi output coding copilot

Mengurangi user correction berulang

Menjadikan agent usable untuk long-running projects


User Goals

Agent mengingat keputusan & constraint penting

Agent tidak mengulang kesalahan lama

Agent tetap relevan walau prompt berubah atau typo


Non-Goals

Bukan chat history logger

Bukan audit trail

Tidak mendukung distributed / cloud sync (local-first)



---

Target Users

Developer menggunakan coding copilot lokal

Power user / engineer yang menginginkan agent “punya ingatan”

Pengguna MCP-based agent system



---

User Stories

1. Sebagai developer, saya ingin agent mengingat keputusan arsitektur agar tidak perlu menjelaskannya berulang kali.


2. Sebagai developer, saya ingin agent tidak mengulang kesalahan yang sudah saya koreksi sebelumnya.


3. Sebagai developer, saya ingin agent tetap menemukan memory relevan walau saya salah ketik atau pakai istilah berbeda.


4. Sebagai agent, saya ingin memory yang ringkas dan relevan agar tidak membanjiri prompt.




---

Memory Types (Core Concept)

1. code_fact

Fakta stabil tentang codebase. Contoh:

Project pakai clean architecture

Semua API pakai zod validation


2. decision

Keputusan desain atau arsitektur. Contoh:

Tidak menggunakan ORM

Menggunakan raw SQL demi performa


3. mistake

Kesalahan yang tidak boleh diulang.
