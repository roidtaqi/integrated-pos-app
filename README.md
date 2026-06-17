# Integrated POS App

Integrated POS App adalah aplikasi kasir/POS modern, offline-first, dan PWA-installable. Aplikasi ini dibuat sebagai sales execution layer yang terpisah dari Inventory Pricing App.

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

Default WebSocket URL:

```txt
ws://localhost:8787
```

Build production:

```bash
npm run build
npm run preview
```

Quality check:

```bash
npm run lint
npm run build
```

## Akun Demo

| Role | PIN | Akses |
| --- | --- | --- |
| Owner | `1111` | Semua akses |
| Admin | `2222` | Produk, stok, laporan, shift, sinkronisasi, pengaturan |
| Supervisor | `3333` | POS, shift, laporan, diskon, void/refund future |
| Kasir | `4444` / `5555` | POS, buka/tutup shift, pelanggan, cetak struk |

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
4. Buka POS -> Sinkronisasi.
5. Isi URL `ws://localhost:8787`, aktifkan sync, lalu klik `Simpan & Connect`.
6. Catalog/harga aktif dari Inventory akan masuk ke POS otomatis.
7. Saat POS menyimpan transaksi, sales event dikirim real-time ke sync server dan diterima Inventory.

Catatan:

- Sync server menyimpan state lokal di `.sync-data/realtime-sync-state.json`.
- ACK POS saat ini berarti sync server sudah menerima event secara durable.
- Untuk production, sync server ini bisa diganti backend API/WebSocket dengan auth, tenant, outlet, retry, dan conflict resolution.
