import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownUp, ClipboardCheck, Search, TriangleAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { stockService } from '../services/stockService';
import { authService } from '../services/authService';
import { formatDateTime } from '../utils/format';

export default function Stock() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [newQty, setNewQty] = useState('');
  const [note, setNote] = useState('');
  const liveStockBalances = useLiveQuery(() => stockService.getStockOverview(), []);
  const stockBalances = useMemo(() => liveStockBalances || [], [liveStockBalances]);
  const movements = useLiveQuery(() => stockService.getMovements(20), []) || [];
  const user = authService.getCurrentUser();

  const filteredBalances = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return stockBalances;

    return stockBalances.filter((stock) =>
      stock.productName.toLowerCase().includes(query) ||
      stock.sku.toLowerCase().includes(query) ||
      stock.category.toLowerCase().includes(query)
    );
  }, [searchQuery, stockBalances]);

  const handleAdjustment = async () => {
    if (!selectedProductId) {
      toast.error('Pilih produk untuk opname.');
      return;
    }

    const qty = Number(newQty);
    if (!Number.isFinite(qty)) {
      toast.error('Qty stok tidak valid.');
      return;
    }

    await stockService.adjustStock({
      product_id: selectedProductId,
      new_qty: qty,
      note: note || 'Stock opname manual',
      user_id: user?.id
    });

    toast.success('Stock opname tersimpan.');
    setSelectedProductId('');
    setNewQty('');
    setNote('');
  };

  return (
    <div className="p-4 sm:p-6 h-full overflow-y-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Stok & Mutasi</h1>
          <p className="text-slate-500">Stok per outlet, low stock, dan riwayat movement</p>
        </div>
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Cari stok produk"
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-500">
                  <th className="p-4">Produk</th>
                  <th className="p-4 text-center">Stok Sistem</th>
                  <th className="p-4 text-center">Threshold</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-right">Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredBalances.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-slate-500">
                      Belum ada stok. Import produk dulu, lalu lakukan opname awal.
                    </td>
                  </tr>
                )}
                {filteredBalances.map((stock) => (
                  <tr key={stock.id} className="hover:bg-slate-50">
                    <td className="p-4">
                      <div className="font-bold text-slate-900">{stock.productName}</div>
                      <div className="text-xs text-slate-500">{stock.sku} · {stock.category}</div>
                    </td>
                    <td className="p-4 text-center font-extrabold text-primary-700">
                      {stock.qty} {stock.unitName}
                    </td>
                    <td className="p-4 text-center text-slate-600">{stock.low_stock_threshold}</td>
                    <td className="p-4 text-center">
                      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${stock.lowStock ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {stock.lowStock && <TriangleAlert size={14} />}
                        {stock.lowStock ? 'Low Stock' : 'Aman'}
                      </span>
                    </td>
                    <td className="p-4 text-right text-slate-500 text-xs">{formatDateTime(stock.last_updated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardCheck className="text-primary-700" size={20} />
              <h2 className="font-bold text-slate-900">Stock Opname</h2>
            </div>
            <div className="space-y-3">
              <select
                value={selectedProductId}
                onChange={(event) => setSelectedProductId(event.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Pilih produk</option>
                {stockBalances.map((stock) => (
                  <option key={stock.product_id} value={stock.product_id}>{stock.productName}</option>
                ))}
              </select>
              <input
                type="number"
                value={newQty}
                onChange={(event) => setNewQty(event.target.value)}
                placeholder="Qty aktual"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary-500"
              />
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Catatan"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button onClick={() => void handleAdjustment()} className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl">
                Simpan Opname
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <ArrowDownUp className="text-primary-700" size={20} />
              <h2 className="font-bold text-slate-900">Mutasi Terakhir</h2>
            </div>
            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {movements.length === 0 ? (
                <p className="py-6 text-center text-slate-400">Belum ada mutasi stok.</p>
              ) : (
                movements.map((movement) => (
                  <div key={movement.id} className="rounded-xl border border-slate-100 p-3">
                    <div className="flex justify-between gap-3">
                      <p className="font-bold text-slate-800 truncate">{movement.productName}</p>
                      <span className={movement.qty_change < 0 ? 'font-bold text-danger' : 'font-bold text-emerald-700'}>
                        {movement.qty_change > 0 ? '+' : ''}{movement.qty_change}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-xs text-slate-500 mt-1">
                      <span>{movement.typeLabel}</span>
                      <span>{formatDateTime(movement.created_at)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
