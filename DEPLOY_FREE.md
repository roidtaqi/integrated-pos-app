# Deployment Gratis Tanpa Kartu Kredit

Susunan deployment:

- Cloudflare Pages: frontend Kastur POS.
- Cloudflare Pages: frontend Kalkulator Tekad Mandiri.
- Back4app Containers: HTTP API dan WebSocket sync server.
- Neon: PostgreSQL utama.

Semua layanan dipilih pada paket Free. Jangan mengaktifkan upgrade, paid plan, atau billing add-on.

## 1. Buat PostgreSQL Neon

1. Daftar di `https://console.neon.tech` dan buat project bernama `kastur`.
2. Pilih region terdekat yang tersedia.
3. Dari halaman Connect, salin pooled connection string.
4. Simpan connection string tersebut sebagai `DATABASE_URL`. Jangan masukkan nilainya ke Git.

## 2. Deploy Sync Server di Back4app

1. Daftar di `https://www.back4app.com` dengan GitHub.
2. Pilih `Build new app -> Containers as a Service`.
3. Hubungkan repo `roidtaqi/integrated-pos-app`.
4. Pilih branch `main` dan isi Root Directory dengan `sync-server`.
5. Pilih container `Free`.
6. Tambahkan environment variables berikut:

```txt
DATABASE_URL=<pooled connection string Neon>
POSTGRES_SSL=true
SYNC_API_TOKEN=<token acak yang sama untuk kedua frontend>
NODE_ENV=production
```

Token dapat dibuat di terminal dengan:

```bash
openssl rand -base64 32
```

7. Deploy dan salin domain `https://....b4a.run`.
8. Buka `https://....b4a.run/health`. Deployment siap jika response memiliki `ok: true` dan `storage: postgres`.

## 3. Deploy POS di Cloudflare Pages

1. Di Cloudflare Dashboard buka `Workers & Pages -> Create -> Pages -> Connect to Git`.
2. Pilih repo `roidtaqi/integrated-pos-app`.
3. Gunakan konfigurasi build:

```txt
Framework preset: Vite
Build command: npm ci && npm run build
Build output directory: dist
Root directory: /
```

4. Tambahkan environment variables Production dan Preview:

```txt
VITE_SYNC_URL=wss://....b4a.run
VITE_SYNC_API_TOKEN=<nilai SYNC_API_TOKEN dari Back4app>
```

5. Deploy. Cloudflare memberikan domain `https://integrated-pos-app.pages.dev` atau nama unik yang tersedia.

## 4. Deploy Inventory di Cloudflare Pages

Ulangi langkah Cloudflare Pages untuk repo `roidtaqi/inventory-pricing-app` dengan build dan environment variables yang sama. Cloudflare akan memberikan domain `.pages.dev` kedua.

## 5. Pindahkan Data Lama

Jika PostgreSQL Railway masih dapat diakses:

```bash
pg_dump "$RAILWAY_DATABASE_URL" --format=custom --no-owner --no-acl --file=kastur.dump
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$NEON_DATABASE_URL" kastur.dump
```

Lakukan restore sebelum transaksi baru dibuat. Jika Railway tidak dapat diaktifkan, pertahankan data browser/PWA lama sampai backup lokal berhasil diekspor. IndexedDB terikat ke domain lama dan tidak otomatis ikut ke domain `.pages.dev`.

## 6. Pemeriksaan Akhir

1. Health server menunjukkan PostgreSQL aktif.
2. Login POS dan Inventory berfungsi.
3. Produk serta harga muncul di kedua perangkat.
4. Buat satu transaksi uji, tutup shift, dan periksa kembali dari perangkat lain.
5. Ajukan approval dari kasir dan pastikan owner menerimanya.
6. Jangan menghapus project Railway atau data browser lama sebelum semua pemeriksaan berhasil.

## Batas Paket Gratis

- Cloudflare Pages memiliki kuota build dan Workers, tetapi frontend statis aplikasi ini berada jauh di bawah batas penggunaan normal toko kecil.
- Back4app Free Container menyediakan resource terbatas dan ditujukan untuk preview/penggunaan ringan. Pantau memory dan restart pada dashboard.
- Neon Free menyediakan 0.5 GB storage per project dan compute akan tidur ketika tidak aktif. Koneksi pertama setelah lama idle dapat sedikit lebih lambat.
