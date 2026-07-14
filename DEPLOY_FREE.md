# Deployment Gratis Permanen

Susunan deployment tanpa Railway, Render, atau Back4app:

- `calckastur.roidtaqi.workers.dev`: frontend Inventory di Cloudflare.
- `poskastur.roidtaqi.workers.dev`: frontend POS di Cloudflare.
- `kastur-sync.roidtaqi.workers.dev`: REST API dan WebSocket di Cloudflare Worker.
- Neon Free: PostgreSQL utama.

Backend Cloudflare berada di folder `cloudflare-sync-server`. Worker memakai Durable Object WebSocket Hibernation untuk koordinasi realtime dan Hyperdrive untuk mengakses Neon.

## 1. Amankan Neon

Connection string yang pernah dikirim melalui chat harus dirotasi terlebih dahulu.

1. Reset password role lama dari Neon Console.
2. Buat role baru bernama `hyperdrive_user`.
3. Buka `Connect`, pilih role tersebut, lalu nonaktifkan `Connection pooling`.
4. Salin direct connection string. Host direct tidak mengandung `-pooler`.

Jika role yang dibuat lewat SQL tidak muncul di dropdown Connect, gunakan alat lokal berikut untuk mengganti kredensial direct URL dengan aman:

```bash
bash scripts/prepare-hyperdrive-url.sh
```

Input connection string dan password disembunyikan selama pengetikan dan tidak disimpan ke file.

Direct connection string hanya digunakan sekali saat membuat Hyperdrive. Jangan simpan di Git atau frontend.

## 2. Buat Hyperdrive

Setelah Wrangler login, jalankan alat lokal berikut:

```bash
bash scripts/create-hyperdrive.sh
```

Alat membuat konfigurasi `kastur-neon` dengan cache query dinonaktifkan agar sinkronisasi selalu membaca data terbaru. Connection string dan password tidak ditampilkan. Salin Configuration ID dari hasil perintah, ganti `REPLACE_WITH_HYPERDRIVE_ID` di `cloudflare-sync-server/wrangler.jsonc`, lalu push ke GitHub.

## 3. Deploy Backend Worker

1. Di `Workers & Pages`, pilih `Create -> Import a repository`.
2. Pilih repo `roidtaqi/integrated-pos-app`.
3. Gunakan konfigurasi:

```txt
Worker name: kastur-sync
Root directory: cloudflare-sync-server
Build command: npm ci
Deploy command: npm run deploy
```

4. Setelah deploy pertama, buka Worker `kastur-sync`.
5. Di `Settings -> Variables and Secrets`, tambahkan secret runtime:

```txt
SYNC_API_TOKEN=<token acak baru>
```

Token dapat dibuat dengan `openssl rand -base64 32`. Deploy ulang setelah secret tersimpan.

## 4. Hubungkan Frontend

Pada Build Variables `calckastur` dan `poskastur`, gunakan:

```txt
VITE_SYNC_URL=wss://kastur-sync.roidtaqi.workers.dev
VITE_SYNC_API_TOKEN=<nilai SYNC_API_TOKEN yang sama>
```

Rebuild kedua frontend. Variabel `VITE_*` harus tersedia saat build, bukan hanya sebagai runtime Worker variable.

## 5. Verifikasi

Buka:

```txt
https://kastur-sync.roidtaqi.workers.dev/health
```

Target response:

```json
{
  "ok": true,
  "service": "kastur-cloudflare-sync-server",
  "storage": "postgres"
}
```

Setelah itu uji login, produk, transaksi, shift, kas, pelanggan, dan approval dari dua perangkat berbeda.

## Data Lama

Jika PostgreSQL Railway masih dapat diakses, gunakan direct connection string untuk proses dump/restore:

```bash
pg_dump "$RAILWAY_DATABASE_URL" --format=custom --no-owner --no-acl --file=kastur.dump
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$NEON_DIRECT_URL" kastur.dump
```

Jangan menggunakan pooled connection untuk `pg_dump` atau `pg_restore`.
