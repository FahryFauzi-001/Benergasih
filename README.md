# BenerGasih

> **Bener gasih? Scan dulu, baru share.**

🔗 **Live Demo:** https://benergasih.vercel.app/

Terminal web bergaya cyberpunk untuk mengecek kabar mencurigakan lewat basis data cek fakta.

> **Disclaimer:** Aplikasi ini **bukan hakim**, hanya pembawa putusan dari publisher cek fakta. Putusan akhir tetap berada di sumber aslinya.

## Tiga Status Hasil

| Status | Arti |
|---|---|
| 🔴 **TERBANTAH** | Publisher cek fakta memberi rating salah/hoaks |
| 🟡 **RUMOR · BELUM TERBUKTI** | Menyesatkan, belum ada cek fakta, rating tidak dikenali, atau hanya artikel terkait (*belum terbukti, bukan berarti salah*) |
| 🔵 **TERVERIFIKASI** | Benar menurut sumber cek fakta |

Error teknis dan kuota habis ditampilkan secara netral tanpa warna putusan.

## Cara Kerja

```
Klaim / link berita → (ekstrak judul jika link) → Cache in-memory → Google Fact Check API → Tavily Search API (jika kosong)
```

1. **Google Fact Check Tools API** mencari putusan dari publisher cek fakta, lalu rating teks bebas dipetakan ke status (urutan pencocokan: *negasi/sebagian → salah → benar*).
2. **Tavily Search API** hanya dipanggil jika Google tidak menemukan hasil, dan selalu mengembalikan status 🟡 *artikel terkait* (bukan putusan).
3. Seluruh API key disimpan di serverless backend (`api/check.js`), tidak pernah diekspos ke browser.

## Tech Stack

- **Frontend:** HTML, CSS, Vanilla JavaScript (ES Modules), tanpa framework
- **Backend:** Vercel Serverless Function (`api/check.js`) + `server.py` untuk dev lokal
- **API:** Google Fact Check Tools API & Tavily Search API

## Jalankan Lokal

1. Salin `.env.example` menjadi `.env`, lalu isi:
   ```env
   GOOGLE_FACTCHECK_KEY=your_google_key
   TAVILY_KEY=your_tavily_key
   ```
2. Jalankan server lokal:
   ```bash
   python server.py
   ```
3. Buka `http://localhost:3000`.

## Deploy ke Vercel

1. Import repo ini di [Vercel](https://vercel.com) (Framework Preset: `Other`).
2. Tambahkan `GOOGLE_FACTCHECK_KEY` dan `TAVILY_KEY` di **Settings → Environment Variables**.
3. Klik **Deploy**.

## Batasan

- Tidak menilai kebenaran klaim sendiri; hanya meneruskan hasil publisher cek fakta.
- Klaim baru yang belum pernah dicek publisher akan tampil kuning.
- Artikel terkait dari Tavily bukan putusan cek fakta.
- Cache dan rate limit bersifat in-memory (reset saat serverless cold start).
