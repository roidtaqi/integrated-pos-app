import { useEffect, useState } from 'react';
import { Calendar, Download } from 'lucide-react';
import { reportService } from '../services/reportService';
import { formatDateTime, formatRupiah, toDateInputValue } from '../utils/format';

type ReportsData = Awaited<ReturnType<typeof reportService.getReports>>;

export default function Reports() {
  const [reports, setReports] = useState<ReportsData | null>(null);
  const [startDate, setStartDate] = useState(toDateInputValue());
  const [endDate, setEndDate] = useState(toDateInputValue());

  useEffect(() => {
    async function load() {
      const start = new Date(`${startDate}T00:00:00`);
      const end = new Date(`${endDate}T23:59:59.999`);
      const data = await reportService.getReports(start.toISOString(), end.toISOString());
      setReports(data);
    }

    void load();
  }, [startDate, endDate]);

  const exportReport = () => {
    if (!reports) return;
    const payload = JSON.stringify({ startDate, endDate, reports }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pos-report-${startDate}-${endDate}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto h-full overflow-y-auto">
      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Laporan</h1>
          <p className="text-slate-500">Penjualan harian, shift, kasir, payment, diskon, dan best-selling</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
            <Calendar size={16} className="text-slate-400 mr-2" />
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="text-sm outline-none text-slate-700" />
            <span className="mx-2 text-slate-300">-</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="text-sm outline-none text-slate-700" />
          </div>
          <button onClick={exportReport} className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-xl transition-colors">
            <Download size={16} /> Export
          </button>
        </div>
      </div>

      {!reports ? (
        <div className="text-center py-10 text-slate-500">Memuat laporan...</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-slate-500 text-sm font-bold">Gross Sales</h3>
              <p className="text-2xl font-extrabold mt-2 text-slate-900">{formatRupiah(reports.totalGrossSales)}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-slate-500 text-sm font-bold">Diskon</h3>
              <p className="text-2xl font-extrabold mt-2 text-danger">{formatRupiah(reports.totalDiscount)}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-slate-500 text-sm font-bold">Net Sales</h3>
              <p className="text-2xl font-extrabold mt-2 text-primary-700">{formatRupiah(reports.totalNetSales)}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-slate-500 text-sm font-bold">Transaksi</h3>
              <p className="text-2xl font-extrabold mt-2 text-slate-900">{reports.totalTransactions}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-lg font-bold mb-4">Metode Pembayaran</h3>
              <div className="space-y-3">
                {Object.entries(reports.paymentSummary).map(([method, amount]) => (
                  <div key={method} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                    <span className="font-bold text-slate-700 uppercase">{method}</span>
                    <span className="font-bold">{formatRupiah(amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-lg font-bold mb-4">Produk Terlaris</h3>
              {reports.bestSelling.length === 0 ? (
                <p className="text-slate-500 text-center py-6">Belum ada data penjualan.</p>
              ) : (
                <div className="space-y-3">
                  {reports.bestSelling.map((item, index) => (
                    <div key={item.id} className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-7 h-7 rounded bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold">{index + 1}</span>
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
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-lg font-bold mb-4">Penjualan per Kasir</h3>
              <div className="space-y-3">
                {reports.salesByCashier.length === 0 ? (
                  <p className="text-slate-500 text-center py-6">Belum ada transaksi kasir.</p>
                ) : reports.salesByCashier.map((cashier) => (
                  <div key={cashier.id} className="flex justify-between items-center rounded-lg bg-slate-50 px-4 py-3">
                    <div>
                      <p className="font-bold text-slate-900">{cashier.name}</p>
                      <p className="text-xs text-slate-500">{cashier.role} · {cashier.transactions} transaksi</p>
                    </div>
                    <span className="font-bold">{formatRupiah(cashier.total)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-lg font-bold mb-4">Penjualan per Shift</h3>
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                {reports.salesByShift.length === 0 ? (
                  <p className="text-slate-500 text-center py-6">Belum ada transaksi shift.</p>
                ) : reports.salesByShift.map((shift) => (
                  <div key={shift.id} className="rounded-lg bg-slate-50 px-4 py-3">
                    <div className="flex justify-between gap-3">
                      <p className="font-bold text-slate-900">{shift.cashierName}</p>
                      <p className="font-bold">{formatRupiah(shift.total)}</p>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {formatDateTime(shift.openedAt)} · {shift.transactions} transaksi
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
