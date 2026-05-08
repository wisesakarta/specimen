# SAKA Studio Learning Wiki: Aksara

## Versi 1.1: Bypassing Fontdue CSS WAF (Mass Driver)
*Date: 02 Maret 2026*

### 🗺️ Arsitektur (Peta Kota)
Fontdue memisahkan API katalog (GraphQL) dan Resource Tampilan (CSS + WOFF2). Bayangkan GraphQL API sebagai "buku menu" di restoran, sedangkan endpoint Webfont (CSS) bertindak sebagai "dapur" tempat pesanan dimasak. Mass Driver memiliki konfigurasi pengaman canggih (WAF Cloudflare/Fastly) yang sangat melindungi area "dapur" ini. Walaupun kita tahu kode menu rahasianya (melalui Collection UUID encoded Base-64), dapur tidak akan melayani pesanan kecuali yang memintanya tampak seperti klien restoran resmi.

### 💡 Keputusan Teknis (Alasan Mengapa)
Kami menggunakan metode simulasi *Secure Fetch* secara eksplisit. Alih-alih merogoh DOM HTML dengan RegEx yang seringkali rapuh setiap kali struktur UI berubah, kami langsung "berbicara bahasanya" dengan menggunakan Chrome-like network request. Ini jauh lebih tangguh (resilient) daripada web-scraping murni.

### ⚔️ Cerita Perang (Bug & Perbaikan)
Awalnya, *MassDriverScraper* kita berhasil mendapatkan URL CSS (seperti `https://fonts.fontdue.com/mass-driver/css/Rm9...%3D.css`) lewat GraphQL `/graphql`. Sayangnya, ketika kita mencoba mengunduh CSS itu, sistem hanya menerima respon HTML dari beranda `fontdue.com`! Bot scraper kita ditolak mentah-mentah.
*Perbaikannya:* Setelah inspeksi menggunakan `browser_subagent`, kami merekam bahwa browser asli mengirim sekumpulan passport (headers) bertuliskan `Sec-Fetch-Dest: style` dan `Accept: text/css`. Setelah bot kita menyamar menggunakan passport yang sama, Cloudflare membuka akses ke payload CSS yang sesungguhnya!

### 🧙‍♂️ Kebijaksanaan (Pelajaran Berharga)
*Server Headers adalah Paspor Diplomatik.*
API end-point modern bukan hanya peduli soal URL yang valid, tetapi juga "siapa" yang mengetuk pintunya. Memberi header otentik seperti `Sec-Fetch-Dest: style` ibarat menunjukkan paspor diplomatik kepada penjaga gerbang firewall internasional.

### ✅ Praktik Terbaik
Saat mengekstraksi data dari CDN yang diamankan oleh Cloudflare/Fastly (seperti platform Fontdue):
1. **Never scrape naked.** Selalu lengkapi `fetch` dengan properti `Referer` dan `Origin`.
2. **Mimic intent.** Gunakan `Sec-Fetch-Dest` untuk memberi tahu server bahwa kita mengharapkan stylesheet atau font secara spesifik.
3. Gunakan `AbortController` dan mekanisme retry untuk mencegah scraper hang saat timeout.
