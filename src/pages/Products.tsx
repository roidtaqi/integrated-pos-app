import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Package, Search } from 'lucide-react';
import { productService } from '../services/productService';
import { formatRupiah } from '../utils/format';

export default function Products() {
  const [searchQuery, setSearchQuery] = useState('');
  const liveProducts = useLiveQuery(() => productService.getProductsWithUnits(true), []);
  const products = useMemo(() => liveProducts || [], [liveProducts]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return products;

    return products.filter((product) =>
      product.name.toLowerCase().includes(query) ||
      product.sku.toLowerCase().includes(query) ||
      product.barcode.includes(searchQuery.trim()) ||
      product.category.toLowerCase().includes(query) ||
      product.brand.toLowerCase().includes(query)
    );
  }, [products, searchQuery]);

  return (
    <div className="p-4 sm:p-6 h-full overflow-y-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Produk</h1>
          <p className="text-slate-500">Katalog lokal hasil import dari Inventory Pricing App</p>
        </div>
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Cari produk, SKU, barcode"
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-500">
                <th className="p-4">Produk</th>
                <th className="p-4">Kategori / Brand</th>
                <th className="p-4">Satuan & Harga Aktif</th>
                <th className="p-4 text-center">Stok</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4">Sumber Harga</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-slate-500">
                    <Package size={48} className="mx-auto mb-3 opacity-30" />
                    Belum ada produk. Import JSON/CSV dari menu Sinkronisasi.
                  </td>
                </tr>
              )}
              {filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-slate-50 align-top">
                  <td className="p-4">
                    <div className="font-bold text-slate-900">{product.name}</div>
                    <div className="text-xs text-slate-500 mt-1">SKU {product.sku}</div>
                    <div className="text-xs text-slate-500">Barcode {product.barcode || '-'}</div>
                  </td>
                  <td className="p-4">
                    <div className="font-medium text-slate-700">{product.category}</div>
                    <div className="text-xs text-slate-500 mt-1">{product.brand}</div>
                  </td>
                  <td className="p-4">
                    <div className="space-y-2">
                      {product.units.map((unit) => (
                        <div key={unit.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                          <div>
                            <p className="font-bold text-slate-800">{unit.unit_name}</p>
                            <p className="text-xs text-slate-500">Konversi {unit.conversion_to_base}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-primary-700">{formatRupiah(unit.active_selling_price)}</p>
                            <p className="text-xs text-slate-500">Aktif {unit.effective_date}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="p-4 text-center">
                    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${product.stock_qty <= 5 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {product.stock_qty}
                    </span>
                  </td>
                  <td className="p-4 text-center">
                    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${product.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {product.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className="inline-flex px-3 py-1 rounded-full text-xs font-bold bg-primary-50 text-primary-700">
                      {product.source === 'INVENTORY_PRICING_APP' ? 'Inventory Pricing App' : 'Lokal'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
