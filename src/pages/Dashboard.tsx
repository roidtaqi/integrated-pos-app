import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, BarChart3, Package, RefreshCw, ShoppingCart, TriangleAlert } from 'lucide-react';
import { reportService } from '../services/reportService';
import { formatRupiah } from '../utils/format';

export default function Dashboard() {
  const stats = useLiveQuery(() => reportService.getDashboardSummary(), []) || {
    totalSales: 0,
    totalTransactions: 0,
    pendingSync: 0,
    productCount: 0,
    lowStockCount: 0,
    bestSelling: []
  };

  return (
    <div className="p-4 sm:p-6 h-full overflow-y-auto">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500">Ringkasan operasional hari ini</p>
        </div>
        <Link to="/pos" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 font-bold text-white hover:bg-primary-700">
          Buka Kasir <ArrowRight size={18} />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-sm font-bold">
            <span>Penjualan Hari Ini</span>
            <BarChart3 size={18} />
          </div>
          <p className="text-3xl font-extrabold mt-3 text-slate-900">{formatRupiah(stats.totalSales)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-sm font-bold">
            <span>Total Transaksi</span>
            <ShoppingCart size={18} />
          </div>
          <p className="text-3xl font-extrabold mt-3 text-slate-900">{stats.totalTransactions}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-sm font-bold">
            <span>Produk Aktif</span>
            <Package size={18} />
          </div>
          <p className="text-3xl font-extrabold mt-3 text-slate-900">{stats.productCount}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-sm font-bold">
            <span>Pending Sync</span>
            <RefreshCw size={18} />
          </div>
          <p className={`text-3xl font-extrabold mt-3 ${stats.pendingSync > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
            {stats.pendingSync}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4 mt-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-900">Produk Terlaris</h2>
            <Link to="/reports" className="text-sm font-bold text-primary-700">Lihat laporan</Link>
          </div>
          {stats.bestSelling.length === 0 ? (
            <div className="py-10 text-center text-slate-400">Belum ada penjualan hari ini.</div>
          ) : (
            <div className="space-y-3">
              {stats.bestSelling.map((item, index) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
                      {index + 1}
                    </span>
                    <span className="font-bold text-slate-800 truncate">{item.name}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-900">{item.qty} terjual</p>
                    <p className="text-xs text-slate-500">{formatRupiah(item.total)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-bold text-slate-900 mb-4">Status Operasional</h2>
          <div className="space-y-3">
            <Link to="/sync" className="flex items-center justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50">
              <div>
                <p className="font-bold text-slate-900">Sinkronisasi</p>
                <p className="text-sm text-slate-500">{stats.pendingSync} transaksi menunggu export/sync</p>
              </div>
              <RefreshCw className={stats.pendingSync > 0 ? 'text-amber-600' : 'text-emerald-700'} />
            </Link>
            <Link to="/stock" className="flex items-center justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50">
              <div>
                <p className="font-bold text-slate-900">Low Stock</p>
                <p className="text-sm text-slate-500">{stats.lowStockCount} produk perlu dicek</p>
              </div>
              <TriangleAlert className={stats.lowStockCount > 0 ? 'text-amber-600' : 'text-emerald-700'} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
