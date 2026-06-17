import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, LogIn, LogOut, MinusCircle, PlusCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { shiftService } from '../services/shiftService';
import { authService } from '../services/authService';
import { formatDateTime, formatRupiah } from '../utils/format';
import type { CashMovementType } from '../services/db';

export default function Shift() {
  const user = authService.getCurrentUser();
  const shift = useLiveQuery(() => user ? shiftService.getCurrentShift(user.id) : undefined, [user?.id]);
  const summary = useLiveQuery(() => shift ? shiftService.getShiftSummary(shift) : undefined, [shift?.id]);
  const [startingCash, setStartingCash] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [cashMovementAmount, setCashMovementAmount] = useState('');
  const [cashMovementNote, setCashMovementNote] = useState('');
  const [lastCloseSummary, setLastCloseSummary] = useState<{ expectedCash: number; difference: number } | null>(null);

  const handleOpenShift = async () => {
    if (!user) return;
    const result = await shiftService.openShift(user.id, 'outlet_001', Number(startingCash || 0));
    if (result.success) {
      toast.success('Shift berhasil dibuka.');
      setStartingCash('');
      setLastCloseSummary(null);
    } else {
      toast.error(result.message || 'Gagal membuka shift.');
    }
  };

  const handleCashMovement = async (type: CashMovementType) => {
    if (!shift) return;

    const amount = Number(cashMovementAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Nominal cash in/out tidak valid.');
      return;
    }

    const result = await shiftService.addCashMovement(shift.id, type, amount, cashMovementNote || (type === 'CASH_IN' ? 'Cash in' : 'Cash out'));
    if (result.success) {
      toast.success(type === 'CASH_IN' ? 'Cash in tersimpan.' : 'Cash out tersimpan.');
      setCashMovementAmount('');
      setCashMovementNote('');
    } else {
      toast.error(result.message || 'Gagal menyimpan cash movement.');
    }
  };

  const handleCloseShift = async () => {
    if (!shift) return;
    const result = await shiftService.closeShift(shift.id, Number(actualCash || 0));
    if (result.success) {
      setLastCloseSummary({ expectedCash: result.expectedCash || 0, difference: result.difference || 0 });
      setActualCash('');
      toast.success('Shift berhasil ditutup.');
    } else {
      toast.error(result.message || 'Gagal menutup shift.');
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto h-full overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Manajemen Shift</h1>
        <p className="text-slate-500">Buka shift, cash in/out, dan rekonsiliasi kas</p>
      </div>

      {!shift && (
        <div className="grid grid-cols-1 lg:grid-cols-[0.85fr_1.15fr] gap-4">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="w-12 h-12 bg-primary-50 text-primary-700 rounded-xl flex items-center justify-center mb-4">
              <LogIn size={24} />
            </div>
            <h2 className="text-lg font-bold mb-2">Buka Shift</h2>
            <p className="text-slate-500 text-sm mb-6">Masukkan modal awal laci kasir untuk mulai transaksi.</p>
            <label className="block text-sm font-bold text-slate-700 mb-1">Modal awal</label>
            <input
              type="number"
              value={startingCash}
              onChange={(event) => setStartingCash(event.target.value)}
              placeholder="0"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none mb-4"
            />
            <button onClick={() => void handleOpenShift()} className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold">
              Buka Shift
            </button>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold mb-4">Ringkasan Shift Terakhir</h2>
            {lastCloseSummary ? (
              <div className="space-y-3">
                <div className="flex justify-between border-b border-slate-100 pb-3">
                  <span className="text-slate-500">Expected cash</span>
                  <span className="font-bold">{formatRupiah(lastCloseSummary.expectedCash)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Selisih</span>
                  <span className={`font-bold ${lastCloseSummary.difference === 0 ? 'text-slate-900' : lastCloseSummary.difference > 0 ? 'text-emerald-700' : 'text-danger'}`}>
                    {formatRupiah(lastCloseSummary.difference)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-slate-400">Belum ada shift yang ditutup pada sesi ini.</p>
            )}
          </div>
        </div>
      )}

      {shift && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
          <div className="space-y-4">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-xs font-bold mb-3">
                    <Banknote size={14} /> Shift aktif
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">{user?.name}</h2>
                  <p className="text-slate-500 text-sm">Dibuka {formatDateTime(shift.opened_at)}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-sm text-slate-500">Modal awal</p>
                  <p className="text-2xl font-extrabold text-primary-700">{formatRupiah(shift.starting_cash)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500 font-bold uppercase">Transaksi</p>
                  <p className="text-xl font-extrabold mt-1">{summary?.transactionCount || 0}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500 font-bold uppercase">Net sales</p>
                  <p className="text-xl font-extrabold mt-1">{formatRupiah(summary?.netSales || 0)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500 font-bold uppercase">Cash sales</p>
                  <p className="text-xl font-extrabold mt-1">{formatRupiah(summary?.cashSales || 0)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500 font-bold uppercase">Expected cash</p>
                  <p className="text-xl font-extrabold mt-1">{formatRupiah(summary?.expectedCash || shift.starting_cash)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h2 className="text-lg font-bold mb-4">Tutup Shift</h2>
              <label className="block text-sm font-bold text-slate-700 mb-1">Uang fisik di laci</label>
              <input
                type="number"
                value={actualCash}
                onChange={(event) => setActualCash(event.target.value)}
                placeholder="0"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none mb-4"
              />
              <button onClick={() => void handleCloseShift()} className="w-full py-3 bg-danger hover:bg-danger/90 text-white rounded-xl font-bold flex items-center justify-center gap-2">
                <LogOut size={18} /> Tutup Shift Sekarang
              </button>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold mb-4">Cash In / Out</h2>
            <div className="space-y-3 mb-5">
              <input
                type="number"
                value={cashMovementAmount}
                onChange={(event) => setCashMovementAmount(event.target.value)}
                placeholder="Nominal"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none"
              />
              <input
                type="text"
                value={cashMovementNote}
                onChange={(event) => setCashMovementNote(event.target.value)}
                placeholder="Catatan"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none"
              />
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => void handleCashMovement('CASH_IN')} className="py-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl font-bold flex items-center justify-center gap-2">
                  <PlusCircle size={18} /> Cash In
                </button>
                <button onClick={() => void handleCashMovement('CASH_OUT')} className="py-3 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl font-bold flex items-center justify-center gap-2">
                  <MinusCircle size={18} /> Cash Out
                </button>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-500">Cash in</span>
                <span className="font-bold">{formatRupiah(summary?.cashIn || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cash out</span>
                <span className="font-bold">{formatRupiah(summary?.cashOut || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Non-cash sales</span>
                <span className="font-bold">{formatRupiah(summary?.nonCashSales || 0)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
