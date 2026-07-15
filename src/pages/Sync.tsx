import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Cloud, Database, RefreshCw, WifiOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { realtimeSyncService } from '../services/realtimeSyncService';
import { syncService } from '../services/syncService';

export default function Sync() {
  const [connectionStatus, setConnectionStatus] = useState(realtimeSyncService.getStatus());
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastResult, setLastResult] = useState('');
  const pendingTransactions = useLiveQuery(() => syncService.getPendingTransactions(), []) || [];
  const pendingQueue = useLiveQuery(() => syncService.getPendingQueue(), []) || [];

  useEffect(() => {
    const unsubscribe = realtimeSyncService.subscribe(setConnectionStatus);
    return () => {
      unsubscribe();
    };
  }, []);

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setLastResult('');

    try {
      const result = await realtimeSyncService.syncNow();
      const message = `${result.records} data POS dan ${result.products} produk berhasil disamakan.`;
      setLastResult(message);
      toast.success('Sinkronisasi selesai.');
    } catch (error) {
      console.error(error);
      toast.error('Sinkronisasi belum berhasil. Periksa koneksi internet.');
    } finally {
      setIsSyncing(false);
    }
  };

  const connected = connectionStatus === 'CONNECTED';
  const intervalSeconds = Math.round(realtimeSyncService.getAutoPullIntervalMs() / 1000);

  return (
    <div className="h-full overflow-y-auto px-3 py-4 pb-24 sm:px-6 sm:py-6 md:pb-6">
      <main className="mx-auto max-w-2xl">
        <header className="mb-4">
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Sinkronisasi</h1>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {connected ? <Cloud size={20} /> : <WifiOff size={20} />}
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-slate-900">Kastur Cloud</h2>
                <p className="text-sm text-slate-500">{connected ? 'Terhubung dan sinkron otomatis' : connectionStatus === 'CONNECTING' ? 'Sedang menghubungkan' : 'Menunggu koneksi'}</p>
              </div>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {connected ? 'Online' : 'Offline'}
            </span>
          </div>

          <div className="grid grid-cols-3 border-y border-slate-200 bg-slate-50">
            <div className="p-3 text-center">
              <p className="text-xs text-slate-500">Transaksi</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{pendingTransactions.length}</p>
            </div>
            <div className="border-x border-slate-200 p-3 text-center">
              <p className="text-xs text-slate-500">Antrean</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{pendingQueue.length}</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-xs text-slate-500">Mode</p>
              <p className="mt-1 text-sm font-bold text-emerald-700">Otomatis</p>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <button
              type="button"
              onClick={() => void handleSyncNow()}
              disabled={isSyncing}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-700 disabled:bg-slate-300"
            >
              <RefreshCw className={isSyncing ? 'animate-spin' : ''} size={19} />
              {isSyncing ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}
            </button>

            <p className="mt-3 text-center text-xs text-slate-500">Pembaruan otomatis setiap {intervalSeconds} detik</p>

            {lastResult && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="mt-0.5 shrink-0" size={17} />
                <span>{lastResult}</span>
              </div>
            )}
          </div>
        </section>

        <div className="mt-4 flex items-center gap-2 px-1 text-xs text-slate-500">
          <Database className="shrink-0" size={16} />
          <span>Data pusat tersimpan di Cloud.</span>
        </div>
      </main>
    </div>
  );
}
