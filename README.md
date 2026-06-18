# Kastur POS

Kastur POS adalah aplikasi kasir/POS modern, offline-first, dan PWA-installable. Aplikasi ini dibuat sebagai sales execution layer yang terpisah dari Inventory Pricing App.

Inventory Pricing App tetap menjadi pricing master / pricing engine untuk produk, SKU, barcode, satuan, cost, effective date, dan harga aktif. POS ini tidak menghitung margin, tidak mengubah approval harga, dan tidak membawa margin rule ke layar kasir.

## Stack

- React + TypeScript + Vite
- Tailwind CSS
- Dexie IndexedDB untuk local-first database
- PWA service worker via `vite-plugin-pwa`
- React Router, lucide icons, react-hot-toast

## Menjalankan Aplikasi

```bash
npm install
npm run dev
```

Jalankan sync server real-time lokal:

```bash
npm run sync:server
```

Default production WebSocket URL:

```txt
wss://pos-server.up.railway.app
```

Untuk development lokal, buat `.env.local` sebelum menjalankan `npm run dev`:

```txt
VITE_SYNC_URL=ws://localhost:8787
VITE_SYNC_API_TOKEN=
```

Build production:

```bash
npm run build
npm run preview
```

## Deploy ke Railway

Inventory Pricing App sudah bisa berjalan sendiri di Railway, misalnya:

```txt
https://calc-kastur.up.railway.app/
```

Untuk melengkapi suite ini, deploy dua service dari repo `integrated-pos-app`:

- `integrated-pos-app` untuk frontend POS.
- `integrated-pos-sync-server` untuk WebSocket sync antara Inventory dan POS.

### Service 1 - Kastur POS

1. Buka Railway project yang ingin dipakai.
2. Pilih `New -> GitHub Repo`.
3. Pilih repo `roidtaqi/integrated-pos-app`.
4. Gunakan Dockerfile default:

```txt
Dockerfile
```

5. Generate domain Railway untuk service POS.

Service ini memakai Caddy dan otomatis fallback ke `index.html`, jadi refresh route seperti `/pos`, `/sync`, dan `/reports` tetap aman.

### Service 2 - Integrated POS Sync Server

1. Di project Railway yang sama, pilih `New -> GitHub Repo`.
2. Pilih repo `roidtaqi/integrated-pos-app` lagi.
3. Pada service settings, set Dockerfile path menjadi:

```txt
sync-server/Dockerfile
```

4. Generate domain Railway untuk service sync server.
5. Buka URL `/health` untuk memastikan service hidup.

Contoh:

```txt
https://integrated-pos-sync-server.up.railway.app/health
```

Jika response berisi `ok: true`, WebSocket server sudah siap.

### URL Sync yang Dipakai di Aplikasi

Karena Inventory dan POS berjalan di HTTPS, URL sync harus memakai `wss://`, bukan `ws://`.

Default production POS sudah diarahkan ke server Kastur:

```txt
wss://pos-server.up.railway.app
```

Kastur POS tidak menampilkan input URL/token ke user kasir. POS otomatis connect memakai konfigurasi build aplikasi.

Jika suatu saat sync server pindah URL atau token diganti, ubah variable build di service frontend POS lalu redeploy:

```txt
VITE_SYNC_URL=wss://domain-sync-baru.up.railway.app
VITE_SYNC_API_TOKEN=token-yang-sama-dengan-sync-server
```

Untuk service sync server, token REST API tetap memakai:

```txt
SYNC_API_TOKEN=token-yang-sama-dengan-frontend
```

Inventory Pricing App masih perlu mengisi URL/token di halaman `Home -> Data & Pengaturan -> Sync`, karena Inventory dipakai sebagai perangkat admin/source of truth.

Setelah kedua aplikasi tersambung:

1. Dari Inventory, klik `Publish Catalog Sekarang`.
2. Dari POS, buka `Sinkronisasi` dan pastikan status `CONNECTED`.
3. Transaksi POS baru akan dikirim ke sync server dan diterima Inventory.

### Cloud Snapshot Multi-device

Sync server juga menyediakan REST API untuk menyimpan snapshot Inventory agar data laptop dan HP bisa sama.

Endpoint utama:

```txt
GET /api/inventory/snapshot
PUT /api/inventory/snapshot
GET /api/pos/sales
GET /api/state
```

Alur praktis:

1. Di Inventory laptop, buka `Home -> Data & Pengaturan -> Sync`.
2. Isi URL sync server, misalnya `wss://pos-server.up.railway.app`.
3. Klik `Upload Cloud`.
4. Di Inventory HP, isi URL yang sama.
5. Klik `Ambil Cloud`.
6. Di POS, buka `Sinkronisasi`, lalu klik `Ambil Catalog Cloud` jika catalog belum masuk otomatis.

Jika ingin membatasi akses REST API, set env berikut pada service sync server:

```txt
SYNC_API_TOKEN=isi-token-rahasia
```

Lalu isi token yang sama di halaman Sync Inventory. POS mengambil token dari konfigurasi build `VITE_SYNC_API_TOKEN`.

### Railway PostgreSQL

Untuk membuat snapshot cloud lebih tahan restart/redeploy, pasang PostgreSQL ke service sync server dan pastikan env berikut tersedia:

```txt
DATABASE_URL=postgresql://...
```

Server otomatis membuat tabel `sync_state` dan menyimpan state realtime di sana. Jika `DATABASE_URL` tidak ada, server tetap berjalan memakai file storage lokal.

### Optional - Railway Volume

Sync server menyimpan state ke file `realtime-sync-state.json`. Untuk demo singkat, storage container biasa sudah cukup. Jika ingin state lebih awet, tambahkan Railway Volume pada service sync server dan set environment variable:

```txt
SYNC_DATA_DIR=/data
```

Lalu mount volume ke:

```txt
/data
```

## Deploy Gratis ke Render

Repo ini menyediakan `render.yaml` untuk deploy tiga service sekaligus:

- `inventory-pricing-app` dari repo `roidtaqi/inventory-pricing-app` sebagai Render Static Site.
- `integrated-pos-app` sebagai Render Static Site.
- `integrated-pos-sync-server` sebagai Render Free Web Service untuk realtime WebSocket sync.

Langkah:

1. Push repo `inventory-pricing-app` dan `integrated-pos-app` ke GitHub.
2. Buka Render Dashboard.
3. Pilih `New -> Blueprint`.
4. Pilih repo `roidtaqi/integrated-pos-app`.
5. Pastikan Blueprint Path memakai `render.yaml`.
6. Klik `Apply` / `Deploy Blueprint`.
7. Setelah deploy selesai, buka service `integrated-pos-sync-server`.
8. Salin URL Render, misalnya `https://integrated-pos-sync-server.onrender.com`.
9. Ubah menjadi `wss://integrated-pos-sync-server.onrender.com`.
10. Masukkan URL `wss://...` itu di halaman Sync Inventory Pricing App.
11. Untuk POS, set `VITE_SYNC_URL=wss://integrated-pos-sync-server.onrender.com` di service frontend, lalu redeploy.

Catatan Render Free:

- Web service gratis bisa sleep setelah tidak aktif. Koneksi pertama bisa butuh waktu saat service bangun.
- Jika sync belum connect, buka `https://integrated-pos-sync-server.onrender.com/health` untuk membangunkan service.
- State sync server di free service tidak untuk production final karena storage lokal bisa hilang saat restart/redeploy.

Quality check:

```bash
npm run lint
npm run build
```

## Akun Demo

| Role | PIN | Akses |
| --- | --- | --- |
| Roid Owner | `1111` | Semua akses |
| Nawir Admin | `2222` | Produk, stok, laporan, shift, sinkronisasi, pengaturan |
| Kastur Supervisor | `3333` | POS, shift, laporan, diskon, void/refund future |
| Roid/Nawir Kasir | `4444` / `5555` | POS, buka/tutup shift, pelanggan, cetak struk |

## Modul MVP

- Authentication & role permission lokal.
- POS transaction screen dengan search, barcode scanner keyboard input, cart, pilih satuan, diskon permission-based, split payment, cash change, dan receipt preview.
- Product catalog lokal dari import JSON/CSV Inventory Pricing App.
- Transaction service atomic: transaction, items, payments, stock movement, audit log, dan sync queue disimpan dalam satu Dexie transaction.
- Stock balance dan stock movement: SALE, ADJUSTMENT, IMPORT/SYNC-ready.
- Shift management: open shift, cash in, cash out, close shift, expected cash, actual cash, selisih.
- Reports: sales summary, payment method, best-selling products, sales per cashier, sales per shift, gross sales, discount, net sales.
- Customer management sederhana.
- Sync module: manual import catalog dan manual export sales JSON.
- Settings: toko/outlet, struk, pajak opsional, role overview, integrasi.

## Database Lokal

Schema IndexedDB minimal tersedia di `src/services/db.ts`:

- `users`
- `roles`
- `permissions`
- `outlets`
- `products`
- `product_units`
- `product_barcodes`
- `stock_balances`
- `stock_movements`
- `transactions`
- `transaction_items`
- `payments`
- `shifts`
- `cash_movements`
- `customers`
- `sync_logs`
- `sync_queue`
- `audit_logs`
- `app_settings`

## Kontrak Import dari Inventory Pricing App

Format resmi yang diterima POS:

```json
{
  "products": [
    {
      "id": "prod_001",
      "sku": "SKU-001",
      "name": "Indomie Goreng",
      "barcode": "089686010013",
      "category": "Mie Instan",
      "brand": "Indomie",
      "is_active": true,
      "units": [
        {
          "unit_id": "unit_001",
          "unit_name": "pcs",
          "conversion_to_base": 1,
          "active_selling_price": 3500,
          "cost_price": 2800,
          "effective_date": "2026-06-17"
        }
      ]
    }
  ]
}
```

POS juga mendukung format backup Inventory Pricing App yang berisi `products`, `productUnits`, `categories`, `brands`, dan `priceCalculations`. File contoh tersedia di `inventory-pricing-backup-2026-06-17.json`.

## Import CSV

Header CSV yang didukung:

```csv
product_id,sku,name,barcode,category,brand,is_active,unit_id,unit_name,conversion_to_base,active_selling_price,cost_price,effective_date
prod_001,SKU-001,Indomie Goreng,089686010013,Mie Instan,Indomie,true,unit_001,pcs,1,3500,2800,2026-06-17
```

## Kontrak Export Sales dari POS

```json
{
  "sales": [
    {
      "transaction_id": "TRX-20260617-0001",
      "cashier_id": "user_001",
      "outlet_id": "outlet_001",
      "created_at": "2026-06-17T10:30:00+08:00",
      "items": [
        {
          "product_id": "prod_001",
          "unit_id": "unit_001",
          "qty": 2,
          "unit_price": 3500,
          "discount": 0,
          "subtotal": 7000
        }
      ],
      "payments": [
        {
          "method": "cash",
          "amount": 10000
        }
      ],
      "total": 7000,
      "paid": 10000,
      "change": 3000
    }
  ]
}
```

Manual export tidak otomatis menghapus status pending. Setelah file benar-benar dipakai/diunggah, gunakan tombol `Tandai Sudah Diekspor`.

## Alur Penggunaan MVP

1. Login dengan PIN demo.
2. Buka menu Sinkronisasi.
3. Import katalog JSON/CSV dari Inventory Pricing App.
4. Buka menu Stok dan lakukan opname awal jika dibutuhkan.
5. Buka menu Shift dan buka shift kasir.
6. Buka menu Kasir, scan barcode atau cari produk, lalu checkout.
7. Preview/cetak struk.
8. Lihat Dashboard/Laporan.
9. Export sales dari menu Sinkronisasi.

## Catatan Arsitektur

- POS selalu memakai `active_selling_price` dari catalog lokal hasil import.
- POS tidak menghitung margin, rekomendasi harga, min/max price, atau approval.
- Transaksi offline disimpan di IndexedDB dengan status `PENDING`.
- `sync_queue` disiapkan untuk fase backend API dan near real-time sync.
- Stock balance saat ini memakai unit base dengan `conversion_to_base`.
- Future wrapper: Electron/Tauri untuk desktop, Capacitor untuk Android.

## Roadmap Sync

Phase 1:

- Manual import catalog JSON/CSV.
- Manual export sales JSON.

Phase 2:

- Shared backend API.
- Sync product catalog, active prices, stock movements, transactions.

Phase 3:

- Near real-time sync.
- Conflict resolution.
- Multi-outlet support.

## Real-time Sync Lokal

Project ini menyertakan sync server kecil di `sync-server/server.mjs`.

Jalankan tiga proses:

```bash
# Terminal 1 - POS
npm run dev

# Terminal 2 - Sync server
npm run sync:server

# Terminal 3 - Inventory Pricing App
cd ../inventory-pricing-app
npm run dev
```

Alur:

1. Buka Inventory Pricing App -> Lainnya -> Real-time Sync.
2. Isi URL `ws://localhost:8787`, aktifkan sync, lalu klik `Simpan & Connect`.
3. Klik `Publish Catalog Sekarang`.
4. Jalankan POS dengan `.env.local` berisi `VITE_SYNC_URL=ws://localhost:8787`.
5. Buka POS -> Sinkronisasi dan pastikan status `CONNECTED`.
6. Catalog/harga aktif dari Inventory akan masuk ke POS otomatis.
7. Saat POS menyimpan transaksi, sales event dikirim real-time ke sync server dan diterima Inventory.

Catatan:

- Sync server menyimpan state lokal di `.sync-data/realtime-sync-state.json`.
- ACK POS saat ini berarti sync server sudah menerima event secara durable.
- Untuk production, sync server ini bisa diganti backend API/WebSocket dengan auth, tenant, outlet, retry, dan conflict resolution.
