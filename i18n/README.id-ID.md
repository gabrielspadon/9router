# 9Router

> Ringkasan terjemahan yang dipersingkat. Dokumentasi kanonik tersedia dalam
> bahasa Inggris di [README.md](../README.md) dan
> [docs/README.md](../docs/README.md).

9Router adalah gateway perutean AI lokal beserta dasbornya. Ia menyediakan satu
endpoint yang kompatibel dengan OpenAI di `/v1/*`, menerjemahkan setiap
permintaan ke format yang diharapkan penyedia yang dipilih, dan berpindah antar
model maupun antar akun, sehingga satu konfigurasi klien tetap berjalan ketika
sebuah penyedia kehabisan kuota, membatasi laju, atau gagal.

<p align="center">
  <img src="../images/9router.png" alt="Dasbor 9Router" width="800"/>
</p>

## Instalasi

```bash
npm install -g 9router
9router
```

Dasbor berada di `http://localhost:20128/dashboard` dan API yang kompatibel
dengan OpenAI di `http://localhost:20128/v1`. Login pertama memakai
`INITIAL_PASSWORD`, yang nilainya secara bawaan `123456`. Gantilah nilai itu.

Langkah lengkapnya ada di
[docs/getting-started.md](../docs/getting-started.md).

## Status fork

Repositori ini adalah fork yang dipelihara secara independen dari
[decolua/9router](https://github.com/decolua/9router). Fork ini mengikuti
proyek asal sambil membawa perbaikan dan integrasi lokal menurut jadwalnya
sendiri. Nama 9Router, riwayat proyek asal, lisensi, dan atribusi penulis tetap
dipertahankan.

Proyek asal adalah rujukan yang hanya dibaca, dan seluruh pengembangan terjadi
di sini. Fork ini tidak didukung oleh proyek asal dan tidak berbicara atas nama
proyek tersebut.

Teks lengkapnya, termasuk proses sinkronisasi, ada pada bagian "Fork status" di
[README.md](../README.md) berbahasa Inggris.

## Dokumentasi

- [README.md](../README.md), halaman utama berbahasa Inggris.
- [docs/README.md](../docs/README.md), indeks dokumentasi.

## Lisensi

MIT. Lihat [LICENSE](../LICENSE).
