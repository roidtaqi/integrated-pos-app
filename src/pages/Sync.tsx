import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertCircle, CheckCircle, Download, FileJson, FolderUp, RefreshCw, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { productService } from '../services/productService';
import { syncService } from '../services/syncService';
import { realtimeSyncService } from '../services/realtimeSyncService';
import { formatDateTime } from '../utils/format';

export default function Sync() {
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{ success: boolean; msg: string } | null>(null);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const [realtimeUrl, setRealtimeUrl] = useState('ws://localhost:8787');
  const [connectionStatus, setConnectionStatus] = useState(realtimeSyncService.getStatus());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pendingTx = useLiveQuery(() => syncService.getPendingTransactions(), []) || [];
  const pendingQueue = useLiveQuery(() => syncService.getPendingQueue(), []) || [];
  const syncLogs = useLiveQuery(() => syncService.getSyncLogs(), []) || [];

  useEffect(() => {
    let mounted = true;
    realtimeSyncService.getConfig().then((config) => {
      if (!mounted) return;
      setRealtimeEnabled(config.enabled);
      setRealtimeUrl(config.url);
    });

    const unsubscribe = realtimeSyncService.subscribe(setConnectionStatus);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportStatus(null);

    const reader = new FileReader();
    reader.onload = async (readerEvent) => {
      try {
        const raw = readerEvent.target?.result as string;
        const result = file.name.toLowerCase().endsWith('.csv')
          ? await productService.importProductsFromCsv(raw)
          : await productService.importProductsFromJson(JSON.parse(raw));

        if (result.success) {
          setImportStatus({ success: true, msg: `Berhasil mengimpor ${result.count} produk.` });
          toast.success('Katalog produk berhasil diperbarui.');
        } else {
          setImportStatus({ success: false, msg: result.message || 'Gagal mengimpor produk.' });
        }
      } catch {
        setImportStatus({ success: false, msg: 'Format file tidak valid. Gunakan JSON/CSV sesuai kontrak Inventory Pricing App.' });
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      setImportStatus({ success: false, msg: 'Gagal membaca file.' });
      setIsImporting(false);
    };

    reader.readAsText(file);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await syncService.exportSalesData();
      if (!result.success || !result.data) {
        toast.error(result.message || 'Tidak ada data untuk export.');
        return;
      }

      const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `pos-sales-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`Export dibuat untuk ${result.count} transaksi.`);
    } finally {
      setIsExporting(false);
    }
  };

  const markAsSynced = async () => {
    await syncService.markTransactionsAsSynced(pendingTx.map((transaction) => transaction.id));
    toast.success('Transaksi pending ditandai sudah diekspor.');
  };

  const saveRealtimeConfig = async () => {
    await realtimeSyncService.saveConfig({ enabled: realtimeEnabled, url: realtimeUrl });
    if (realtimeEnabled) {
      await realtimeSyncService.connect(realtimeUrl);
    } else {
      realtimeSyncService.disconnect();
    }
    toast.success('Konfigurasi realtime sync tersimpan.');
  };

  const pushPendingNow = async () => {
    await realtimeSyncService.pushPendingNow();
    toast.success('Pending queue dikirim ke sync server.');
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto h-full overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Sinkronisasi</h1>
        <p className="text-slate-500">Import katalog harga aktif dan export transaksi offline</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="w-14 h-14 bg-primary-50 text-primary-700 rounded-xl flex items-center justify-center mb-4">
            <FolderUp size={28} />
          </div>
          <h2 className="text-lg font-bold mb-2">Import Katalog</h2>
          <p className="text-slate-500 text-sm mb-6 flex-1">
            Terima JSON kontrak POS atau backup JSON/CSV dari Inventory Pricing App. POS hanya mengambil harga aktif.
          </p>
          <input type="file" accept=".json,.csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
          <button onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="w-full py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 text-white rounded-xl font-bold">
            {isImporting ? 'Mengimpor...' : 'Pilih JSON/CSV'}
          </button>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="w-14 h-14 bg-amber-50 text-amber-700 rounded-xl flex items-center justify-center mb-4 relative">
            <Upload size={28} />
            {pendingTx.length > 0 && <span className="absolute -top-2 -right-2 bg-danger text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">{pendingTx.length}</span>}
          </div>
          <h2 className="text-lg font-bold mb-2">Export Sales</h2>
          <p className="text-slate-500 text-sm mb-6 flex-1">
            Export transaksi pending sesuai kontrak POS untuk Inventory Pricing App atau backend sync fase berikutnya.
          </p>
          <button onClick={() => void handleExport()} disabled={isExporting || pendingTx.length === 0} className="w-full py-3 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white rounded-xl font-bold flex items-center justify-center gap-2">
            <FileJson size={18} />
            {isExporting ? 'Memproses...' : 'Download JSON'}
          </button>
          {pendingTx.length > 0 && (
            <button onClick={() => void markAsSynced()} className="w-full mt-3 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold">
              Tandai Sudah Diekspor
            </button>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="w-14 h-14 bg-emerald-50 text-emerald-700 rounded-xl flex items-center justify-center mb-4">
            <RefreshCw size={28} />
          </div>
          <h2 className="text-lg font-bold mb-4">Pending Queue</h2>
          <div className="space-y-3">
            <div className="flex justify-between rounded-lg bg-slate-50 px-4 py-3">
              <span className="text-slate-500 font-bold">Transaksi</span>
              <span className="font-extrabold">{pendingTx.length}</span>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 px-4 py-3">
              <span className="text-slate-500 font-bold">Queue item</span>
              <span className="font-extrabold">{pendingQueue.length}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex-1">
            <h2 className="text-lg font-bold mb-1">Real-time Sync</h2>
            <p className="text-sm text-slate-500">
              Hubungkan POS ke sync server agar catalog dari Inventory masuk otomatis dan transaksi POS terkirim real-time.
            </p>
          </div>
          <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold ${
            connectionStatus === 'CONNECTED'
              ? 'bg-emerald-50 text-emerald-700'
              : connectionStatus === 'CONNECTING'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-slate-100 text-slate-600'
          }`}>
            {connectionStatus}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto] gap-3">
          <input
            value={realtimeUrl}
            onChange={(event) => setRealtimeUrl(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="ws://localhost:8787"
          />
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-bold text-slate-700">
            <input
              type="checkbox"
              checked={realtimeEnabled}
              onChange={(event) => setRealtimeEnabled(event.target.checked)}
              className="h-5 w-5"
            />
            Enable
          </label>
          <button onClick={() => void saveRealtimeConfig()} className="rounded-xl bg-primary-600 px-5 py-3 font-bold text-white hover:bg-primary-700">
            Simpan & Connect
          </button>
          <button onClick={() => void pushPendingNow()} className="rounded-xl bg-slate-800 px-5 py-3 font-bold text-white hover:bg-slate-900">
            Push Pending
          </button>
        </div>
      </div>

      {importStatus && (
        <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${importStatus.success ? 'bg-emerald-50 text-emerald-700' : 'bg-danger/10 text-danger'}`}>
          {importStatus.success ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span className="font-bold">{importStatus.msg}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Riwayat Sinkronisasi</h2>
          <Download size={18} className="text-slate-400" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-500">
                <th className="p-4">Waktu</th>
                <th className="p-4">Tipe</th>
                <th className="p-4">Status</th>
                <th className="p-4">Records</th>
                <th className="p-4">Pesan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {syncLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-slate-500">Belum ada riwayat sinkronisasi.</td>
                </tr>
              ) : (
                syncLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="p-4 text-slate-500">{formatDateTime(log.created_at)}</td>
                    <td className="p-4 font-bold">{log.type}</td>
                    <td className="p-4">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${log.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : 'bg-danger/10 text-danger'}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="p-4">{log.records_processed}</td>
                    <td className="p-4 text-slate-600">{log.message}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
